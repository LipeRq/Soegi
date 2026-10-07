// 打刻データ → 残業の集計。AIは使わない。すべて整数の「分」で計算する（同じ入力なら毎回同じ結果）。
//
// ルール（設計書 5.）
//  実労働   = 退勤 − 出勤 − 休憩。退勤が出勤より早ければ日をまたいだとみなす
//  時間外   = 1日の実労働のうち所定（既定8時間）を超えた分。法定休日の日は休日労働に入れ、時間外には数えない
//  深夜     = 22:00〜翌5:00の労働時間（休憩は昼間にとったものとして深夜から引かない）
//  休日労働 = 法定休日（既定：日曜）の労働時間。日またぎは出勤した日で判定する
//  連続勤務 = 6日以上続けて出勤していれば表示
//  週40時間 = 参考表示のみ（月〜日。法定休日の日を除き、1日の所定分までを数えて40時間を超えた分）
// 判定（厚生労働省の上限規制の目安）
//  黄：時間外が月45時間超 ／ 橙：時間外＋休日労働が月80時間以上 ／ 赤：同100時間以上

export const DEFAULT_SETTINGS = Object.freeze({
  scheduledMin: 8 * 60, // 所定労働時間
  defaultBreakMin: 60, // 休憩が書かれていない日に使う
  holidayWeekday: 0, // 法定休日（0=日曜）
  closeDay: 'end', // 締め日：'end'（月末）または 1〜28
});

export const LIMITS = Object.freeze({ yellowOver: 45 * 60, orange: 80 * 60, red: 100 * 60 });
export const STREAK_DAYS = 6;
export const WEEKLY_REGULAR_MIN = 40 * 60;

const DAY = 1440;
// 深夜帯（出勤日の0:00からの分）。0:00-5:00／22:00-29:00／46:00-53:00
const NIGHT_WINDOWS = [[0, 300], [1320, 1740], [2760, 3180]];

// ---- 文字列の読み取り ----------------------------------------------------------

const norm = (s) => String(s ?? '').normalize('NFKC').trim();

/** "2026-09-01" "2026/9/1" "2026年9月1日" → "2026-09-01"。読めなければ null */
export function parseDate(input) {
  const s = norm(input);
  const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[ T].*)?$/);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "9:00" "09:00:00" "9時30分" "0900" "2026-09-01 09:00" → 0:00からの分。読めなければ null。空は null（isBlankで区別） */
export function parseTime(input) {
  let s = norm(input);
  if (!s) return null;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]/.test(s)) s = s.split(/[ T]/).pop();
  const hOnly = s.match(/^(\d{1,2})時$/);
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
    || s.match(/^(\d{1,2})時(\d{1,2})分?$/)
    || (hOnly && [null, hOnly[1], '0'])
    || s.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 47 || mi > 59) return null;
  return h * 60 + mi;
}

export const isBlank = (v) => norm(v) === '';

/** 休憩（分）。空なら null（既定値を使う）。"60" "1:00" "0.5"(時間)は扱わず分のみ。読めなければ NaN */
export function parseBreak(input) {
  const s = norm(input);
  if (s === '') return null;
  const t = s.match(/^(\d{1,2}):(\d{2})$/);
  if (t) return Number(t[1]) * 60 + Number(t[2]);
  const n = Number(s.replace(/分$/, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : Number.NaN;
}

export function normalizeName(input) {
  return norm(input).replace(/[\s　]+/g, ' ');
}

// ---- 日付の計算 ----------------------------------------------------------------

const toUtc = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const weekdayOf = (iso) => new Date(toUtc(iso)).getUTCDay();
const dayIndex = (iso) => Math.round(toUtc(iso) / 86400000);
const mondayOf = (iso) => fromUtc(toUtc(iso) - ((weekdayOf(iso) + 6) % 7) * 86400000);
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/** 締め日に応じた集計期間のキー（YYYY-MM）。月末締めなら暦の月。N日締めなら N日までがその月分 */
export function periodKeyOf(iso, closeDay) {
  const [y, m, d] = iso.split('-').map(Number);
  if (closeDay === 'end' || d <= Number(closeDay)) return `${y}-${String(m).padStart(2, '0')}`;
  const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function periodLabel(key, closeDay) {
  const [y, m] = key.split('-').map(Number);
  if (closeDay === 'end') return `${y}年${m}月分`;
  const pm = m === 1 ? 12 : m - 1; const py = m === 1 ? y - 1 : y;
  const n = Number(closeDay);
  return `${y}年${m}月分（${pm}/${n + 1}〜${m}/${n}）`;
}

// ---- 1回の勤務の計算 ------------------------------------------------------------

/** 勤務時間帯 [start, end)（出勤日0:00からの分）のうち深夜帯にあたる分 */
export function nightMinutes(startMin, endMin) {
  let total = 0;
  for (const [a, b] of NIGHT_WINDOWS) total += Math.max(0, Math.min(endMin, b) - Math.max(startMin, a));
  return total;
}

/**
 * 1回の勤務を計算する。出勤・退勤は分。休憩は null なら既定値。
 * @returns {{start,end,breakMin,breakDefaulted,crossesMidnight,workMin,nightMin,warning?}}
 */
export function calcShift(startMin, endMinRaw, breakMinRaw, defaultBreakMin) {
  const crossesMidnight = endMinRaw < startMin;
  const end = crossesMidnight ? endMinRaw + DAY : endMinRaw;
  const breakDefaulted = breakMinRaw == null;
  const breakMin = breakDefaulted ? defaultBreakMin : breakMinRaw;
  const span = end - startMin;
  let workMin = span - breakMin;
  let warning;
  if (workMin < 0) { workMin = 0; warning = '休憩が勤務時間より長い'; }
  const nightMin = Math.min(nightMinutes(startMin, end), workMin);
  return { start: startMin, end, breakMin, breakDefaulted, crossesMidnight, workMin, nightMin, warning };
}

// ---- 全体の計算 ----------------------------------------------------------------

/**
 * @param {Array<{name,date,start,end,breakMin?}>} records 生の文字列でよい（start/end/breakMin/date）
 * @param {Partial<typeof DEFAULT_SETTINGS>} settingsIn
 */
export function calculate(records, settingsIn = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...settingsIn };
  const errors = [];
  const byPerson = new Map(); // name -> Map(date -> shifts[])

  records.forEach((r, idx) => {
    const row = r.row ?? idx + 1;
    const name = normalizeName(r.name);
    const date = parseDate(r.date);
    const noStart = isBlank(r.start); const noEnd = isBlank(r.end);
    if (noStart && noEnd) return; // 出退勤が両方空＝休み
    if (!name) { errors.push({ row, message: '氏名が空です' }); return; }
    if (!date) { errors.push({ row, message: `日付を読めません（${norm(r.date)}）` }); return; }
    if (noStart || noEnd) { errors.push({ row, message: `${name} ${date}：出勤か退勤のどちらかが空です` }); return; }
    const s = parseTime(r.start); const e = parseTime(r.end);
    if (s == null || e == null) { errors.push({ row, message: `${name} ${date}：時刻を読めません（${norm(r.start)}／${norm(r.end)}）` }); return; }
    if (s >= DAY) { errors.push({ row, message: `${name} ${date}：出勤が24時以降です` }); return; }
    const br = parseBreak(r.breakMin);
    if (Number.isNaN(br)) { errors.push({ row, message: `${name} ${date}：休憩を読めません（${norm(r.breakMin)}）` }); return; }
    const shift = calcShift(s, e, br, settings.defaultBreakMin);
    if (shift.end - shift.start > DAY) { errors.push({ row, message: `${name} ${date}：勤務が24時間を超えています` }); return; }
    if (shift.warning) errors.push({ row, message: `${name} ${date}：${shift.warning}（実労働0分として扱います）`, warning: true });
    if (!byPerson.has(name)) byPerson.set(name, new Map());
    const days = byPerson.get(name);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(shift);
  });

  // 人ごとに日別を作る
  const peopleAll = [];
  for (const [name, dayMap] of byPerson) {
    const days = [...dayMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, shifts]) => buildDay(date, shifts, settings));
    markStreaks(days);
    peopleAll.push({ name, days });
  }

  // 期間に分ける
  const periodKeys = new Set();
  for (const p of peopleAll) for (const d of p.days) {
    d.period = periodKeyOf(d.date, settings.closeDay);
    periodKeys.add(d.period);
  }
  const weekly = weeklyOver(peopleAll, settings);

  const periods = [...periodKeys].sort().map((key) => {
    const people = [];
    for (const p of peopleAll) {
      const days = p.days.filter((d) => d.period === key);
      if (!days.length) continue;
      people.push(summarize(p.name, days, weekly.get(`${p.name}|${key}`) ?? 0));
    }
    people.sort((a, b) => (b.overPlusHolidayMin - a.overPlusHolidayMin) || a.name.localeCompare(b.name, 'ja'));
    return { key, label: periodLabel(key, settings.closeDay), people };
  });

  return { settings, periods, errors };
}

function buildDay(date, shifts, settings) {
  shifts.sort((a, b) => a.start - b.start);
  const workMin = shifts.reduce((t, s) => t + s.workMin, 0);
  const nightMin = shifts.reduce((t, s) => t + s.nightMin, 0);
  const isHoliday = weekdayOf(date) === settings.holidayWeekday;
  const holidayMin = isHoliday ? workMin : 0;
  const overMin = isHoliday ? 0 : Math.max(0, workMin - settings.scheduledMin);
  return {
    date,
    weekday: weekdayOf(date),
    isHoliday,
    start: shifts[0].start,
    end: shifts[shifts.length - 1].end, // 日またぎは 1440 以上
    breakMin: shifts.reduce((t, s) => t + s.breakMin, 0),
    breakDefaulted: shifts.some((s) => s.breakDefaulted),
    crossesMidnight: shifts.some((s) => s.crossesMidnight),
    shiftCount: shifts.length,
    workMin, overMin, nightMin, holidayMin,
    streak: 0,
  };
}

/** 連続して出勤した日数（その日を含む連続の全長）を各日に入れる */
function markStreaks(days) {
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && dayIndex(days[j + 1].date) === dayIndex(days[j].date) + 1) j++;
    const len = j - i + 1;
    for (let k = i; k <= j; k++) days[k].streak = len;
    i = j + 1;
  }
}

/** 週40時間（参考）：週ごとに計算し、その週の最後の出勤日が属する期間に入れる */
function weeklyOver(people, settings) {
  const out = new Map();
  for (const p of people) {
    const weeks = new Map();
    for (const d of p.days) {
      const wk = mondayOf(d.date);
      const w = weeks.get(wk) ?? { regular: 0, lastPeriod: d.period };
      if (!d.isHoliday) w.regular += Math.min(d.workMin, settings.scheduledMin);
      w.lastPeriod = d.period; // days は日付順
      weeks.set(wk, w);
    }
    for (const w of weeks.values()) {
      const over = Math.max(0, w.regular - WEEKLY_REGULAR_MIN);
      const k = `${p.name}|${w.lastPeriod}`;
      out.set(k, (out.get(k) ?? 0) + over);
    }
  }
  return out;
}

export function judge(overMin, overPlusHolidayMin) {
  if (overPlusHolidayMin >= LIMITS.red) return 'red';
  if (overPlusHolidayMin >= LIMITS.orange) return 'orange';
  if (overMin > LIMITS.yellowOver) return 'yellow';
  return 'none';
}

export const STATUS_TEXT = Object.freeze({
  none: '—',
  yellow: '黄：時間外が月45時間超',
  orange: '橙：時間外＋休日労働が月80時間以上',
  red: '赤：時間外＋休日労働が月100時間以上',
});

function summarize(name, days, weeklyOverMin) {
  const sum = (k) => days.reduce((t, d) => t + d[k], 0);
  const overMin = sum('overMin'); const holidayMin = sum('holidayMin');
  const maxStreak = Math.max(...days.map((d) => d.streak));
  return {
    name, days,
    workDays: days.filter((d) => d.workMin > 0).length,
    workMin: sum('workMin'),
    overMin, nightMin: sum('nightMin'), holidayMin,
    overPlusHolidayMin: overMin + holidayMin,
    weeklyOverMin,
    maxStreak,
    streakFlag: maxStreak >= STREAK_DAYS,
    status: judge(overMin, overMin + holidayMin),
  };
}

// ---- 表示用 --------------------------------------------------------------------

/** 分 → "H:MM" */
export function fmtHM(min) {
  const h = Math.floor(min / 60); const m = min % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** 0:00からの分 → "HH:MM"（24時以降は翌日の時刻、+1 を付けない） */
export function fmtClock(min) {
  const t = min % DAY;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
