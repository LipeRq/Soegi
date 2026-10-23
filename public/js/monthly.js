// 月次レポート：売上CSV → この1枚。計算は monthly-calc.js（プログラム）。グラフは monthly-chart.js（SVG）。
// AIは、計算した数字の「事実の一覧」にコメントを付けるだけ（数字は番号で指し、プログラムが埋める）。
import { requireAuth, api, h, clear, setStep } from './common.js';
import { mountEstimate } from './estimate-ui.js';
import { decodeCsvBytes, parseCsv } from './csv.js';
import { readSales, latestClosedMonth, monthsOf, calcMonthly, ymLabel, yen, yenShort, pct, share } from './monthly-calc.js';
import { buildFacts, fixedLines, mergeLines } from './monthly-comment.js';
import { lineChart, barList } from './monthly-chart.js';
import { reduced, flash } from './motion.js';

requireAuth();
const $ = (id) => document.getElementById(id);
mountEstimate($('estimate'), { keys: ['monthly'] });

const FIELDS = [['date', '日付'], ['customer', '顧客'], ['product', '商品'], ['qty', '数量'], ['amount', '金額']];
const HINTS = { date: ['日付', '日', 'date', '売上日', '納品日'], customer: ['顧客', '得意先', '取引先', 'customer', '客'], product: ['商品', '品名', '品目', 'product', '製品'], qty: ['数量', '数', 'qty', '個数'], amount: ['金額', '売上', '売上金額', 'amount', '税込金額'] };

let rows = null; // CSV（見出しを含む）
let mapping = null;
let records = [];
let calc = null;
let ai = null; // {lines:[{text, source}], dropped}
let seq = 0;

/** 今日（日本の日付）。締まった月は、今月より前 */
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function guess(header) {
  const h2 = header.map((v) => String(v).normalize('NFKC').trim().toLowerCase());
  const out = {};
  for (const [k, words] of Object.entries(HINTS)) {
    let i = -1;
    for (const w of words) { i = h2.findIndex((v) => v === w); if (i >= 0) break; }
    if (i < 0) i = h2.findIndex((v) => words.some((w) => v.includes(w)));
    out[k] = i;
  }
  return out;
}

// ---- 読み込み -----------------------------------------------------------------------------

function load(buf, label, company = '') {
  const parsed = parseCsv(decodeCsvBytes(buf));
  $('loaderr').textContent = '';
  if (parsed.length < 2) { $('loaderr').textContent = 'データの行が見つかりませんでした。'; return; }
  rows = parsed; mapping = guess(parsed[0]);
  if (company) $('company').value = company;
  renderMapping();
  apply(label);
}

function renderMapping() {
  const grid = clear($('mapgrid'));
  for (const [key, name] of FIELDS) {
    const sel = h('select', { onchange: (e) => { mapping[key] = Number(e.target.value); apply(); } },
      h('option', { value: '-1' }, key === 'qty' ? '（なし：平均単価は出さない）' : '（選択してください）'),
      rows[0].map((n, i) => h('option', { value: String(i), selected: mapping[key] === i }, n || `列${i + 1}`)));
    grid.append(h('label', {}, name, sel));
  }
}

function apply(label = '') {
  const ready = mapping.date >= 0 && mapping.amount >= 0;
  const out = ready ? readSales(rows, mapping) : { records: [], errors: [] };
  records = out.records;
  const info = $('loadinfo');
  info.textContent = ready ? `${label ? `${label}：` : ''}${records.length.toLocaleString('ja-JP')}行を読み込みました${out.errors.length ? `（読めなかった行：${out.errors.length}行）` : ''}。列の対応を確かめてください。` : '日付と金額の列を選んでください。';
  const errs = clear($('loaderrs'));
  for (const e of out.errors.slice(0, 5)) errs.append(h('li', {}, `${e.row}行目：${e.message}（計算に入れていません）`));
  if (out.errors.length > 5) errs.append(h('li', {}, `ほか${out.errors.length - 5}行`));
  $('loaded').hidden = false;
  if (label) flash(info);
  const months = monthsOf(records);
  $('filterrow').hidden = !months.length; $('result').hidden = !months.length; $('estimate').hidden = !months.length;
  if (!months.length) { setStep(1); return; }
  const closed = latestClosedMonth(records, today());
  const keep = $('month').value;
  const sel = clear($('month'));
  for (const m of months) sel.append(h('option', { value: m }, ymLabel(m)));
  const first = closed ?? months[0];
  sel.value = first;
  $('monthnote').textContent = closed ? '既定は、いちばん新しい「締まった月」（今月より前）です。' : '今月のデータだけなので、その月を出しています（途中の月の数字です）。';
  ai = null;
  if (!label && keep && months.includes(keep)) sel.value = keep; // 列の対応を直したときは、選んでいた月を保つ
  render();
  setStep(2);
}

$('sample').addEventListener('click', async () => {
  $('sample').disabled = true;
  try {
    const res = await fetch('/samples/monthly/sales-sample.csv');
    if (!res.ok) throw new Error();
    load(await res.arrayBuffer(), '見本（架空の2年分）', 'さくらんぼ食品（仮）');
  } catch { $('loaderr').textContent = '見本を読み込めませんでした。再読み込みしてお試しください'; } finally { $('sample').disabled = false; }
});
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { load(await f.arrayBuffer(), f.name, $('company').value); } catch { $('loaderr').textContent = `${f.name}：読み込めませんでした`; }
});
$('month').addEventListener('change', () => { ai = null; render(); });
$('company').addEventListener('input', () => { $('s-co').textContent = $('company').value; });

// ---- 1枚 -----------------------------------------------------------------------------------

// 日本の経理では「▲」はマイナスの印なので、増減は ↑↓ と「増・減」の言葉で示す
const arrow = (d) => (d > 0 ? '↑' : d < 0 ? '↓' : '＝');

function kpi(label, value, sub, cls = '') {
  return h('div', { class: `kpi ${cls}` }, h('span', { class: 'kl' }, label), h('b', { class: 'kv' }, value), sub ? h('small', { class: 'ks' }, sub) : null);
}

/** 前月比・前年同月比：増えた・減ったを、色と記号と言葉で（比べる月が無いときは「—」と理由） */
function deltaKpi(label, rel, baseName) {
  if (!rel) return kpi(label, '—', `${baseName}のデータがありません`, 'muted');
  if (rel.pct == null) return kpi(label, '—', `${baseName}は0円以下のため、割合は出せません`, 'muted');
  const word = rel.diff > 0 ? '増' : rel.diff < 0 ? '減' : '変わらず';
  return kpi(label, pct(rel.pct), `${arrow(rel.diff)} ${word}　${baseName} ${yenShort(rel.total)}（${rel.diff >= 0 ? '＋' : '－'}${yenShort(Math.abs(rel.diff))}）`, rel.diff > 0 ? 'up' : rel.diff < 0 ? 'down' : 'muted');
}

function render() {
  const ym = $('month').value;
  calc = calcMonthly(records, ym);
  if (!calc) return;
  $('s-co').textContent = $('company').value;
  $('s-title').textContent = `${calc.label}　月次レポート`;
  clear($('kpis')).append(
    kpi('売上合計', yenShort(calc.total), `${yen(calc.total)}`, 'hero'),
    deltaKpi('前月比', calc.prev, '前月'),
    deltaKpi('前年同月比', calc.yoy, '前年同月'),
    kpi('取引の件数', `${calc.count.toLocaleString('ja-JP')}件`, ''),
    kpi('平均単価', calc.avgUnit == null ? '—' : `${Math.round(calc.avgUnit).toLocaleString('ja-JP')}円`, calc.avgUnit == null ? '数量の列がありません' : '金額 ÷ 数量'));
  lineChart($('line'), calc.series12);
  lineTable();
  barList($('custbars'), calc.customers.top, { restLabel: 'そのほかの顧客', rest: calc.customers.rest, restShare: calc.customers.restShare, restCount: calc.customers.restCount });
  barList($('prodbars'), calc.products.top, { restLabel: 'そのほかの商品', rest: calc.products.rest, restShare: calc.products.restShare, restCount: calc.products.restCount });
  renderMovers();
  renderPoints();
  unnamedNote();
}

/** 名前の無い行（列を選んでいない・空）は、順位に入れていない。額だけ知らせる */
function unnamedNote() {
  const note = (box, c, what) => {
    box.querySelector('.unnamed')?.remove();
    if (c.unnamed > 0) box.append(h('p', { class: 'rest unnamed' }, `${what}が空の行：${yenShort(c.unnamed)}（${share(c.unnamedShare)}）は、順位に入れていません。`));
  };
  note($('custbars'), calc.customers, '顧客');
  note($('prodbars'), calc.products, '商品');
}

function lineTable() {
  const t = clear($('linetable'));
  t.append(h('thead', {}, h('tr', {}, ['月', '今年', '前年', '差'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
    h('tbody', {}, calc.series12.map((s) => h('tr', {},
      h('td', {}, ymLabel(s.ym)),
      h('td', { class: 'num' }, s.thisYear == null ? '—' : yen(s.thisYear)),
      h('td', { class: 'num' }, s.prevYear == null ? '—' : yen(s.prevYear)),
      h('td', { class: 'num' }, s.thisYear == null || s.prevYear == null ? '—' : `${s.thisYear - s.prevYear >= 0 ? '＋' : '－'}${yen(Math.abs(s.thisYear - s.prevYear))}`)))));
}

function moverItem(m) {
  const tag = m.isNew ? '新規' : m.isLost ? '取引なし' : m.pct == null ? '' : pct(m.pct);
  return h('li', {}, h('span', { class: 'mn' }, m.name), h('span', { class: 'mv' }, `${m.diff >= 0 ? '＋' : '－'}${yenShort(Math.abs(m.diff))}`), tag ? h('small', {}, tag) : null);
}

function renderMovers() {
  const box = clear($('movers'));
  if (!calc.customerMovers) { box.append(h('p', { class: 'small-note' }, `前年同月（${ymLabel(calc.ym.replace(/^\d{4}/, (y) => String(y - 1)))}）のデータがないため、伸びた所・落ちた所は出せません。`)); return; }
  const col = (title, cls, groups) => h('div', { class: `mcol ${cls}` }, h('h5', {}, title),
    groups.map(([kind, list]) => h('div', { class: 'mg' }, h('span', { class: 'mk' }, kind), list.length ? h('ul', {}, list.map(moverItem)) : h('p', { class: 'small-note' }, 'ありません'))));
  box.append(
    col('伸びた（前年同月との差が大きい順）', 'up', [['顧客', calc.customerMovers.risers], ['商品', calc.productMovers.risers]]),
    col('落ちた（前年同月との差が大きい順）', 'down', [['顧客', calc.customerMovers.fallers], ['商品', calc.productMovers.fallers]]));
}

function renderPoints() {
  const lines = ai ? mergeLines(ai.lines, fixedLines(calc)) : fixedLines(calc).map((text) => ({ text, source: 'fixed' }));
  clear($('points')).append(...lines.map((l) => h('li', {}, l.text, l.source === 'ai' ? h('span', { class: 'badge gray ai' }, 'AI') : null)));
  const meta = $('aimeta');
  if (!ai) meta.textContent = '上の文は、計算した数字からプログラムが作った決まった文です。';
  else meta.textContent = `「AI」の付いた文は、AIが書いた文です（数字はプログラムが埋めました。原因を言い切るものではありません）。${ai.dropped.length ? `AIの文のうち${ai.dropped.length}行は、数字が残っていたなどの理由で捨てて、決まった文に置き換えました。` : ''}`;
}

// ---- AIのコメント（任意） ------------------------------------------------------------------------

$('ai').addEventListener('click', async () => {
  if (!calc) return;
  const mine = ++seq;
  $('ai').disabled = true; $('aierr').textContent = '';
  const keep = $('ai').textContent; $('ai').textContent = 'コメントを作っています…';
  try {
    const r = await api('/api/monthly-comment', { facts: buildFacts(calc) });
    if (mine !== seq || $('month').value !== calc.ym) return;
    ai = { lines: r.lines, dropped: r.dropped ?? [] };
    renderPoints();
    flash($('points'));
  } catch (e) { if (mine === seq) $('aierr').textContent = e.message; } finally { if (mine === seq) { $('ai').disabled = false; $('ai').textContent = keep; } }
});

// ---- 印刷（A4・1枚） -----------------------------------------------------------------------------
$('print').addEventListener('click', () => { setStep(3); window.print(); });

setStep(1);
void reduced; void share;
