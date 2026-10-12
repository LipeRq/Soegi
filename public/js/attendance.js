// 労務デモ：打刻データ → 残業の集計。CSVはブラウザの中だけで計算する（AIも通信も使わない）。
// 写真（副）だけ、AIで読み取って表にし、確認・修正してから同じ計算に渡す。
import {
  requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, pool, setStep, mountRoi,
} from './common.js';
import { MENUS } from './pricing.js';
import { toJpeg } from './image.js';
import { decodeCsvBytes, parseCsv, guessColumns, toRecords } from './csv.js';
import {
  calculate, DEFAULT_SETTINGS, LIMITS, STATUS_TEXT, WEEKDAY_LABELS, fmtHM, fmtClock,
} from './overtime.js';
import { buildAttendanceWorkbook } from './attendance-xlsx.js';
import { reduced, countUp, stagger, replay, flash, onVisible } from './motion.js';

requireAuth();
const $ = (id) => document.getElementById(id);

let minutesPerPerson = 15; // 手計算なら1人あたり何分か（仮置き・画面で変えられる）
let elapsedMs = null;
const roi = mountRoi($('roi'), {
  unit: '人', countLabel: '毎月、何人分の勤怠を集計していますか？', count: 20,
  minutesLabel: '1人分の手計算にかかる時間（仮置き）', minutes: minutesPerPerson, monthlyFee: MENUS.manual.monthly,
});

const FIELDS = [['name', '氏名'], ['date', '日付'], ['start', '出勤'], ['end', '退勤'], ['breakMin', '休憩（分）']];
const STATUS_BADGE = { yellow: '黄', orange: '橙', red: '赤' };
// 横棒の印に添える短い言葉（色の名前だけでは伝わりにくいので、何時間の線を越えたかも書く。数字は判定と同じ LIMITS から作る）
const STATUS_SHORT = { yellow: `${LIMITS.yellowOver / 60}時間超`, orange: `${LIMITS.orange / 60}時間以上`, red: `${LIMITS.red / 60}時間以上` };
// 「動きを減らす」設定の人には、なめらかなスクロールもしない
const scrollBehavior = () => (reduced() ? 'auto' : 'smooth');

let csvRows = null; // 読み込んだCSV（見出しを含む）
let mapping = null;
let photoRecords = []; // 写真から読み取った行
let source = 'csv';
let result = null;
let periodKey = null;
let selectedName = null;

// ---- 締め日の選択肢 ----------------------------------------------------------------

const closeSel = $('s-close');
closeSel.append(h('option', { value: 'end', selected: true }, '月末'));
for (let d = 5; d <= 28; d += 1) closeSel.append(h('option', { value: String(d) }, `${d}日`));

// ---- タブ ---------------------------------------------------------------------------

function setTab(which) {
  source = which;
  $('tab-csv').setAttribute('aria-selected', String(which === 'csv'));
  $('tab-photo').setAttribute('aria-selected', String(which === 'photo'));
  $('pane-csv').hidden = which !== 'csv';
  $('pane-photo').hidden = which !== 'photo';
  updateCalcState();
}
$('tab-csv').addEventListener('click', () => setTab('csv'));
$('tab-photo').addEventListener('click', () => setTab('photo'));

// ---- CSV ----------------------------------------------------------------------------

function loadCsvBuffer(buf, label) {
  const rows = parseCsv(decodeCsvBytes(buf));
  if (rows.length < 2) { alert('データの行が見つかりませんでした。'); return; }
  csvRows = rows;
  mapping = guessColumns(rows[0]);
  $('csvinfo').textContent = `${label}：${rows.length - 1}行を読み込みました。列の対応を確認してください。`;
  renderMapping();
  stagger($('preview').tBodies[0]); // 読み込んだ行が、上から順に入ってくる
  if (!$('mapbox').hidden) flash($('csvinfo')); // 読み込み直したときは、変わった所を光らせる
  $('mapbox').hidden = false;
  updateCalcState();
}

function renderMapping() {
  const grid = clear($('mapgrid'));
  for (const [key, label] of FIELDS) {
    const sel = h('select', { onchange: (e) => { mapping[key] = Number(e.target.value); renderPreview(); updateCalcState(); } },
      h('option', { value: '-1' }, key === 'breakMin' ? '（なし：既定値を使う）' : '（選択してください）'),
      csvRows[0].map((name, i) => h('option', { value: String(i), selected: mapping[key] === i }, name || `列${i + 1}`)));
    grid.append(h('label', {}, label, sel));
  }
  renderPreview();
}

function renderPreview() {
  const t = clear($('preview'));
  t.append(h('thead', {}, h('tr', {}, FIELDS.map(([, l]) => h('th', {}, l)))));
  const body = h('tbody');
  for (const r of csvRows.slice(1, 6)) {
    body.append(h('tr', {}, FIELDS.map(([k]) => h('td', {}, mapping[k] >= 0 ? (r[mapping[k]] ?? '') : ''))));
  }
  t.append(body);
}

$('csvfile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) loadCsvBuffer(await f.arrayBuffer(), f.name);
});
$('sample').addEventListener('click', async () => {
  const res = await fetch('/sample/attendance-sample-2026-09.csv');
  loadCsvBuffer(await res.arrayBuffer(), 'サンプル（架空の5人×2026年9月）');
});

// ---- 写真（副） ---------------------------------------------------------------------

let photoFiles = [];
const lastMonth = new Date(); lastMonth.setDate(1); lastMonth.setMonth(lastMonth.getMonth() - 1);
$('period').value = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

$('photofile').addEventListener('change', (e) => {
  photoFiles = [...e.target.files].filter((f) => f.type.startsWith('image/')).slice(0, 10);
  e.target.value = '';
  $('ptext').textContent = photoFiles.length ? `${photoFiles.length}枚を選びました` : '';
  $('readphotos').disabled = photoFiles.length === 0;
});

$('readphotos').addEventListener('click', async () => {
  $('readphotos').disabled = true;
  $('pprog').hidden = false;
  let done = 0; const failed = [];
  const out = new Array(photoFiles.length);
  const upd = () => { $('pbar').style.width = `${(done / photoFiles.length) * 100}%`; $('ptext').textContent = `${done} / ${photoFiles.length} 枚を読み取りました`; };
  upd();
  await pool(photoFiles, 3, async (f, i) => {
    try {
      const { base64 } = await toJpeg(f);
      out[i] = await api('/api/timecard', { image: base64, period: $('period').value });
    } catch (e) { failed.push(`${f.name}：${e.message}`); }
    done++; upd();
  });
  for (const d of out) {
    if (!d) continue;
    for (const e of d.entries) {
      photoRecords.push({ name: d.employee_name, date: e.date, start: e.start, end: e.end, breakMin: e.break_min ?? '' });
    }
  }
  $('pprog').hidden = true;
  if (failed.length) $('ptext').textContent = `読み取れなかった写真：${failed.join(' ／ ')}`;
  $('readphotos').disabled = false;
  renderPhotoRows();
});

function renderPhotoRows() {
  $('photobox').hidden = false;
  const body = clear($('photorows'));
  photoRecords.forEach((r, i) => {
    const cell = (k, w) => h('td', {}, h('input', { type: 'text', value: r[k] ?? '', style: { minWidth: `${w}px` }, oninput: (e) => { r[k] = e.target.value; updateCalcState(); } }));
    body.append(h('tr', {}, cell('name', 110), cell('date', 110), cell('start', 70), cell('end', 70), cell('breakMin', 70),
      h('td', {}, h('button', { type: 'button', class: 'small', onclick: () => { photoRecords.splice(i, 1); renderPhotoRows(); } }, '削除'))));
  });
  updateCalcState();
}
$('addrow').addEventListener('click', () => { photoRecords.push({ name: photoRecords.at(-1)?.name ?? '', date: '', start: '', end: '', breakMin: '' }); renderPhotoRows(); });

// ---- 計算 ---------------------------------------------------------------------------

function currentRecords() {
  if (source === 'photo') return photoRecords.map((r, i) => ({ ...r, row: i + 1 }));
  if (!csvRows) return [];
  return toRecords(csvRows, mapping, true);
}

function updateCalcState() {
  const ready = source === 'csv'
    ? csvRows && mapping.name >= 0 && mapping.date >= 0 && mapping.start >= 0 && mapping.end >= 0
    : photoRecords.length > 0;
  $('calc').disabled = !ready;
  $('calc-hint').textContent = ready ? '' : (source === 'csv' ? '先にCSVを選んでください（氏名・日付・出勤・退勤の列が必要です）' : '先に写真を読み取ってください');
}

function readSettings() {
  const sched = Number($('s-sched').value); const br = Number($('s-break').value);
  return {
    scheduledMin: Number.isFinite(sched) && sched > 0 ? Math.round(sched * 60) : DEFAULT_SETTINGS.scheduledMin,
    defaultBreakMin: Number.isFinite(br) && br >= 0 ? Math.round(br) : DEFAULT_SETTINGS.defaultBreakMin,
    holidayWeekday: Number($('s-holiday').value),
    closeDay: closeSel.value === 'end' ? 'end' : Number(closeSel.value),
  };
}

$('calc').addEventListener('click', () => {
  const t0 = performance.now();
  result = calculate(currentRecords(), readSettings());
  elapsedMs = performance.now() - t0;
  $('result').hidden = false;
  $('step3').hidden = false;
  setStep(2);
  if (!result.periods.length) {
    periodKey = null;
    renderErrors();
    clear($('bars')); clear($('summary-table')); clear($('detail')); clear($('stats')); clear($('who')); $('detail-title').textContent = '';
    $('chart').hidden = true; $('daily').hidden = true;
    $('export').disabled = true;
    $('step3').hidden = true;
    return;
  }
  $('export').disabled = false;
  $('chart').hidden = false; $('daily').hidden = false;
  const sel = clear($('period-select'));
  result.periods.forEach((p) => sel.append(h('option', { value: p.key }, p.label)));
  // 人数の多い期間を既定に
  periodKey = result.periods.reduce((a, b) => (b.people.length >= a.people.length ? b : a)).key;
  sel.value = periodKey;
  $('period-label').hidden = result.periods.length < 2;
  selectedName = null;
  render();
  $('result').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
});
$('period-select').addEventListener('change', (e) => { periodKey = e.target.value; selectedName = null; render(); });

const period = () => result.periods.find((p) => p.key === periodKey);

function renderErrors() {
  const box = clear($('errors'));
  if (!result.errors.length) return;
  const hard = result.errors.filter((e) => !e.warning).length;
  box.append(h('div', { class: 'notice' },
    `${hard ? `${hard}行は読み取れず、計算に入れていません。` : ''}${result.errors.length - hard ? `${result.errors.length - hard}件の注意があります。` : ''}`,
    h('ul', { class: 'errs' }, result.errors.slice(0, 20).map((e) => h('li', {}, `${e.row}行目：${e.message}`))),
    result.errors.length > 20 ? `ほか${result.errors.length - 20}件` : null));
}

function renderStats(p) {
  const box = clear($('stats'));
  // 数字は0から数え上げる。終わりの表示は、数え上げない場合とまったく同じ文字になる。
  // Text ノードにも textContent があるので、単位の <small> を消さずに数字だけを動かせる
  const exact = (to) => (n) => (n === to ? String(to) : String(Math.round(n)));
  const num = (to) => { const t = document.createTextNode('0'); countUp(t, to, { format: exact(to) }); return t; };
  const stat = (label, value, unit, cls = '', extra = null) => h('div', { class: `stat ${cls}` }, h('span', {}, label), h('b', {}, value, h('small', {}, unit)), extra);
  const near = p.people.filter((x) => x.status !== 'none').length;
  const manual = num(p.people.length * minutesPerPerson);
  const mins = h('input', {
    type: 'number', min: '0', max: '120', step: '1', value: String(minutesPerPerson), inputMode: 'numeric', 'aria-label': '1人分の手計算の分',
    onchange: (e) => {
      // 表を作り直さず、変わった数字だけを前の値から動かす（ほかの数字まで数え直すと、何が変わったか分からなくなる）
      const before = p.people.length * minutesPerPerson;
      minutesPerPerson = Math.max(0, Number(e.target.value) || 0); roi.setMinutes(minutesPerPerson);
      e.target.value = String(minutesPerPerson);
      const to = p.people.length * minutesPerPerson;
      countUp(manual, to, { from: before, format: exact(to) });
      flash(manual.parentElement);
    },
  });
  box.append(
    stat('集計した人数', num(p.people.length), '人', 'quiet'),
    stat('打刻の行数', num(p.people.reduce((t, x) => t + x.days.length, 0)), '行', 'quiet'),
    // 「プログラムなら／手計算なら」を1つの面に並べて、比べて読めるようにする。かかった時間は測ったままを出す（動かさない）
    h('div', { class: 'vs' },
      stat('計算にかかった時間', elapsedMs < 1000 ? '1秒未満' : (elapsedMs / 1000).toFixed(1), elapsedMs < 1000 ? '' : '秒', 'good'),
      stat('手計算なら約', manual, '分', '', h('em', {}, h('span', { class: 'nw' }, '1人 ', mins, ' 分'), '（仮置き）'))),
    // 上限に近い人の数は、安全の表示なので数え上げない（0 → 1 → 2 と増えると、横棒の印とずれる）。はじめから本当の数を出す
    stat('上限に近い人（黄・橙・赤）', String(near), '人', near ? 'warn' : ''),
  );
  stagger(box);
}

function render() {
  renderErrors();
  const p = period();
  renderStats(p);
  selectedName = selectedName ?? p.people[0]?.name;
  renderBars(p);
  renderSummary(p);
  renderWho(p);
  renderDetail(p);
}

// 横棒は、見える所に来てから伸ばす（スマホでは計算の直後は画面の外にあるため。見えない所で伸び終わると意味がない）
let stopWaitingBars = () => {};
function playBars(box, counts) {
  stopWaitingBars();
  const go = () => { box.classList.remove('wait'); replay(box); counts.forEach((f) => f()); };
  const r = box.getBoundingClientRect();
  if (reduced() || (r.top < window.innerHeight && r.bottom > 0)) { go(); return; }
  box.classList.add('wait'); // 伸びる前の形で待つ（数字と判定の印は、待っている間も出ている）
  stopWaitingBars = onVisible(box, go, { threshold: 0 });
}

function renderBars(p) {
  const max = Math.max(LIMITS.red * 1.08, ...p.people.map((x) => x.overPlusHolidayMin));
  const pct = (m) => `${(m / max) * 100}%`;
  const axis = clear($('axis'));
  for (const [m, label] of [[0, '0'], [LIMITS.yellowOver, '45h'], [LIMITS.orange, '80h'], [LIMITS.red, '100h']]) {
    axis.append(h('span', { style: { left: pct(m) } }, label));
  }
  const box = clear($('bars'));
  // 棒の背景の色分け（style.css の .track）を、点線・目盛りと同じ位置に合わせる。目盛りの幅は人によって変わるので毎回入れる
  box.style.setProperty('--z45', pct(LIMITS.yellowOver));
  box.style.setProperty('--z80', pct(LIMITS.orange));
  box.style.setProperty('--z100', pct(LIMITS.red));
  const counts = [];
  p.people.forEach((x, n) => {
    const order = Math.min(n, 12); // 上から順に伸びる。人数が多いときは、13人目から先は待たせない
    const seg = (cls, m, title) => {
      const el = h('div', { class: `seg grow ${cls}`, style: { width: pct(m) }, title });
      el.style.setProperty('--i', String(order));
      return el;
    };
    // 棒が伸びるのに合わせて、時間の数字も数え上げる（終わりは fmtHM の表示と同じ）。
    // 黄・橙・赤の人は、印が先に出ているので数え上げない（印より小さい数字が並ぶのを避ける）
    const hm = (min) => {
      const t = document.createTextNode(fmtHM(min));
      if (x.status === 'none') counts.push(() => countUp(t, min, { duration: 900 + order * 70, format: (v) => fmtHM(Math.round(v)) }));
      return t;
    };
    const track = h('div', { class: 'track' },
      seg(`hol ${x.status}`, x.overPlusHolidayMin, '休日労働を含む'),
      seg(x.status, x.overMin),
      h('span', { class: 'mark m45', style: { left: pct(LIMITS.yellowOver) } }),
      h('span', { class: 'mark m80', style: { left: pct(LIMITS.orange) } }),
      h('span', { class: 'mark m100', style: { left: pct(LIMITS.red) } }));
    box.append(h('button', {
      type: 'button', class: `bar-row ${x.status}`, dataset: { name: x.name }, 'aria-pressed': String(x.name === selectedName),
      onclick: () => { select(x.name); revealDetail(); },
    },
    h('span', { class: 'bar-name' }, x.name),
    track,
    h('span', { class: 'bar-val' },
      h('span', { class: 'hm' }, '時間外 ', hm(x.overMin), x.holidayMin ? [' ＋ 休日 ', hm(x.holidayMin)] : null, ' '),
      x.status !== 'none' ? h('span', { class: `badge ${x.status}` }, STATUS_BADGE[x.status], h('small', {}, STATUS_SHORT[x.status])) : null,
      x.streakFlag ? h('span', { class: 'badge streak' }, `${x.maxStreak}連勤`) : null)));
  });
  playBars(box, counts);
}

// ---- 人を選ぶ（横棒からも、日別表の上の名前からも選べる） -----------------------------

function select(name) {
  selectedName = name;
  // 横棒は作り直さない（作り直すと、押すたびに全部の棒が伸び直してしまう）。選んだ印だけを付け替える
  for (const b of document.querySelectorAll('#bars .bar-row, #who button')) b.setAttribute('aria-pressed', String(b.dataset.name === name));
  const who = $('who');
  const chip = who.querySelector('[aria-pressed=true]');
  if (chip && (chip.offsetLeft < who.scrollLeft || chip.offsetLeft + chip.offsetWidth > who.scrollLeft + who.clientWidth)) who.scrollLeft = chip.offsetLeft - 8;
  renderDetail(period());
  flash($('detail-title')); // 日別表が入れ替わったことを、見出しを光らせて知らせる
}

/** 日別表を見える所へ。すでに画面の上半分に見えているときは動かさない */
function revealDetail() {
  const el = $('daily');
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight * 0.5) return;
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

function renderWho(p) {
  const box = clear($('who'));
  for (const x of p.people) {
    box.append(h('button', { type: 'button', dataset: { name: x.name }, 'aria-pressed': String(x.name === selectedName), onclick: () => select(x.name) },
      x.name, x.status !== 'none' ? h('span', { class: `badge ${x.status}` }, STATUS_BADGE[x.status]) : null));
  }
}

function renderSummary(p) {
  const t = clear($('summary-table'));
  t.append(h('thead', {}, h('tr', {}, ['氏名', '出勤日数', '実労働', '時間外', '深夜', '休日労働', '時間外＋休日', '週40h超（参考）', '連続勤務', '判定'].map((l, i) => h('th', { class: i && i < 9 ? 'num' : '' }, l)))));
  const body = h('tbody');
  for (const x of p.people) {
    const td = (label, v, cls = '') => h('td', { dataset: { label }, class: cls }, v);
    body.append(h('tr', {},
      td('氏名', x.name), td('出勤日数', `${x.workDays}日`, 'num'), td('実労働', fmtHM(x.workMin), 'num'), td('時間外', fmtHM(x.overMin), 'num'),
      td('深夜', fmtHM(x.nightMin), 'num'), td('休日労働', fmtHM(x.holidayMin), 'num'), td('時間外＋休日', fmtHM(x.overPlusHolidayMin), 'num'),
      td('週40h超（参考）', fmtHM(x.weeklyOverMin), 'num'),
      td('連続勤務', x.streakFlag ? h('span', { class: 'badge streak' }, `${x.maxStreak}日（6日以上）`) : `${x.maxStreak}日`, 'num'),
      td('判定', x.status === 'none' ? '—' : h('span', { class: `badge ${x.status}` }, STATUS_TEXT[x.status]))));
  }
  t.append(body);
}

function renderDetail(p) {
  const x = p.people.find((q) => q.name === selectedName) ?? p.people[0];
  const t = clear($('detail'));
  if (!x) { $('detail-title').textContent = ''; return; }
  $('detail-title').textContent = `${x.name} さんの日別（${p.label}）`;
  t.append(h('thead', {}, h('tr', {}, ['日付', '曜日', '出勤', '退勤', '休憩', '実労働', '時間外', '深夜', '休日労働', '備考'].map((l) => h('th', {}, l)))));
  const body = h('tbody');
  for (const d of x.days) {
    const notes = [d.crossesMidnight ? '日またぎ' : '', d.isHoliday ? '法定休日' : '', d.breakDefaulted ? '休憩は既定値' : '', d.streak >= 6 ? `${d.streak}連勤の一部` : ''].filter(Boolean).join('・');
    const td = (label, v, cls = '') => h('td', { dataset: { label }, class: cls }, v);
    body.append(h('tr', { class: d.isHoliday ? 'holiday' : '' },
      td('日付', d.date), td('曜日', WEEKDAY_LABELS[d.weekday]), td('出勤', fmtClock(d.start)), td('退勤', `${d.end >= 1440 ? '翌' : ''}${fmtClock(d.end)}`),
      td('休憩', `${d.breakMin}分`), td('実労働', fmtHM(d.workMin)), td('時間外', d.overMin ? fmtHM(d.overMin) : '—'),
      td('深夜', d.nightMin ? fmtHM(d.nightMin) : '—'), td('休日労働', d.holidayMin ? fmtHM(d.holidayMin) : '—'), td('備考', notes)));
  }
  t.append(stagger(body, 10)); // 日ごとの行が、上から順に入ってくる
}

// ---- Excel --------------------------------------------------------------------------

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const wb = buildAttendanceWorkbook(window.ExcelJS, period(), result.settings);
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), `残業の集計_${period().key.replace('-', '')}_${stamp()}.xlsx`);
  setStep(4);
});

updateCalcState();
setStep(1);
