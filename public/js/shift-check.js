// シフト表のチェック（労務）。AIは使わない。判定はすべてここ（同じ表なら、毎回同じ結果）。
//  赤（要確認）：時間帯の人数が足りない（1時間ごとに数える）／希望休の日に勤務／記号が記号の表にない
//  黄（注意）：連勤が上限を超える／月の休日数が下限より少ない／勤務と勤務の間が11時間未満（参考）／希望休の日が夜勤明け／
//      夜勤の次の日が休日（朝まで勤務なので丸1日の休みにならない）／夜勤明けの前の日が夜勤でない／記号が空／
//      希望休の氏名がシフト表にいない
// 時刻は「月の初日の0時からの分」。夜勤（22:00–翌7:00）は翌朝まで数える。前の月・次の月の勤務は表に無いので数えない

export const DEFAULT_SYMBOLS = [
  { code: '早', name: '早番', start: '07:00', end: '16:00', kind: 'work' },
  { code: '日', name: '日勤', start: '09:00', end: '18:00', kind: 'work' },
  { code: '遅', name: '遅番', start: '13:00', end: '22:00', kind: 'work' },
  { code: '夜', name: '夜勤', start: '22:00', end: '07:00', kind: 'work' },
  { code: '明', name: '夜勤明け', start: '', end: '', kind: 'after' },
  { code: '休', name: '休み', start: '', end: '', kind: 'off' },
  { code: '公', name: '公休', start: '', end: '', kind: 'off' },
  { code: '有', name: '有給休暇', start: '', end: '', kind: 'leave' },
];
/**
 * 記号の種類。work＝勤務／off＝休日（月の休日数に数える）／leave＝有給など（休日数に数えない。連勤は切れる）／
 * after＝夜勤明け（休日数に数えない。前の夜勤の続きなので、連勤は切れない）
 */
export const KINDS = ['work', 'off', 'leave', 'after'];
export const KIND_LABEL = {
  work: '勤務',
  off: '休日（休日数に数える）',
  leave: '休み（有給など。休日数に数えない）',
  after: '夜勤明け（休日数に数えない・連勤は切れない）',
};

/** 時間帯（時。to が24を超えると翌日） */
export const BANDS = [
  { key: 'morning', label: '朝', from: 7, to: 9 },
  { key: 'day', label: '昼', from: 9, to: 17 },
  { key: 'evening', label: '夕', from: 17, to: 22 },
  { key: 'night', label: '夜', from: 22, to: 31 },
];
/** 必要な人数（仮置き。オーナー判断 2026-10-20：平日 朝2・昼3・夕2・夜1／土日祝 朝2・昼2・夕2・夜1） */
export const DEFAULT_NEEDS = {
  weekday: { morning: 2, day: 3, evening: 2, night: 1 },
  holiday: { morning: 2, day: 2, evening: 2, night: 1 },
};
export const DEFAULT_RULES = { maxStreak: 5, minHolidays: 9, minRestHours: 11 };

/** 問題の種類（画面の一覧・Excel の見出し） */
export const PROBLEM_KINDS = {
  short: '人が足りない',
  hope: '希望休の日に勤務',
  unknown: '表にない記号',
  streak: '連勤',
  holidays: '月の休日数',
  interval: '勤務の間（参考）',
  hopeafter: '希望休の日が夜勤明け',
  nightoff: '夜勤の次の日の休日',
  orphan: '夜勤明けの前の日',
  blank: '空の欄',
  hopename: '希望休の氏名',
};

/** 祝日（2026・2027年。画面で足し引きできる。最新は内閣府の「国民の祝日」で確かめる） */
export const JP_HOLIDAYS = [
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23',
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03', '2027-11-23',
];

const NIGHT_END = 4 * 60; // 翌朝4時より後まで続く勤務を「夜勤」とみる（夜勤の次の日が休日だと黄）
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n) => String(n).padStart(2, '0');
/** "7:00"・"07:00" → 分。終わりの "24:00" も読む */
export const toMin = (t) => {
  const m = String(t ?? '').normalize('NFKC').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[2] >= 60) return null;
  if (+m[1] === 24 && +m[2] === 0) return 1440;
  return +m[1] < 24 ? +m[1] * 60 + +m[2] : null;
};
/** 記号をそろえる（全角半角・空白を無視） */
export const normCode = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
/** 氏名をそろえる（全角半角・空白を無視）。希望休とシフト表の氏名を比べるとき */
export const normName = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');
const daysIn = (period) => { const [y, m] = period.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** 対象の月の日付の並び。土日と祝日は「土日祝」の必要人数を使う */
export function monthDays(period, holidays = JP_HOLIDAYS) {
  const [y, m] = period.split('-').map(Number);
  const hol = new Set(holidays);
  return Array.from({ length: daysIn(period) }, (_, i) => {
    const date = `${y}-${pad(m)}-${pad(i + 1)}`;
    const wd = new Date(Date.UTC(y, m - 1, i + 1)).getUTCDay();
    const isHoliday = hol.has(date);
    return { day: i + 1, date, weekday: WEEK[wd], isHoliday, type: wd === 0 || wd === 6 || isHoliday ? 'holiday' : 'weekday' };
  });
}
export const dayLabel = (d) => `${d.day}日（${d.weekday}${d.isHoliday ? '・祝' : ''}）`;

/** 時（0〜48）→「22」「翌7」 */
const hourText = (h) => (h >= 24 ? `翌${h - 24}` : String(h));

/** 勤務の記号の時刻（分）。読めない・始まりと終わりが同じなら null（人数に数えない） */
const shiftTimes = (sym) => {
  const s = toMin(sym.start); const e = toMin(sym.end);
  if (s == null || e == null || s === 1440 || s % 1440 === e % 1440) return null;
  return { s, e: e <= s ? e + 1440 : e };
};

/** 記号の表を確かめる（記号が空・2つある・勤務なのに時刻が読めない） */
export function checkSymbols(symbols) {
  const errors = [];
  const seen = new Map();
  symbols.forEach((s, i) => {
    const code = normCode(s.code);
    if (!code) { errors.push({ index: i, field: 'code', text: `記号の表の${i + 1}行目：記号が空です` }); return; }
    if (seen.has(code)) errors.push({ index: i, field: 'code', text: `記号「${code}」が2つあります（${seen.get(code) + 1}行目と${i + 1}行目。上の行を使います）` });
    else seen.set(code, i);
    if (s.kind !== 'work') return;
    const st = toMin(s.start); const en = toMin(s.end);
    if (st == null || st === 1440) errors.push({ index: i, field: 'start', text: `記号「${code}」の始まりの時刻を読めません（人数に数えません）` });
    if (en == null) errors.push({ index: i, field: 'end', text: `記号「${code}」の終わりの時刻を読めません（人数に数えません）` });
    if (st != null && en != null && st % 1440 === en % 1440) errors.push({ index: i, field: 'end', text: `記号「${code}」の始まりと終わりが同じ時刻です（人数に数えません）` });
  });
  return errors;
}

/**
 * 希望休の貼り付けを読む。1行に「氏名,日付」。日付は「2026/11/5」「11/5」「5」のどれでも、「佐藤 花子,5,12」と続けても読む。
 * 区切りはカンマ・タブ・読点。区切りが無ければ、最後の空白の後ろを日付とみる
 * @returns {{list:{name, day}[], errors:string[]}}
 */
export function parseHopes(text, period) {
  const [y, m] = period.split('-').map(Number);
  const n = daysIn(period);
  const list = []; const errors = [];
  const dayOf = (raw) => {
    const t = String(raw ?? '').replace(/\s+/g, '');
    let r = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(\(.\))?$/);
    if (r) return +r[1] === y && +r[2] === m ? +r[3] : null;
    if ((r = t.match(/^(\d{1,2})[/.月](\d{1,2})日?(\(.\))?$/))) return +r[1] === m ? +r[2] : null;
    if ((r = t.match(/^(\d{1,2})日?(\(.\))?$/))) return +r[1];
    return null;
  };
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    const t = line.normalize('NFKC').trim();
    if (!t) return;
    let parts = t.split(/[,\t、]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 1) { const r = t.match(/^(.*\S)\s+(\S+)$/); if (r) parts = [r[1], r[2]]; }
    const [nameRaw, ...dates] = parts;
    const days = dates.map(dayOf);
    if (!nameRaw || !dates.length || days.some((d) => !d || d > n)) {
      errors.push(`${i + 1}行目「${line.trim()}」を読めません（「氏名,日付」の形で、${y}年${m}月の日付）`);
      return;
    }
    const name = nameRaw.replace(/\s+/g, ' ');
    for (const day of days) if (!list.some((x) => normName(x.name) === normName(name) && x.day === day)) list.push({ name, day });
  });
  return { list, errors };
}

/**
 * シフト表を確かめる。
 * @param grid {period:'YYYY-MM', people:[{name, cells:string[]}]}  cells[i] は (i+1)日の記号
 * @param settings {symbols, needs, rules, holidays, hopes:[{name, day}]}
 * @returns {{days, shortages, bandCount:Map, dayFlags:Map, cellFlags:Map, people, problems, count}}
 *   bandCount：`${day}|${band}` → {min, need}（その時間帯で一番少ない時の人数）
 *   cellFlags：`${人の番号}|${day}` → [{level, kind, text}]（表のマスに出す短い言葉）
 */
export function checkShift(grid, settings = {}) {
  const symbols = settings.symbols ?? DEFAULT_SYMBOLS;
  const needs = settings.needs ?? DEFAULT_NEEDS;
  const rules = { ...DEFAULT_RULES, ...(settings.rules ?? {}) };
  const days = monthDays(grid.period, settings.holidays ?? JP_HOLIDAYS);
  const N = days.length;
  const byCode = new Map();
  for (const s of symbols) { const c = normCode(s.code); if (c && !byCode.has(c)) byCode.set(c, s); }
  const problems = [];
  const cellFlags = new Map();
  const flagCell = (pi, day, level, kind, text) => {
    const k = `${pi}|${day}`;
    cellFlags.set(k, [...(cellFlags.get(k) ?? []), { level, kind, text }]);
  };
  const add = (p) => problems.push({ person: null, pi: null, day: null, ...p });

  // 1時間ごとの人数（月の初日0時から。最後の日の夜勤のために、翌日の朝まで）。その1時間ずっといる人だけ数える
  const count = new Array((N + 1) * 24).fill(0);
  const shifts = grid.people.map((p, pi) => days.map((d, di) => {
    const code = normCode(p.cells[di]);
    if (!code) return { blank: true };
    const sym = byCode.get(code);
    if (!sym) {
      flagCell(pi, d.day, 'red', 'unknown', '表にない');
      add({ level: 'red', kind: 'unknown', person: p.name, pi, day: d.day, text: `${p.name}さん ${dayLabel(d)}：記号「${code}」が記号の表にありません（人数に数えていません）` });
      return { unknown: true };
    }
    const t = sym.kind === 'work' ? shiftTimes(sym) : null;
    if (!t) return { sym };
    const start = di * 1440 + t.s; const end = di * 1440 + t.e;
    for (let h = Math.ceil(start / 60); h < Math.floor(end / 60); h++) count[h] += 1;
    return { sym, start, end };
  }));

  // 人が足りない時間帯（1時間でも足りなければ、同じ不足が続いた時間をまとめて出す）
  const shortages = [];
  const bandCount = new Map();
  const dayFlags = new Map();
  days.forEach((d, di) => {
    for (const b of BANDS) {
      const need = Math.max(0, Number(needs[d.type]?.[b.key]) || 0);
      let min = Infinity;
      let run = null;
      const flush = () => {
        if (!run) return;
        const have = need - run.short;
        const text = `${dayLabel(d)} ${b.label}の${hourText(run.from)}〜${hourText(run.to)}時：必要${need}人に${have}人（${run.short}人不足）`;
        shortages.push({ day: d.day, band: b.key, from: run.from, to: run.to, short: run.short, need, have, text });
        add({ level: 'red', kind: 'short', day: d.day, band: b.key, text });
        run = null;
      };
      for (let h = b.from; h < b.to; h++) {
        const have = count[di * 24 + h];
        min = Math.min(min, have);
        const short = need - have;
        if (short > 0 && run && run.short === short && run.to === h) run.to = h + 1;
        else { flush(); if (short > 0) run = { from: h, to: h + 1, short }; }
      }
      flush();
      bandCount.set(`${d.day}|${b.key}`, { min, need });
    }
    const mine = shortages.filter((x) => x.day === d.day);
    if (mine.length) {
      const most = Math.max(...mine.map((x) => x.short));
      dayFlags.set(d.day, { level: 'red', short: most, text: `不足${most}` });
    }
  });

  // 人ごと：連勤・休日数・希望休・勤務の間・空の欄
  const hopes = (settings.hopes ?? []).filter((x) => x.day >= 1 && x.day <= N);
  const people = grid.people.map((p, pi) => {
    const sh = shifts[pi];
    const out = { name: p.name, workDays: 0, holidays: 0, leaves: 0, afters: 0, nights: 0, maxStreak: 0, streakRuns: 0, conflicts: 0, intervals: 0, blanks: 0, unknowns: 0 };
    // 連勤：勤務の日を数える。夜勤明けは数えないが、切れない（前の夜勤の続き）。休日・有給・空・表にない記号で切れる
    let run = []; let pendingAfter = false; let withAfter = false;
    const close = () => {
      if (run.length > rules.maxStreak) {
        out.streakRuns += 1;
        add({ level: 'yellow', kind: 'streak', person: p.name, pi, day: run[0], text: `${p.name}さん：${run[0]}日〜${run.at(-1)}日に${run.length}日の勤務が続きます（${run.length}連勤${withAfter ? '・間の夜勤明けは数えていません' : ''}。上限${rules.maxStreak}日）` });
      }
      run = []; pendingAfter = false; withAfter = false;
    };
    sh.forEach((x, di) => {
      const day = di + 1;
      if (x.blank) out.blanks += 1;
      if (x.unknown) out.unknowns += 1;
      const kind = x.sym?.kind;
      // 夜勤（0時をまたぐ勤務）の次の日。前の月の最後の日は表に無いので、1日は確かめない
      // 夜勤の次の日（朝4時より後まで続く勤務）。0時台に終わる準夜などは、翌日をほぼ丸1日休めるので出さない
      const afterNight = di > 0 && sh[di - 1].end != null && sh[di - 1].end > di * 1440 + NIGHT_END;
      const overMidnight = di > 0 && sh[di - 1].end != null && sh[di - 1].end > di * 1440;
      if (kind === 'off' && afterNight) {
        flagCell(pi, day, 'yellow', 'nightoff', '夜勤の次');
        add({ level: 'yellow', kind: 'nightoff', person: p.name, pi, day, text: `${p.name}さん ${dayLabel(days[di])}：夜勤の次の日が「${normCode(x.sym.code)}」です（夜勤が朝まで続くので、丸1日の休みになりません。「明」にするか、確かめてください）` });
      }
      if (kind === 'after' && di > 0 && !overMidnight) {
        flagCell(pi, day, 'yellow', 'orphan', '前に夜勤なし');
        add({ level: 'yellow', kind: 'orphan', person: p.name, pi, day, text: `${p.name}さん ${dayLabel(days[di])}：夜勤明けですが、前の日に夜勤がありません` });
      }
      if (kind === 'work') {
        out.workDays += 1;
        const t = shiftTimes(x.sym);
        if (t && t.e > 1440) out.nights += 1;
        if (pendingAfter) { withAfter = true; pendingAfter = false; }
        run.push(day);
        out.maxStreak = Math.max(out.maxStreak, run.length);
        if (run.length > rules.maxStreak) flagCell(pi, day, 'yellow', 'streak', `${run.length}連勤`);
      } else if (kind === 'after') {
        out.afters += 1;
        if (run.length) pendingAfter = true;
      } else {
        if (kind === 'off') out.holidays += 1;
        if (kind === 'leave') out.leaves += 1;
        close();
      }
    });
    close();
    if (out.blanks) {
      const list = sh.map((x, di) => (x.blank ? di + 1 : null)).filter(Boolean);
      for (const day of list) flagCell(pi, day, 'yellow', 'blank', '空');
      add({ level: 'yellow', kind: 'blank', person: p.name, pi, day: list[0], text: `${p.name}さん：記号が空の日があります（${list.join('・')}日）` });
    }
    if (out.holidays < rules.minHolidays) {
      add({ level: 'yellow', kind: 'holidays', person: p.name, pi, text: `${p.name}さん：月の休日が${out.holidays}日です（下限${rules.minHolidays}日。有給・夜勤明けは数えません）` });
    }
    for (const hope of hopes.filter((x) => normName(x.name) === normName(p.name))) {
      const x = sh[hope.day - 1];
      const d = days[hope.day - 1];
      if (x.sym?.kind === 'work') {
        out.conflicts += 1;
        flagCell(pi, hope.day, 'red', 'hope', '希望休');
        add({ level: 'red', kind: 'hope', person: p.name, pi, day: hope.day, text: `${p.name}さん ${dayLabel(d)}：希望休の日に「${normCode(x.sym.code)}」（${x.sym.name}）が入っています` });
      } else if (x.sym?.kind === 'after') {
        flagCell(pi, hope.day, 'yellow', 'hopeafter', '希望休');
        add({ level: 'yellow', kind: 'hopeafter', person: p.name, pi, day: hope.day, text: `${p.name}さん ${dayLabel(d)}：希望休の日が夜勤明けです（前の日に夜勤が入っています）` });
      }
    }
    // 勤務と勤務の間（前の勤務の終わり → 次の勤務の始まり）。参考の表示
    let prev = null;
    sh.forEach((x, di) => {
      if (x.start == null) return;
      if (prev) {
        const gap = (x.start - prev.end) / 60;
        if (gap < rules.minRestHours) {
          out.intervals += 1;
          const g = Math.round(gap * 10) / 10;
          flagCell(pi, di + 1, 'yellow', 'interval', `間${g}時間`);
          add({ level: 'yellow', kind: 'interval', person: p.name, pi, day: di + 1, text: `${p.name}さん ${dayLabel(days[di])}：前の「${normCode(prev.sym.code)}」の終わりから${g}時間で「${normCode(x.sym.code)}」です（${rules.minRestHours}時間未満・参考）` });
        }
      }
      prev = x;
    });
    return out;
  });

  // 希望休に書いてあるのに、シフト表にいない人
  const names = new Set(grid.people.map((p) => normName(p.name)));
  const missing = [...new Set(hopes.filter((x) => !names.has(normName(x.name))).map((x) => x.name))];
  for (const name of missing) add({ level: 'yellow', kind: 'hopename', text: `希望休の「${name}」さんが、シフト表にいません（氏名の書き方を確かめてください）` });

  // 一覧の並び：赤 → 黄、日付順（日の無いものは後ろ）。同じなら見つけた順
  const order = { red: 0, yellow: 1 };
  problems.forEach((p, i) => { p.seq = i; });
  problems.sort((a, b) => order[a.level] - order[b.level] || (a.day ?? 99) - (b.day ?? 99) || a.seq - b.seq);
  return { days, shortages, bandCount, dayFlags, cellFlags, people, problems, count };
}

export const worstOf = (flags = []) => (flags.some((f) => f.level === 'red') ? 'red' : flags.some((f) => f.level === 'yellow') ? 'yellow' : null);

// ---- 表（CSV・Excel）から読む -------------------------------------------------------------

const NAME_HEAD_EXACT = /^(氏名|名前)$/;
const NAME_HEAD = /^(氏名|名前|職員名?|スタッフ名?|従業員名?)$/;
const NAME_HEAD_LOOSE = /氏名|名前/;
const clean = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, '');

/** 見出しの行と、氏名の列 */
function findHeader(rows) {
  for (const re of [NAME_HEAD_EXACT, NAME_HEAD, NAME_HEAD_LOOSE]) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const c = rows[r].findIndex((v) => !(v instanceof Date) && re.test(clean(v)));
      if (c >= 0) return { head: r, nameCol: c };
    }
  }
  return null;
}

/** シフト表の見出し（「氏名」の列）がある表か（Excel のシートを選ぶとき） */
export const hasShiftHeader = (rows) => findHeader(rows) != null;

/** 表の見出し・題名から、対象の年月を探す（2026/11/1・Excel の日付・「2026年11月」）。無ければ null */
export function detectPeriod(rows) {
  const f = findHeader(rows);
  const cells = rows.slice(0, (f?.head ?? 4) + 1).flat();
  const ok = (m) => +m >= 1 && +m <= 12;
  // 題名の「2026年11月」を先に。次に Excel の日付・「2026/11/1」（「作成日 2026/10/20」などは年月とみない）
  for (const v of cells) {
    const r = clean(v).match(/(20\d{2})年(\d{1,2})月/);
    if (r && ok(r[2])) return `${r[1]}-${pad(+r[2])}`;
  }
  for (const v of cells) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}`;
    const t = clean(v);
    if (/作成|印刷|更新|出力|提出|発行|記入/.test(t)) continue;
    const r = t.match(/(20\d{2})[-/.](\d{1,2})[-/.]\d{1,2}/);
    if (r && ok(r[2])) return `${r[1]}-${pad(+r[2])}`;
  }
  return null;
}

const MAX_PEOPLE = 200;

/**
 * 表（行の配列）からシフト表を読む。見出しの行：「氏名」の列と、日付の列（1〜31・1日・1(日)・11/1・2026/11/1・Excel の日付）。
 * 曜日の行・人数の集計の行（数だけの行）・記号が1つも無い行は読み飛ばす（知らせる）
 * @param rows 文字・数・Date の2次元配列（CSV か Excel のシートを読んだもの）
 * @returns {{grid:{period, people}, errors:string[], notes:string[]}}
 */
export function readShiftTable(rows, period) {
  const errors = []; const notes = [];
  const [y, m] = period.split('-').map(Number);
  const N = daysIn(period);
  const empty = { period, people: [] };
  const f = findHeader(rows);
  if (!f) return { grid: empty, errors: ['見出しの行（「氏名」の列）が見つかりません'], notes };
  const header = rows[f.head];
  const dayCol = new Map();
  const extraDays = []; // この月に無い日（31日の列など）
  header.forEach((c, i) => {
    if (i === f.nameCol) return;
    let d = null;
    if (c instanceof Date) { if (c.getUTCFullYear() === y && c.getUTCMonth() + 1 === m) d = c.getUTCDate(); } else {
      const t = clean(c);
      let r;
      if ((r = t.match(/^(\d{1,2})日?(\(.\))?$/))) { d = +r[1]; if (d > N && d <= 31) extraDays.push(d); }
      else if ((r = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(\(.\))?$/))) d = +r[1] === y && +r[2] === m ? +r[3] : null;
      else if ((r = t.match(/^(\d{1,2})[/.月](\d{1,2})日?(\(.\))?$/))) d = +r[1] === m ? +r[2] : null;
    }
    if (d && d <= N && !dayCol.has(d)) dayCol.set(d, i);
  });
  if (dayCol.size === 0) return { grid: empty, errors: [`${y}年${m}月の日付の列が見つかりません（見出しの行に 1〜${N} か日付を入れてください）`], notes };
  const missing = Array.from({ length: N }, (_, i) => i + 1).filter((d) => !dayCol.has(d));
  if (missing.length) errors.push(`日付の列が無い日があります：${missing.join('・')}日（空として扱います）`);
  if (extraDays.length) errors.push(`表に${[...new Set(extraDays)].join('・')}日の列がありますが、${y}年${m}月は${N}日までです（その列は読んでいません。対象の年月は合っていますか）`);
  const people = [];
  const skippedTotals = []; const skippedEmpty = []; const skippedNoName = [];
  const rowNo = (r) => rows.indexOf(r) + 1;
  for (const r of rows.slice(f.head + 1)) {
    const name = String(r[f.nameCol] ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const cells = Array.from({ length: N }, (_, i) => (dayCol.has(i + 1) ? String(r[dayCol.get(i + 1)] ?? '').normalize('NFKC').trim() : ''));
    const filled = cells.filter(Boolean);
    if (!name) { if (filled.length) skippedNoName.push(`${rowNo(r)}`); continue; }
    if (/^曜/.test(clean(name))) continue; // 曜日の行
    if (!filled.length) { skippedEmpty.push(name); continue; }
    // 集計の行：数だけ・数と「-」だけの行、氏名が「合計」「○の人数」などの行
    if (filled.every((v) => /^[\d.\-－ー]+$/.test(v)) || /^(合計|総計|小計|計|人数|.*の人数|.*人数計)$/.test(clean(name))) { skippedTotals.push(name); continue; }
    people.push({ name, cells });
  }
  if (skippedTotals.length) notes.push(`人数の集計の行（数だけの行・「合計」「○の人数」の行）は読み飛ばしました：${skippedTotals.join('・')}`);
  if (skippedNoName.length) notes.push(`氏名が空で、記号が入っている行を読み飛ばしました（${skippedNoName.join('・')}行目）。氏名を入れて読み込み直してください`);
  if (skippedEmpty.length) notes.push(`記号が1つも無い行を読み飛ばしました：${skippedEmpty.join('・')}`);
  if (people.length > MAX_PEOPLE) { notes.push(`${people.length}人のうち、上から${MAX_PEOPLE}人を読みました`); people.length = MAX_PEOPLE; }
  if (!people.length) errors.push('氏名と記号の入った行がありません');
  return { grid: { period, people }, errors, notes };
}
