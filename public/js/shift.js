// 労務デモ：シフト表のチェック。ファイルは画面の中だけで読み、判定は shift-check.js（AIも通信も使わない）。
// 表のマスを直すと、その場で確かめ直す（同じ表なら、毎回同じ結果）。
import { requireAuth, h, clear, downloadBlob, XLSX_MIME, stamp, setStep } from './common.js';
import { mountEstimate } from './estimate-ui.js';
import { defaultValues } from './estimate.js';
import { decodeCsvBytes, parseCsv } from './csv.js';
import {
  DEFAULT_SYMBOLS, DEFAULT_NEEDS, DEFAULT_RULES, BANDS, KINDS, KIND_LABEL, PROBLEM_KINDS, JP_HOLIDAYS,
  checkShift, checkSymbols, parseHopes, readShiftTable, detectPeriod, hasShiftHeader, monthDays, dayLabel, normCode, worstOf,
} from './shift-check.js';
import { sheetRows, buildShiftWorkbook } from './shift-xlsx.js';
import { reduced, stagger, flash, replay } from './motion.js';

requireAuth();
const $ = (id) => document.getElementById(id);
const scrollBehavior = () => (reduced() ? 'auto' : 'smooth');
const ym = (v) => `${+v.slice(0, 4)}年${+v.slice(5, 7)}月`;
const LEVEL_TEXT = { red: '要確認', yellow: '注意' };
const KIND_SHORT = { off: '休日', leave: '休日に数えない', after: '休日に数えない' };

// 目で確かめると1つのシフト表に何分か（仮置き）。上の大きな数字と下の「御社の場合」で同じ値を使う
let manualMin = defaultValues('shift').before;
const est = mountEstimate($('estimate'), {
  keys: ['shift'],
  onChange: (_, v) => { if (v.before !== manualMin) { manualMin = v.before; if (result) renderStats(false); } },
});

let rawRows = null; // 読み込んだ表（行の配列）。年月を変えたら読み直す
let label = '';
let title = ''; // Excel の題名に入れる（見本なら施設の名前、手元のファイルならファイルの名前）
let grid = null; // いまの表（マスを直すと変わる）
let edited = false;
let symbols = structuredClone(DEFAULT_SYMBOLS);
let result = null;
let lastSettings = null;
let elapsedMs = 0;
let built = null; // 表を作ったときの grid と記号（違えば作り直す）

// ---- 対象の年月・祝日 ---------------------------------------------------------------

const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
$('period').value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;

/** その月の祝日を「3・23」の形で入れる */
function fillHolidays() {
  const p = $('period').value;
  $('r-hol').value = JP_HOLIDAYS.filter((d) => d.startsWith(`${p}-`)).map((d) => String(+d.slice(8))).join('・');
}
/** 「3・23」「3,23」 → その月の日付 */
function readHolidays() {
  const p = $('period').value;
  const n = monthDays(p, []).length;
  return [...new Set(String($('r-hol').value).normalize('NFKC').split(/[^\d]+/).filter(Boolean).map(Number).filter((d) => d >= 1 && d <= n))]
    .map((d) => `${p}-${String(d).padStart(2, '0')}`);
}
fillHolidays();

// ---- 設定：記号の表 ------------------------------------------------------------------

function renderSymbols() {
  const body = clear($('symrows'));
  const errs = checkSymbols(symbols);
  symbols.forEach((s, i) => {
    const bad = (f) => errs.some((e) => e.index === i && e.field === f);
    const cell = (labelText, field, input) => h('td', { dataset: { label: labelText }, class: bad(field) ? 'red' : '' }, input);
    const set = (k) => (e) => { s[k] = e.target.value; symbolsChanged(); };
    const work = s.kind === 'work';
    body.append(h('tr', {},
      cell('記号', 'code', h('input', { type: 'text', value: s.code, maxLength: 4, 'aria-label': `${i + 1}行目の記号`, onchange: set('code') })),
      cell('名前', 'name', h('input', { type: 'text', value: s.name, 'aria-label': `${i + 1}行目の名前`, onchange: set('name') })),
      cell('始まり', 'start', h('input', { type: 'time', value: s.start, disabled: !work, 'aria-label': `${i + 1}行目の始まり`, onchange: set('start') })),
      cell('終わり', 'end', h('input', { type: 'time', value: s.end, disabled: !work, 'aria-label': `${i + 1}行目の終わり`, onchange: set('end') })),
      cell('種類', 'kind', h('select', { 'aria-label': `${i + 1}行目の種類`, onchange: (e) => { s.kind = e.target.value; symbolsChanged(true, i); } },
        KINDS.map((k) => h('option', { value: k, selected: s.kind === k }, KIND_LABEL[k])))),
      h('td', { class: 'nolabel' }, h('button', {
        type: 'button', class: 'small', 'aria-label': `記号「${s.code}」を外す`,
        onclick: () => { symbols.splice(i, 1); symbolsChanged(true, Math.min(i, symbols.length - 1)); },
      }, '外す'))));
  });
  const list = clear($('symerrs'));
  for (const e of errs) list.append(h('li', { class: 'flag red' }, e.text));
}
/** @param rebuild 表を作り直す（種類を変えた・外した）。focusRow：作り直したあと、キーボードの位置を戻す行 */
function symbolsChanged(rebuild = false, focusRow = null) {
  if (rebuild) {
    renderSymbols();
    if (focusRow != null) (($('symrows').children[focusRow]?.querySelector('select')) ?? $('addsym')).focus();
  } else {
    // 入力欄は作り直さない（打っている途中の位置を保つ）。赤の印と、下の指摘だけを直す
    const errs = checkSymbols(symbols);
    [...$('symrows').children].forEach((tr, i) => {
      for (const td of tr.querySelectorAll('td[data-label]')) {
        const f = { 記号: 'code', 始まり: 'start', 終わり: 'end' }[td.dataset.label];
        td.classList.toggle('red', Boolean(f) && errs.some((e) => e.index === i && e.field === f));
      }
    });
    const list = clear($('symerrs'));
    for (const e of errs) list.append(h('li', { class: 'flag red' }, e.text));
  }
  renderSymLegend();
  if (result) recheck({ announce: true });
}
$('addsym').addEventListener('click', () => {
  symbols.push({ code: '', name: '', start: '09:00', end: '17:00', kind: 'work' });
  renderSymbols();
  $('symrows').lastElementChild?.querySelector('input')?.focus();
});

/** 表の上の、記号の説明（早＝早番 7:00〜16:00 …） */
function renderSymLegend() {
  const t = (v) => String(v).replace(/^0/, '');
  $('symlegend').textContent = symbols.filter((s) => normCode(s.code))
    .map((s) => `${normCode(s.code)}＝${s.name || '（名前なし）'}${s.kind === 'work' ? (s.start && s.end ? ` ${t(s.start)}〜${t(s.end)}` : '') : `（${KIND_SHORT[s.kind]}）`}`).join('　');
}

// ---- 設定：必要な人数・決まり ----------------------------------------------------------

(function renderNeeds() {
  const t = $('needs');
  const to = (b) => (b.to > 24 ? `翌${b.to - 24}` : b.to);
  t.append(h('thead', {}, h('tr', {}, h('th', {}, ''), BANDS.map((b) => h('th', {}, `${b.label}（${b.from}〜${to(b)}時）`)))));
  const body = h('tbody');
  for (const [type, name] of [['weekday', '平日'], ['holiday', '土日祝']]) {
    body.append(h('tr', {}, h('th', { scope: 'row' }, name), BANDS.map((b) => h('td', {}, h('input', {
      type: 'number', min: '0', max: '50', step: '1', inputMode: 'numeric', id: `need-${type}-${b.key}`, value: String(DEFAULT_NEEDS[type][b.key]),
      'aria-label': `${name}の${b.label}（${b.from}〜${to(b)}時）の必要な人数`,
    })))));
  }
  t.append(body);
}());

function readSettings() {
  const num = (id, def, min, max) => {
    const raw = $(id).value; const n = Number(raw);
    return raw !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  const needs = {};
  for (const type of ['weekday', 'holiday']) needs[type] = Object.fromEntries(BANDS.map((b) => [b.key, Math.round(num(`need-${type}-${b.key}`, DEFAULT_NEEDS[type][b.key], 0, 50))]));
  return {
    symbols: symbols.map((s) => ({ ...s })),
    needs,
    rules: {
      maxStreak: Math.round(num('r-streak', DEFAULT_RULES.maxStreak, 1, 31)),
      minHolidays: Math.round(num('r-holidays', DEFAULT_RULES.minHolidays, 0, 31)),
      minRestHours: num('r-rest', DEFAULT_RULES.minRestHours, 0, 24),
    },
    holidays: readHolidays(),
    hopes: parseHopes($('hopes').value, $('period').value).list,
  };
}

// 設定を変えたら、確かめ直す
for (const el of document.querySelectorAll('#needs input, #r-streak, #r-holidays, #r-rest, #r-hol')) {
  el.addEventListener('change', () => { if (result) recheck({ announce: true }); });
}

// ---- 希望休 --------------------------------------------------------------------------

let hopeTimer = 0;
function showHopes() {
  const { list, errors } = parseHopes($('hopes').value, $('period').value);
  const msg = $('hopemsg');
  msg.classList.toggle('bad', errors.length > 0);
  msg.textContent = errors.length ? `${errors.join('／')}（この行は使いません）` : list.length ? `希望休：${list.length}件を読みました` : '';
}
$('hopes').addEventListener('input', () => {
  clearTimeout(hopeTimer);
  hopeTimer = setTimeout(() => { showHopes(); if (result) recheck({ announce: true }); }, 400);
});

// ---- 読み込む ------------------------------------------------------------------------

/** Excel（.xlsx）→ 行の配列。「氏名」の見出しがある最初のシート */
async function xlsxRows(buf) {
  if (!window.ExcelJS) throw new Error('Excelの部品を読み込めませんでした。再読み込みしてお試しください');
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  for (const ws of wb.worksheets) {
    const rows = sheetRows(ws);
    if (hasShiftHeader(rows)) return { rows, sheet: wb.worksheets.length > 1 ? ws.name : '' };
  }
  return { rows: wb.worksheets[0] ? sheetRows(wb.worksheets[0]) : [], sheet: '' };
}

function resetResult() {
  result = null; built = null;
  $('result').hidden = true; $('step3').hidden = true; $('estimate').hidden = true; $('made').hidden = true;
  setStep(1);
}

/** 読み込んだ表を、いまの年月で読む。notes：読んだときの知らせ（先頭に出す） */
function parseRows(extra = []) {
  const { grid: g, errors, notes } = readShiftTable(rawRows, $('period').value);
  $('loaderr').textContent = '';
  if (!g.people.length) {
    grid = null;
    $('loaded').hidden = true;
    $('loaderr').textContent = `${label}：${errors.join('。')}`;
    resetResult();
    updateCheckState();
    return;
  }
  grid = g; edited = false;
  $('loadinfo').textContent = `${label}：${g.people.length}人 × ${monthDays(g.period, []).length}日分（${ym(g.period)}）を読みました`;
  const box = clear($('loadnotes'));
  for (const t of extra) box.append(h('li', {}, t));
  for (const t of errors) box.append(h('li', { class: 'warn' }, t));
  for (const t of notes) box.append(h('li', {}, t));
  const first = $('loaded').hidden;
  $('loaded').hidden = false;
  if (!first) flash($('loadinfo')); // 読み込み直したときは、変わった所を光らせる
  resetResult();
  updateCheckState();
}

function loadRows(rows, name, extra = []) {
  rawRows = rows; label = name;
  const p = detectPeriod(rows);
  const msgs = [...extra];
  if (p && p !== $('period').value) {
    $('period').value = p; fillHolidays(); showHopes();
    msgs.unshift(`表に合わせて、対象の年月を${ym(p)}にしました`);
  } else if (!p) msgs.unshift(`表に年月が見つからないので、${ym($('period').value)}として読みました（違うときは「対象の年月」を選んでください）`);
  parseRows(msgs);
}

$('sample').addEventListener('click', async () => {
  const btn = $('sample');
  btn.disabled = true;
  try {
    const res = await fetch('/samples/shift/samples.json');
    if (!res.ok) throw new Error();
    const meta = await res.json();
    const x = await fetch(`/samples/shift/${meta.xlsx}`);
    if (!x.ok) throw new Error();
    const { rows } = await xlsxRows(await x.arrayBuffer());
    $('hopes').value = meta.hopes;
    title = meta.facility;
    loadRows(rows, `見本（${meta.facility}）`);
    showHopes();
  } catch (e) {
    $('loaderr').textContent = e?.message || '見本を読み込めませんでした。再読み込みしてお試しください';
  } finally { btn.disabled = false; }
});

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    const name = f.name;
    if (/\.xls$/i.test(name)) throw new Error('古い形式（.xls）は読めません。Excel で「.xlsx」か CSV で保存し直してください');
    let rows; let sheet = '';
    if (/\.xlsx$/i.test(name) || f.type === XLSX_MIME) ({ rows, sheet } = await xlsxRows(buf));
    else rows = parseCsv(decodeCsvBytes(buf));
    title = name.replace(/\.[^.]+$/, '');
    loadRows(rows, name, sheet ? [`シート「${sheet}」を読みました`] : []);
  } catch (ex) {
    $('loaderr').textContent = `${f.name}：${ex?.message || '読み込めませんでした'}`;
  }
});

$('period').addEventListener('change', () => {
  if (!$('period').value) return;
  fillHolidays();
  showHopes();
  if (rawRows) parseRows(edited ? ['対象の年月を変えたので、表を読み直しました（直したマスは元に戻りました）'] : []);
});

function updateCheckState() {
  $('check').disabled = !grid;
  $('check-hint').textContent = grid ? '' : '先にシフト表を読み込んでください（見本でも試せます）';
}

// ---- チェックする ----------------------------------------------------------------------

function runCheck() {
  lastSettings = readSettings();
  const t0 = performance.now();
  result = checkShift(grid, lastSettings);
  elapsedMs = performance.now() - t0;
}

$('check').addEventListener('click', () => {
  if (!grid) return;
  runCheck();
  $('result').hidden = false; $('step3').hidden = false; $('estimate').hidden = false; $('made').hidden = true;
  setStep(2);
  renderAll(true);
  $('result').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
});

/** 直したとき・設定を変えたとき：表は作り直さず、色と言葉と一覧だけを書き換える */
function recheck({ announce = false } = {}) {
  runCheck();
  renderAll(false);
  $('made').hidden = true; // 前に作った Excel は、いまの表と違う
  if (announce) {
    const red = result.problems.filter((p) => p.level === 'red').length;
    $('live').textContent = `確かめ直しました。要確認${red}件、注意${result.problems.length - red}件`;
  }
}

function renderAll(first) {
  renderStats(first);
  renderProblems(first);
  if (!built || built.grid !== grid || built.symbols !== JSON.stringify(symbols.map((s) => normCode(s.code)))) buildGrid();
  paintGrid();
  renderPeople();
}

function renderStats(first) {
  const box = clear($('stats'));
  const red = result.problems.filter((p) => p.level === 'red').length;
  const yellow = result.problems.length - red;
  const stat = (name, value, unit, cls = '', extra = null) => h('div', { class: `stat ${cls}` }, h('span', {}, name), h('b', {}, value, h('small', {}, unit)), extra);
  // 問題の数は安全の表示なので数え上げない（はじめから本当の数を出す）
  box.append(
    stat('要確認（赤）', String(red), '件', red ? 'danger' : ''),
    stat('注意（黄）', String(yellow), '件', yellow ? 'warn' : ''),
    stat('確かめた表', `${grid.people.length}人×${result.days.length}`, '日', 'quiet'),
    h('div', { class: 'vs' },
      stat('チェックにかかった時間', elapsedMs < 1000 ? '1秒未満' : (elapsedMs / 1000).toFixed(1), elapsedMs < 1000 ? '' : '秒', 'good'),
      stat('目で確かめると約', String(manualMin), '分', '', h('em', {}, '1つのシフト表（仮置き。下の「御社の場合」で変えられます）'))),
  );
  if (first) stagger(box);
}

function renderProblems(first) {
  const list = clear($('problems'));
  if (!result.problems.length) {
    list.append(h('li', { class: 'none' }, '見つかった問題はありません。色の付いていないマスも、最後は人が確かめてください。'));
    return;
  }
  result.problems.forEach((p) => {
    const go = p.kind === 'hopename' ? '希望休を直す' : '表で見る';
    list.append(h('li', { class: `prob ${p.level}` },
      h('span', { class: `badge ${p.level}` }, LEVEL_TEXT[p.level]),
      h('span', { class: 'pk' }, PROBLEM_KINDS[p.kind] ?? p.kind),
      h('span', { class: 'pt' }, p.text),
      h('button', { type: 'button', class: 'small', onclick: () => goTo(p) }, go)));
  });
  if (first) stagger(list);
}

// ---- 表 -------------------------------------------------------------------------------

const toTxt = (b) => (b.to > 24 ? `翌${b.to - 24}` : String(b.to));

function buildGrid() {
  const t = clear($('grid'));
  const days = result.days;
  const codes = symbols.map((s) => normCode(s.code)).filter(Boolean);
  t.append(h('thead', {}, h('tr', {},
    h('th', { class: 'corner', scope: 'col' }, '氏名'),
    days.map((d) => h('th', { class: `day ${d.type === 'holiday' ? 'hol' : ''}`, scope: 'col', dataset: { day: String(d.day) } },
      h('span', { class: 'dn' }, String(d.day)), h('span', { class: 'wd' }, d.isHoliday ? '祝' : d.weekday), h('small', { class: 'df' }))))));
  const body = h('tbody');
  grid.people.forEach((p, pi) => {
    body.append(h('tr', {},
      h('th', { class: 'pname', scope: 'row', tabIndex: -1, dataset: { pi: String(pi) } }, p.name),
      days.map((d, di) => {
        const cur = normCode(p.cells[di]);
        const opts = [...new Set([...codes, ...(cur && !codes.includes(cur) ? [cur] : [])])];
        const sel = h('select', {
          'aria-label': `${p.name}さん ${dayLabel(d)}`,
          onchange: (e) => {
            p.cells[di] = e.target.value; edited = true;
            recheck({ announce: true });
            flash(e.target.parentElement);
          },
        }, h('option', { value: '', selected: !cur }, '—'), opts.map((c) => h('option', { value: c, selected: c === cur }, c)));
        return h('td', { class: 'cell', dataset: { pi: String(pi), day: String(d.day) } }, sel, h('small', { class: 'cf' }));
      })));
  });
  t.append(body);
  // 時間帯ごとの、いちばん少ない時の人数
  t.append(h('tfoot', {}, BANDS.map((b) => h('tr', { class: 'band' },
    h('th', { scope: 'row' }, h('b', {}, b.label), h('small', {}, `${b.from}〜${toTxt(b)}時`)),
    days.map((d) => h('td', { class: 'bc', tabIndex: -1, dataset: { day: String(d.day), band: b.key } }, h('span', { class: 'v' }), h('small', { class: 'cf' })))))));
  built = { grid, symbols: JSON.stringify(symbols.map((s) => normCode(s.code))) };
}

function paintGrid() {
  const t = $('grid');
  for (const th of t.querySelectorAll('th.day')) {
    const df = result.dayFlags.get(Number(th.dataset.day));
    th.classList.toggle('short', Boolean(df));
    th.querySelector('.df').textContent = df ? df.text : '';
  }
  for (const td of t.querySelectorAll('td.cell')) {
    const flags = result.cellFlags.get(`${td.dataset.pi}|${td.dataset.day}`) ?? [];
    const lv = worstOf(flags);
    td.classList.toggle('red', lv === 'red'); td.classList.toggle('yellow', lv === 'yellow');
    td.querySelector('.cf').textContent = flags.map((f) => f.text).join('・');
  }
  for (const td of t.querySelectorAll('td.bc')) {
    const bc = result.bandCount.get(`${td.dataset.day}|${td.dataset.band}`);
    const short = bc && bc.min < bc.need;
    td.classList.toggle('red', Boolean(short));
    td.querySelector('.v').textContent = bc ? String(bc.min) : '';
    td.querySelector('.cf').textContent = short ? `不足${bc.need - bc.min}` : '';
  }
}

/** 一覧から、表のその場所へ（見える所まで動かして、光らせる） */
function goTo(p) {
  let target = null; let glow = null;
  if (p.kind === 'hopename') { target = $('hopes'); glow = $('hopes'); }
  else if (p.kind === 'short') {
    target = $('grid').querySelector(`td.bc[data-day="${p.day}"][data-band="${p.band}"]`);
    glow = target;
    const th = $('grid').querySelector(`th.day[data-day="${p.day}"]`);
    if (th) flash(th);
  } else if (p.pi != null && p.day != null) {
    const td = $('grid').querySelector(`td.cell[data-pi="${p.pi}"][data-day="${p.day}"]`);
    target = td?.querySelector('select'); glow = td;
  } else if (p.pi != null) {
    target = $('grid').querySelector(`th.pname[data-pi="${p.pi}"]`); glow = target?.parentElement;
  }
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: scrollBehavior(), block: 'center', inline: 'center' });
  if (glow) flash(glow);
}

// ---- 人ごと ----------------------------------------------------------------------------

function renderPeople() {
  const t = clear($('people'));
  const r = lastSettings.rules;
  const cols = ['氏名', '出勤日数', '休日数', '有給など', '夜勤明け', '夜勤の回数', '最大連勤', '希望休とのぶつかり', '勤務の間が短い（参考）'];
  t.append(h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', { class: i ? 'num' : '', scope: 'col' }, c)))));
  const body = h('tbody');
  const badge = (cls, text) => h('span', { class: `badge ${cls}` }, text);
  for (const x of result.people) {
    const td = (name, v, cls = 'num') => h('td', { dataset: { label: name }, class: cls }, v);
    body.append(h('tr', {},
      h('th', { scope: 'row' }, x.name), td('出勤日数', `${x.workDays}日`),
      td('休日数', x.holidays < r.minHolidays ? badge('yellow', `${x.holidays}日（下限${r.minHolidays}日）`) : `${x.holidays}日`),
      td('有給など', `${x.leaves}日`), td('夜勤明け', `${x.afters}日`), td('夜勤の回数', `${x.nights}回`),
      td('最大連勤', x.maxStreak > r.maxStreak ? badge('yellow', `${x.maxStreak}日（上限${r.maxStreak}日）`) : `${x.maxStreak}日`),
      td('希望休とのぶつかり', x.conflicts ? badge('red', `${x.conflicts}件`) : '—'),
      td('勤務の間が短い（参考）', x.intervals ? badge('yellow', `${x.intervals}回`) : '—')));
  }
  t.append(body);
}

// ---- Excel ----------------------------------------------------------------------------

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const wb = buildShiftWorkbook(window.ExcelJS, { grid, result, settings: lastSettings, title });
  const buf = await wb.xlsx.writeBuffer();
  const filename = `シフト表のチェック_${grid.period.replace('-', '')}_${stamp()}.xlsx`;
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename);
  const el = clear($('made'));
  el.append(edited ? '直したあとの表で、Excelを作りました：' : 'Excelを作りました：', h('span', { class: 'fn' }, filename));
  el.hidden = false;
  replay(el, 'in');
  setStep(4);
});

renderSymbols();
renderSymLegend();
updateCheckState();
setStep(1);
