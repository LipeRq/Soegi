// 経理デモ：レシート → Excel。1 撮る・読み込む（3枚ずつ並行）→ 2 確かめる → 3 Excelにする
import {
  requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, pool, setStep, mountRoi,
} from './common.js';
import { toJpeg } from './image.js';
import { checkReceipts, levelOf, worstLevel } from './receipt-check.js';
import { buildReceiptWorkbook } from './receipt-xlsx.js';
import { pricingText, MENUS } from './pricing.js';

requireAuth();

const MAX_FILES = 20;
const CONCURRENCY = 3;
const ACCOUNTS = ['消耗品費', '事務用品費', '旅費交通費', '車両費（燃料）', '通信費', '会議費', '接待交際費', '福利厚生費', '新聞図書費', '雑費'];
const STYLE_NOTES = {
  standard: '1枚1行の明細に、科目別の集計と「要確認」の行だけのシートが付きます。',
  journal: '会計ソフトに取り込みやすい、日付・借方・貸方・金額・摘要の5列です。',
  office: '架空の会計事務所の取り込み様式の例です。10%と8%が混ざったレシートは税区分ごとに行を分けます。お試し導入では、御社の様式に列を合わせます。',
};

const $ = (id) => document.getElementById(id);
$('pricing').textContent = pricingText('manual');

let files = []; // 選んだ写真
let rows = []; // 読み取り結果（確かめる対象）
let nextId = 1;
let elapsedSec = null;
let minutesPerReceipt = 1;
const roi = mountRoi($('roi'), {
  unit: '枚', countLabel: 'レシート・領収書は月に何枚？', count: 200,
  minutesLabel: '1枚の手入力にかかる時間（仮置き）', minutes: minutesPerReceipt, monthlyFee: MENUS.manual.monthly,
});

// ---- 1. 撮る・選ぶ -----------------------------------------------------------------

function addFiles(list) {
  const room = MAX_FILES - files.length;
  const picked = [...list].filter((f) => f.type.startsWith('image/')).slice(0, room);
  for (const f of picked) files.push({ id: nextId++, file: f, filename: f.name || `撮影${nextId}.jpg`, thumb: URL.createObjectURL(f) });
  if (list.length > room) alert(`1回に読み取れるのは${MAX_FILES}枚までです。`);
  renderThumbs();
}

function renderThumbs() {
  const box = clear($('thumbs'));
  for (const f of files) {
    box.append(h('figure', {},
      h('img', { src: f.thumb, alt: f.filename }),
      h('button', { type: 'button', title: '外す', 'aria-label': `${f.filename}を外す`, onclick: () => { URL.revokeObjectURL(f.thumb); files = files.filter((x) => x !== f); renderThumbs(); } }, '×'),
      h('figcaption', {}, f.filename)));
  }
  $('count').textContent = files.length ? `${files.length} / ${MAX_FILES} 枚` : '';
  $('go').disabled = files.length === 0;
}

$('cam').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('pick').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('clear').addEventListener('click', () => { files.forEach((f) => URL.revokeObjectURL(f.thumb)); files = []; renderThumbs(); });

// ---- 読み取り -------------------------------------------------------------------------

const blankRow = (f) => ({
  id: f.id, file: f.file, filename: f.filename, thumb: f.thumb, status: 'pending', error: '',
  date: '', payee: '', total: null, amount10: null, amount8: null, tax: null, invoiceNo: '',
  payment: '', summary: '', account: '', reason: '', conf: {},
});

function applyResult(row, d) {
  Object.assign(row, {
    status: d.is_receipt ? 'done' : 'error',
    error: d.is_receipt ? '' : 'レシートとして読み取れませんでした。手入力で直してください',
    date: d.date, payee: d.payee, total: d.total, amount10: d.amount_10, amount8: d.amount_8, tax: d.tax_amount,
    invoiceNo: d.invoice_no, payment: d.payment_method, summary: d.summary, account: d.account, reason: d.account_reason,
    conf: d.confidence,
  });
}

/** 何をしているかを、そのまま出す（写真を縮める→AIが読む→プログラムが確かめる） */
const phase = (n, text) => { $('phase').textContent = `${n}枚目：${text}`; };

async function readOne(row, n) {
  row.status = 'reading'; row.error = '';
  try {
    phase(n, '写真を縮めて、向きを直しています');
    const { base64 } = await toJpeg(row.file);
    phase(n, 'AIが日付・支払先・金額を読んでいます');
    applyResult(row, await api('/api/receipt', { image: base64 }));
    phase(n, '合計と登録番号を確かめています');
  } catch (e) {
    row.status = 'error';
    row.error = e instanceof Error ? e.message : '読み取れませんでした';
  }
}

async function readAll(targets) {
  $('reading').hidden = false;
  $('go').disabled = true;
  setStep(1);
  const t0 = performance.now();
  let done = 0;
  const update = () => {
    $('bar').style.width = `${(done / targets.length) * 100}%`;
    $('progress-text').textContent = `${done} / ${targets.length} 枚を読み取りました`;
  };
  update();
  await pool(targets, CONCURRENCY, async (row) => { await readOne(row, rows.indexOf(row) + 1); done++; update(); });
  elapsedSec = (performance.now() - t0) / 1000;
  $('phase').textContent = `読み取りが終わりました（${elapsedSec.toFixed(1)}秒）`;
  $('go').disabled = files.length === 0;
  renderRows();
  $('step2').hidden = false;
  $('step3').hidden = false;
  setStep(2);
  $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('go').addEventListener('click', () => {
  rows = files.map(blankRow);
  readAll(rows);
});
$('retry').addEventListener('click', () => readAll(rows.filter((r) => r.status === 'error' && r.file)));
$('add').addEventListener('click', () => {
  const r = blankRow({ id: nextId++, file: null, filename: '（手入力）', thumb: '' });
  r.status = 'done';
  rows.push(r);
  $('step2').hidden = false; $('step3').hidden = false;
  renderRows();
});

// ---- 2. 確かめる ---------------------------------------------------------------------

const toNum = (s) => {
  const t = String(s).normalize('NFKC').replace(/[,円¥\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : null;
};

function field(row, key, { num = false } = {}) {
  return h('input', {
    type: 'text', value: row[key] ?? '', inputMode: num ? 'numeric' : undefined,
    placeholder: key === 'date' ? 'YYYY-MM-DD' : '', 'aria-label': key,
    oninput: (e) => { row[key] = num ? toNum(e.target.value) : e.target.value.trim(); refresh(); },
  });
}

function renderRows() {
  const body = clear($('rows'));
  rows.forEach((row, i) => {
    const td = (label, content, extra = {}) => h('td', { dataset: { label }, ...extra }, content);
    const account = h('select', { 'aria-label': '勘定科目', onchange: (e) => { row.account = e.target.value; row.conf.account = '高'; refresh(); } },
      h('option', { value: '' }, '（選んでください）'),
      ACCOUNTS.map((a) => h('option', { value: a, selected: a === row.account }, a)));
    body.append(h('tr', { dataset: { id: row.id } },
      td('#', String(i + 1), { class: 'nolabel' }),
      td('写真', row.thumb
        ? h('img', { class: 'thumb-sm', src: row.thumb, alt: row.filename, title: row.filename, onclick: () => zoom(row) })
        : '—'),
      td('日付', field(row, 'date'), { dataset: { label: '日付', f: 'date' } }),
      td('支払先', field(row, 'payee'), { dataset: { label: '支払先', f: 'payee' } }),
      td('合計', field(row, 'total', { num: true }), { dataset: { label: '合計', f: 'total' }, class: 'num' }),
      td('10%対象', field(row, 'amount10', { num: true }), { dataset: { label: '10%対象', f: 'amount10' }, class: 'num' }),
      td('8%対象', field(row, 'amount8', { num: true }), { dataset: { label: '8%対象', f: 'amount8' }, class: 'num' }),
      td('消費税額', field(row, 'tax', { num: true }), { class: 'num' }),
      td('登録番号', field(row, 'invoiceNo'), { dataset: { label: '登録番号', f: 'invoiceNo' } }),
      td('支払方法', field(row, 'payment')),
      td('品目', field(row, 'summary')),
      td('勘定科目', [account, h('span', { class: 'reason' }, row.reason || '')], { dataset: { label: '勘定科目（候補）', f: 'account' } }),
      td('確かめる点', h('div', { class: 'flags' }), { class: 'rowflag', dataset: { label: '確かめる点', f: 'row' } }),
      td('', h('button', { type: 'button', class: 'small', onclick: () => { rows = rows.filter((r) => r !== row); renderRows(); } }, '削除'), { class: 'nolabel' }),
    ));
  });
  $('retry').hidden = !rows.some((r) => r.status === 'error' && r.file);
  refresh();
}

/** 入力のたびにチェックをやり直して、色と指摘だけ更新する（入力欄は作り直さない） */
function refresh() {
  const checks = checkReceipts(rows);
  [...$('rows').children].forEach((tr, i) => {
    const row = rows[i]; const c = checks[i];
    for (const td of tr.querySelectorAll('td[data-f]')) {
      td.classList.remove('red', 'yellow');
      const lv = levelOf(c.flags, td.dataset.f);
      if (lv && td.dataset.f !== 'row') td.classList.add(lv);
    }
    tr.classList.toggle('dupe', c.duplicate);
    const box = clear(tr.querySelector('.flags'));
    if (row.error) box.append(h('span', { class: 'flag red' }, row.error));
    for (const f of c.flags) box.append(h('span', { class: `flag ${f.level}` }, f.message));
    if (!row.error && !c.flags.length) box.append(h('span', { class: 'badge ok' }, 'OK'));
  });
  const red = checks.filter((c, i) => worstLevel(c.flags) === 'red' || rows[i].error).length;
  const yellow = checks.filter((c, i) => worstLevel(c.flags) === 'yellow' && !rows[i].error).length;
  $('summary').textContent = `${rows.length}枚：要確認（赤）${red}枚／注意（黄）${yellow}枚`;
  renderStats(red, yellow);
}

function renderStats(red, yellow) {
  const box = clear($('stats'));
  const stat = (label, value, unit, cls = '', extra = null) => h('div', { class: `stat ${cls}` }, h('span', {}, label), h('b', {}, value, h('small', {}, unit)), extra);
  const mins = h('input', {
    type: 'number', min: '0', max: '30', step: '0.5', value: String(minutesPerReceipt), inputMode: 'decimal', 'aria-label': '1枚の手入力の分',
    onchange: (e) => { minutesPerReceipt = Math.max(0, Number(e.target.value) || 0); roi.setMinutes(minutesPerReceipt); refresh(); },
  });
  box.append(
    stat('読み取った枚数', String(rows.filter((r) => r.file).length), '枚'),
    stat('かかった時間', elapsedSec == null ? '—' : elapsedSec.toFixed(1), '秒', 'good'),
    stat('手入力なら約', String(Math.round(rows.length * minutesPerReceipt * 10) / 10), '分', '', h('em', {}, '1枚 ', mins, ' 分（仮置き）')),
    stat('要確認（赤）', String(red), '枚', red ? 'danger' : ''),
    stat('注意（黄）', String(yellow), '枚', yellow ? 'warn' : ''),
  );
}

function zoom(row) {
  const dlg = $('zoom');
  dlg.querySelector('img').src = row.thumb;
  dlg.showModal();
}
$('zoom').addEventListener('click', () => $('zoom').close());

// ---- 3. Excelにする --------------------------------------------------------------------

const currentStyle = () => document.querySelector('input[name=style]:checked').value;
function onStyle() {
  const s = currentStyle();
  $('credit-label').hidden = s === 'standard';
  $('style-note').textContent = STYLE_NOTES[s];
}
document.querySelectorAll('input[name=style]').forEach((el) => el.addEventListener('change', onStyle));
onStyle();

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const style = currentStyle();
  const wb = buildReceiptWorkbook(window.ExcelJS, rows, checkReceipts(rows), { style, creditAccount: $('credit').value });
  const buf = await wb.xlsx.writeBuffer();
  const name = { standard: '明細', journal: '仕訳', office: '事務所様式' }[style];
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), `レシート_${name}_${stamp()}.xlsx`);
  setStep(4);
});

renderThumbs();
setStep(1);
