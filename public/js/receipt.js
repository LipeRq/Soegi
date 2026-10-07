// 経理デモ：レシート → Excel。撮る・選ぶ → 読み取り（3枚ずつ並行）→ 確認・修正 → Excel
import {
  requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, pool, PRICING_TEXT,
} from './common.js';
import { toJpeg } from './image.js';
import { checkReceipts, levelOf, worstLevel } from './receipt-check.js';
import { buildReceiptWorkbook } from './receipt-xlsx.js';

requireAuth();

const MAX_FILES = 20;
const CONCURRENCY = 3;
const ACCOUNTS = ['消耗品費', '事務用品費', '旅費交通費', '車両費（燃料）', '通信費', '会議費', '接待交際費', '福利厚生費', '新聞図書費', '雑費'];

const $ = (id) => document.getElementById(id);
$('pricing').textContent = PRICING_TEXT;

/** @type {{id:number,file:File|null,filename:string,thumb:string,status:string,error:string,[k:string]:any}[]} */
let files = []; // 選んだ画像
let rows = []; // 読み取り結果（確認・修正の対象）
let nextId = 1;

// ---- 1. 撮る・選ぶ -----------------------------------------------------------------

function addFiles(list) {
  const room = MAX_FILES - files.length;
  const picked = [...list].filter((f) => f.type.startsWith('image/')).slice(0, room);
  for (const f of picked) files.push({ id: nextId++, file: f, filename: f.name || `撮影${nextId}.jpg`, thumb: URL.createObjectURL(f) });
  if (list.length > room) alert(`1回の操作で読み取れるのは${MAX_FILES}枚までです。`);
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

// ---- 2. 読み取り -------------------------------------------------------------------

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

async function readOne(row) {
  row.status = 'reading'; row.error = '';
  try {
    const { base64 } = await toJpeg(row.file);
    applyResult(row, await api('/api/receipt', { image: base64 }));
  } catch (e) {
    row.status = 'error';
    row.error = e instanceof Error ? e.message : '読み取れませんでした';
  }
}

async function readAll(targets) {
  $('step2').hidden = false;
  $('go').disabled = true;
  let done = 0;
  const update = () => {
    $('bar').style.width = `${(done / targets.length) * 100}%`;
    $('progress-text').textContent = `${done} / ${targets.length} 枚を読み取りました`;
  };
  update();
  await pool(targets, CONCURRENCY, async (row) => { await readOne(row); done++; update(); });
  $('step2').hidden = true;
  $('go').disabled = files.length === 0;
  renderRows();
  $('step3').hidden = false;
  $('step4').hidden = false;
  $('step3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('go').addEventListener('click', () => {
  rows = files.map(blankRow);
  readAll(rows);
});
$('retry').addEventListener('click', () => readAll(rows.filter((r) => r.status === 'error' && r.file)));
$('add').addEventListener('click', () => {
  const f = { id: nextId++, file: null, filename: '（手入力）', thumb: '' };
  const r = blankRow(f); r.status = 'done';
  rows.push(r);
  $('step3').hidden = false; $('step4').hidden = false;
  renderRows();
});

// ---- 3. 確認・修正 -----------------------------------------------------------------

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
      h('option', { value: '' }, '（選択してください）'),
      ACCOUNTS.map((a) => h('option', { value: a, selected: a === row.account }, a)));
    const tr = h('tr', { dataset: { id: row.id } },
      td('#', String(i + 1), { class: 'nolabel' }),
      td('画像', row.thumb
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
      td('要確認', h('div', { class: 'flags' }), { class: 'rowflag', dataset: { label: '要確認', f: 'row' } }),
      td('', h('button', { type: 'button', class: 'small', onclick: () => { rows = rows.filter((r) => r !== row); renderRows(); } }, '削除'), { class: 'nolabel' }),
    );
    body.append(tr);
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
    const box = tr.querySelector('.flags');
    clear(box);
    if (row.error) box.append(h('span', { class: 'flag red' }, row.error));
    for (const f of c.flags) box.append(h('span', { class: `flag ${f.level}` }, f.message));
    if (!row.error && !c.flags.length) box.append(h('span', { class: 'small-note' }, 'OK'));
  });
  const red = checks.filter((c) => worstLevel(c.flags) === 'red').length;
  const yellow = checks.filter((c) => worstLevel(c.flags) === 'yellow').length;
  $('summary').textContent = `${rows.length}枚：要確認（赤）${red}枚／注意（黄）${yellow}枚`;
}

function zoom(row) {
  const dlg = $('zoom');
  dlg.querySelector('img').src = row.thumb;
  dlg.showModal();
}
$('zoom').addEventListener('click', () => $('zoom').close());

// ---- 4. Excel ---------------------------------------------------------------------

const styleInputs = document.querySelectorAll('input[name=style]');
styleInputs.forEach((el) => el.addEventListener('change', () => {
  $('credit-label').hidden = document.querySelector('input[name=style]:checked').value !== 'journal';
}));

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const style = document.querySelector('input[name=style]:checked').value;
  const checks = checkReceipts(rows);
  const wb = buildReceiptWorkbook(window.ExcelJS, rows, checks, { style, creditAccount: $('credit').value });
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), `レシート_${style === 'journal' ? '仕訳' : '明細'}_${stamp()}.xlsx`);
});

renderThumbs();
