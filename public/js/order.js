// 受注デモ：FAX・紙の注文書 → 受注データ。1 注文書を選ぶ（写真・PDF）→ 2 確かめる → 3 受注データにする
// AIは注文書を読むだけ。商品・取引先の照合、数量×単価の検算、納品日の確かめは order-check.js（プログラム）が行う。
// 動きは「いま出ている結果の見せ方」だけ。読み取りを待たせたり、測った秒数を変えたりはしない。
import {
  requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, pool, setStep,
} from './common.js';
import { toJpeg } from './image.js';
import { checkOrder, worst, levelAt } from './order-check.js';
import { orderRows, buildOrderWorkbook, orderCsv, orderCsvBlob } from './order-xlsx.js';
import { sjisUnmappable } from './sjis.js';
import { mountEstimate } from './estimate-ui.js';
import { defaultValues } from './estimate.js';
import { reduced, countUp, stagger, replay, flash, onVisible } from './motion.js';

requireAuth();

const MAX_SHEETS = 10;
const PDF_PAGES = 3;
const CONCURRENCY = 3;
const READ_LABELS = { pending: '待ち', reading: '読み取り中', done: '済', error: '読めず' };
const PDF_DIR = '/vendor/pdfjs/';

const $ = (id) => document.getElementById(id);
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }); // YYYY-MM-DD（日本の日付）
const jpDate = (iso) => (iso ? `${+iso.slice(0, 4)}年${+iso.slice(5, 7)}月${+iso.slice(8, 10)}日` : '');

let master = { products: [], customers: [] };
let samples = [];
let sheets = []; // 選んだ注文書（PDF はページごとに1枚）
let orders = []; // 読み取った注文書（確かめる対象）
let checks = [];
let nextId = 1;
let elapsedSec = null;
// 1枚の手入力の分（仮置き）。上の「手入力なら約」と下の「御社の場合」で同じ値を使う
let minutesPerSheet = defaultValues('order').before;
let minsInput = null; // 上の「1枚 ◯ 分」の欄（大きな数字を作るときにできる）
const est = mountEstimate($('estimate'), {
  keys: ['order'],
  onChange: (_, v) => {
    if (v.before === minutesPerSheet) return;
    minutesPerSheet = v.before;
    if (minsInput) minsInput.value = String(minutesPerSheet); // 上の欄もそろえる
    if (stats.count) refresh();
  },
});

const pickMsg = (text) => { $('pick-msg').textContent = text; };

// ---- 1. 注文書を選ぶ ------------------------------------------------------------------

const shown = new Set();
const readState = new Map();
const thumbEls = new Map();

function pushSheet(s) {
  if (sheets.length >= MAX_SHEETS) return false;
  sheets.push({ id: nextId++, ...s });
  return true;
}

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(`${PDF_DIR}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_DIR}pdf.worker.min.mjs`;
  }
  return pdfjs;
}

/** PDF の1〜3ページ目を、1ページずつ JPEG にする（画面の中で行う。PDF は送らない） */
async function pdfToImages(file, room) {
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: false, // 端末の書体を URL で読みに行かない（CSP の font-src に止められるため）。標準書体は同梱のものを使う
    cMapUrl: `${PDF_DIR}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${PDF_DIR}standard_fonts/`,
  }).promise;
  try {
    const n = Math.min(doc.numPages, PDF_PAGES, room);
    const base = (file.name || '注文書.pdf').replace(/\.pdf$/i, '');
    const out = [];
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 2000 / Math.max(v1.width, v1.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      page.cleanup();
      if (!blob) throw new Error('PDFを画像にできませんでした');
      out.push(new File([blob], `${base}_p${i}.jpg`, { type: 'image/jpeg' }));
    }
    return { pages: out, total: doc.numPages };
  } finally {
    doc.destroy();
  }
}

/** 写真の一時 URL を捨てる。確かめる札（読み取った注文書）がまだ使っていれば、捨てない */
const revoke = (url) => { if (url.startsWith('blob:') && !orders.some((o) => o.thumb === url)) URL.revokeObjectURL(url); };

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

async function addFiles(list) {
  const notes = [];
  let over = false;
  for (const f of [...list]) {
    const room = MAX_SHEETS - sheets.length;
    if (room <= 0) { over = true; break; }
    if (isPdf(f)) {
      pickMsg(`${f.name} を画像にしています…`);
      try {
        const { pages, total } = await pdfToImages(f, room);
        for (const p of pages) pushSheet({ file: p, filename: p.name, thumb: URL.createObjectURL(p) });
        if (total > pages.length) notes.push(`${f.name}：${total}ページのうち${pages.length}ページを入れました`);
      } catch (e) {
        notes.push(`${f.name}：${e?.name === 'PasswordException' ? 'パスワード付きのPDFは読めません' : 'PDFを開けませんでした'}`);
      }
    } else if (f.type.startsWith('image/')) {
      pushSheet({ file: f, filename: f.name || `撮影${nextId}.jpg`, thumb: URL.createObjectURL(f) });
    } else {
      notes.push(`${f.name}：写真かPDFを選んでください`);
    }
  }
  if (over) notes.push(`1回に読み取れるのは${MAX_SHEETS}枚までです`);
  pickMsg(notes.join('。'));
  renderThumbs();
}

const loadingSamples = new Set(); // 読み込み中の見本（続けて押しても2枚入らないように）
const sampleName = (s) => s.label.replace(/：.*$/, '');

async function addSample(s) {
  if (loadingSamples.has(s.id) || sheets.some((x) => x.sample === s.id)) return;
  if (sheets.length >= MAX_SHEETS) { pickMsg(`1回に読み取れるのは${MAX_SHEETS}枚までです`); return; }
  loadingSamples.add(s.id);
  try {
    const res = await fetch(`/samples/orders/${s.file}`);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    if (!sheets.some((x) => x.sample === s.id)) {
      pushSheet({ file: new File([blob], s.file, { type: 'image/jpeg' }), filename: s.file, label: sampleName(s), thumb: `/samples/orders/${s.file}`, sample: s.id, asOf: s.asOf, kind: s.kind });
    }
    pickMsg('');
  } catch {
    pickMsg('見本を読み込めませんでした。再読み込みしてお試しください');
  } finally {
    loadingSamples.delete(s.id);
  }
  renderThumbs();
}

/** 見本の札は1回だけ作る（押すたびに作り直すと、キーボードの位置が外れるため）。押すと入る・もう一度押すと外れる */
function renderSamples() {
  const box = clear($('samples'));
  for (const s of samples) {
    box.append(h('button', {
      type: 'button', class: 'sample', 'aria-pressed': 'false', dataset: { id: s.id },
      onclick: () => {
        if (loadingSamples.has(s.id)) return;
        const cur = sheets.find((x) => x.sample === s.id);
        if (cur) removeSheet(cur); else addSample(s);
      },
    },
    h('img', { src: `/samples/orders/${s.file}`, alt: '', loading: 'lazy' }),
    h('span', { class: 'sample-name' }, sampleName(s), h('small', {}, s.label.replace(/^.*?：/, ''))),
    h('span', { class: `badge ${s.kind === '印字' ? 'gray' : 'yellow'}` }, s.kind)));
  }
  if (samples.length) {
    box.append(h('button', {
      type: 'button', class: 'link sample-all',
      onclick: async () => { for (const s of samples) if (!sheets.some((x) => x.sample === s.id)) await addSample(s); },
    }, '見本を3枚とも入れる'));
  }
  syncSamples();
}

function syncSamples() {
  for (const b of $('samples').querySelectorAll('button.sample')) {
    b.setAttribute('aria-pressed', String(sheets.some((x) => x.sample === b.dataset.id)));
  }
  // 3枚とも入ったら「3枚とも入れる」は出さない（押しても何も起きないため）
  const all = $('samples').querySelector('.sample-all');
  if (all) all.hidden = samples.every((x) => sheets.some((y) => y.sample === x.id));
}

function removeSheet(f) {
  sheets = sheets.filter((x) => x !== f);
  revoke(f.thumb);
  renderThumbs();
}

function renderThumbs() {
  const box = clear($('thumbs'));
  thumbEls.clear();
  let fresh = 0;
  for (const f of sheets) {
    const state = readState.get(f.id) || '';
    const st = h('span', { class: 'st' }, READ_LABELS[state] || '');
    const shot = h('span', { class: state === 'reading' ? 'shot scanning' : 'shot' }, h('img', { src: f.thumb, alt: f.filename }), st);
    const fig = h('figure', { class: shown.has(f.id) ? 'seen' : '', dataset: { state } },
      shot,
      h('button', { type: 'button', title: '外す', 'aria-label': `${f.filename}を外す`, onclick: () => removeSheet(f) }, '×'),
      h('figcaption', {}, f.sample ? `見本：${f.label}` : f.filename));
    if (!shown.has(f.id)) { fig.style.setProperty('--i', String(Math.min(fresh++, 12))); shown.add(f.id); }
    thumbEls.set(f.id, { fig, shot, st });
    box.append(fig);
  }
  $('count').textContent = sheets.length ? `${sheets.length} / ${MAX_SHEETS} 枚` : '';
  const go = $('go');
  const wasOff = go.disabled;
  go.disabled = sheets.length === 0 || reading;
  if (wasOff && !go.disabled) replay(go, 'attn');
  $('step1').classList.toggle('has-files', sheets.length > 0);
  syncSamples();
}

function markThumb(id, state) {
  readState.set(id, state);
  const el = thumbEls.get(id);
  if (!el) return;
  el.fig.dataset.state = state;
  el.shot.classList.toggle('scanning', state === 'reading');
  el.st.textContent = READ_LABELS[state] || '';
}

$('cam').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('pick').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('clear').addEventListener('click', () => {
  const old = sheets;
  sheets = []; pickMsg('');
  old.forEach((f) => revoke(f.thumb));
  renderThumbs();
});

const drop = $('drop');
const carriesFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (e) => { if (!carriesFiles(e)) return; e.preventDefault(); drop.classList.add('over'); });
}
drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); });
drop.addEventListener('drop', (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  drop.classList.remove('over');
  addFiles(e.dataTransfer.files);
});

// ---- 読み取り -------------------------------------------------------------------------

const blankOrder = (s) => ({
  id: s.id, sheet: s, filename: s.filename, label: s.label || '', thumb: s.thumb, sample: s.sample || '', kind: s.kind || '',
  asOf: s.asOf || '', status: 'pending', error: '',
  customer: '', customerCode: '', orderDate: '', deliveryDate: '', note: '', conf: {}, lines: [],
});

function applyResult(o, d) {
  Object.assign(o, {
    status: d.is_order ? 'done' : 'error',
    error: d.is_order ? '' : '注文書として読み取れませんでした。手入力で直してください',
    customer: d.customer, customerCode: '', orderDate: d.order_date, deliveryDate: d.delivery_date, note: d.note,
    conf: d.confidence,
    lines: d.lines.map((l) => ({
      name: l.name, spec: l.spec, qty: l.qty, unit: l.unit, unitPrice: l.unit_price, amount: l.amount,
      conf: { name: l.conf_name, qty: l.conf_qty }, productCode: '', confirmed: false,
    })),
  });
}

const phase = (n, text) => { $('phase').textContent = `${n}枚目：${text}`; };

async function readOne(o, n) {
  o.status = 'reading'; o.error = '';
  try {
    phase(n, '画像を縮めて、向きを直しています');
    const { base64 } = await toJpeg(o.sheet.file);
    phase(n, 'AIが発注元・納品日・明細を読んでいます');
    applyResult(o, await api('/api/order', { image: base64, sample: o.sample }));
    phase(n, '商品マスタと照らし合わせています');
  } catch (e) {
    o.status = 'error';
    o.error = e instanceof Error ? e.message : '読み取れませんでした';
  }
}

function startClock(t0) {
  const el = $('clock');
  let on = !reduced() && typeof requestAnimationFrame === 'function';
  const tick = () => {
    if (!on) return;
    el.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}秒`;
    requestAnimationFrame(tick);
  };
  el.textContent = '';
  tick();
  return () => { on = false; el.textContent = ''; };
}

let reading = false;
/** @param retry 読めなかった分だけを読み直すとき（かかった時間は、前の分に足す） */
async function readAll(targets, { retry = false } = {}) {
  reading = true;
  $('reading').hidden = false;
  $('reading').dataset.state = 'busy';
  $('go').disabled = true;
  $('retry').disabled = true;
  setStep(1);
  for (const o of targets) markThumb(o.id, 'pending');
  const t0 = performance.now();
  const stopClock = startClock(t0);
  let done = 0;
  const update = () => {
    $('bar').style.width = `${(done / targets.length) * 100}%`;
    $('progress-text').textContent = `${done} / ${targets.length} 枚を読み取りました`;
  };
  update();
  await pool(targets, CONCURRENCY, async (o) => {
    markThumb(o.id, 'reading');
    await readOne(o, orders.indexOf(o) + 1);
    markThumb(o.id, o.status === 'done' ? 'done' : 'error');
    done++; update();
  });
  const sec = (performance.now() - t0) / 1000;
  elapsedSec = retry && elapsedSec != null ? elapsedSec + sec : sec;
  stopClock();
  reading = false;
  $('reading').dataset.state = targets.some((o) => o.status === 'error') ? 'ended' : 'done';
  $('phase').textContent = `読み取りが終わりました（${sec.toFixed(1)}秒）`;
  $('go').disabled = sheets.length === 0;
  $('retry').disabled = false;
  renderOrders({ quiet: true });
  stagger($('orders'));
  $('step2').hidden = false;
  $('step3').hidden = false;
  setStep(2);
  $('step2').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  primeStats();
  onVisible($('stats'), playStats);
}

$('go').addEventListener('click', () => {
  if (reading) return;
  const before = orders;
  orders = sheets.map(blankOrder);
  // 前の結果の札は消してから読む（読み取り中に古い欄を触って、新しい注文書と食い違わないように）
  clear($('orders'));
  $('step2').hidden = true;
  $('step3').hidden = true;
  before.forEach((o) => { if (!sheets.some((x) => x.thumb === o.thumb)) revoke(o.thumb); });
  readState.clear();
  readAll(orders);
});
$('retry').addEventListener('click', () => { if (!reading) readAll(orders.filter((o) => o.status === 'error'), { retry: true }); });

// ---- 2. 確かめる ---------------------------------------------------------------------

/** 数の欄：全角・カンマ・円を取り除く。丸めない（1.5個 は「数ではない」として赤にするため） */
const toNum = (s) => {
  const t = String(s).normalize('NFKC').replace(/[,円¥\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const numText = (v) => (v == null || Number.isNaN(v) ? '' : String(v));
const productLabel = (p) => `${p.code} ${p.name}${p.spec ? ` ${p.spec}` : ''}`;

/**
 * @param conf 人が直したら「確かさ」を高にする項目（AIの自信のなさの印は、人が確かめたら消す）
 */
function textInput(obj, key, label, { num = false, placeholder = '', conf = '' } = {}) {
  // 数でない文字を入れたときは、その文字を覚えておく（札を作り直しても、空の欄に赤だけ残らないように）
  const shownValue = num ? (Number.isNaN(obj[key]) ? obj.raw?.[key] ?? '' : numText(obj[key])) : obj[key] ?? '';
  return h('input', {
    type: 'text', value: shownValue, inputMode: num ? 'numeric' : undefined, placeholder, 'aria-label': label,
    oninput: (e) => {
      obj[key] = num ? toNum(e.target.value) : e.target.value;
      if (num) obj.raw = { ...obj.raw, [key]: e.target.value };
      if (conf) obj.conf = { ...obj.conf, [conf]: '高' };
      refresh();
    },
  });
}

/** 照合の結果を、選ぶ欄の最初の札に出す（人が選んでいないときの扱い） */
function autoProductText(r) {
  const m = r.match;
  // 狭い欄に入るよう短く書く。理由は「確かめる点」に出る
  if (m.kind === 'exact') return productLabel(m.product);
  if (m.kind === 'alias' || m.kind === 'similar') return `候補：${productLabel(m.product)}`;
  if (m.kind === 'nospec') return '規格を選んでください';
  if (m.kind === 'badspec') return '規格を確かめてください';
  if (m.kind === 'empty') return '（選んでください）';
  return '未登録';
}
function autoCustomerText(c) {
  const m = c.customer.match;
  if (m.kind === 'exact') return `一致：${m.customer.code} ${m.customer.name}`;
  if (m.kind === 'similar') return `候補：${m.customer.code} ${m.customer.name}`;
  return 'マスタにありません';
}

function productSelect(line) {
  const sel = h('select', {
    'aria-label': '商品マスタの商品',
    onchange: (e) => {
      line.productCode = e.target.value; line.confirmed = Boolean(e.target.value);
      if (line.confirmed) line.conf = { ...line.conf, name: '高' };
      refresh();
    },
  },
  h('option', { value: '' }, ''),
  h('optgroup', { label: '候補' }),
  h('optgroup', { label: 'すべての商品' }, master.products.map((p) => h('option', { value: p.code }, productLabel(p)))));
  return sel;
}

/** 候補の札を、照合の結果に合わせて入れ替える（候補が変わったときだけ） */
function syncProductSelect(sel, line, r) {
  sel.options[0].textContent = autoProductText(r);
  const cands = r.match.candidates.map((p) => p.code);
  const key = cands.join('|');
  const group = sel.querySelector('optgroup');
  if (group.dataset.key !== key) {
    clear(group).append(...r.match.candidates.map((p) => h('option', { value: p.code }, productLabel(p))));
    group.dataset.key = key;
    group.hidden = !cands.length;
  }
  // 値は「人が選んだもの」だけ。候補の札と、すべての商品の札の両方にある値は、最初に見つかったほうになる（どちらでも同じ商品）
  if (sel.value !== (line.productCode || '')) sel.value = line.productCode || '';
}

const blankLine = () => ({ name: '', spec: '', qty: null, unit: '', unitPrice: null, amount: null, conf: {}, productCode: '', confirmed: false });

function lineRow(o, line, idx) {
  const td = (label, content, extra = {}) => h('td', { dataset: { label, ...(extra.f ? { f: extra.f } : {}) }, class: extra.class }, content);
  return h('tr', {},
    td('#', String(idx + 1), { class: 'nolabel' }),
    td('注文書の品名', textInput(line, 'name', '注文書の品名（読んだまま）', { conf: 'name' }), { f: 'read' }),
    td('規格', textInput(line, 'spec', '規格'), { f: 'spec' }),
    td('商品マスタ', productSelect(line), { f: 'name', class: 'prod' }),
    td('数量', textInput(line, 'qty', '数量', { num: true, conf: 'qty' }), { f: 'qty', class: 'num' }),
    td('単位', textInput(line, 'unit', '単位'), { f: 'unit' }),
    td('単価', [textInput(line, 'unitPrice', '単価', { num: true }), h('small', { class: 'calc' })], { f: 'unitPrice', class: 'num' }),
    td('金額', [textInput(line, 'amount', '金額', { num: true }), h('small', { class: 'calc' })], { f: 'amount', class: 'num' }),
    td('確かめる点', h('div', { class: 'flags' }), { f: 'row', class: 'rowflag' }),
    td('', h('button', {
      type: 'button', class: 'small', 'aria-label': `${idx + 1}行目を削除`,
      onclick: () => { o.lines = o.lines.filter((l) => l !== line); renderOrders(); },
    }, '削除'), { class: 'nolabel' }),
  );
}

function headField(label, f, control) {
  return h('label', { class: 'hf lv', dataset: { f } }, h('span', {}, label), control);
}

function orderCard(o, i) {
  const custSel = h('select', {
    'aria-label': '取引先マスタの取引先',
    onchange: (e) => { o.customerCode = e.target.value; if (o.customerCode) o.conf = { ...o.conf, customer: '高' }; refresh(); },
  }, h('option', { value: '' }, ''), master.customers.map((c) => h('option', { value: c.code }, `${c.code} ${c.name}`)));
  const thumb = o.thumb
    ? h('img', {
      class: 'thumb-sm', src: o.thumb, alt: `${o.filename}（拡大）`, tabIndex: 0, role: 'button', onclick: () => zoom(o),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(o); } },
    })
    : null;
  const body = h('tbody', {}, o.lines.map((l, k) => lineRow(o, l, k)));
  return h('article', { class: 'ocard', dataset: { id: String(o.id) } },
    h('header', { class: 'ocard-head' },
      thumb,
      h('div', { class: 'ocard-title' },
        h('h3', {}, `注文書 ${i + 1}`),
        h('small', {}, o.sample ? `見本（${o.kind}）：${o.label}` : o.filename)),
      h('span', { class: 'ocard-badge' })),
    o.error ? h('p', { class: 'flag red' }, o.error) : null,
    h('div', { class: 'ohead' },
      headField('取引先（読んだまま）', 'customer', textInput(o, 'customer', '取引先（読んだまま）', { conf: 'customer' })),
      headField('取引先マスタ', 'customer', custSel),
      headField('発注日', 'orderDate', textInput(o, 'orderDate', '発注日', { placeholder: '年/月/日', conf: 'order_date' })),
      headField('納品日', 'deliveryDate', textInput(o, 'deliveryDate', '納品日', { placeholder: '年/月/日', conf: 'delivery_date' }))),
    o.note ? h('p', { class: 'onote' }, h('b', {}, '注文書の備考：'), o.note) : null,
    o.asOf ? h('p', { class: 'small-note asof' }, `見本は、届いた日（${jpDate(o.asOf)}）を「今日」として、納品日が過去かどうかを確かめます。`) : null,
    h('div', { class: 'flags hflags' }),
    h('div', { class: 'tablewrap' },
      h('table', { class: 'stack olines' },
        h('thead', {}, h('tr', {},
          h('th', {}, '#'), h('th', {}, '注文書の品名（読んだまま）'), h('th', {}, '規格'), h('th', {}, '商品マスタ'),
          h('th', { class: 'num' }, '数量'), h('th', {}, '単位'), h('th', { class: 'num' }, '単価'), h('th', { class: 'num' }, '金額'),
          h('th', { class: 'rowflag' }, '確かめる点'), h('th', {}, ''))),
        body)),
    h('div', { class: 'row mt10' },
      h('button', {
        type: 'button', class: 'small',
        onclick: () => {
          o.lines.push(blankLine());
          renderOrders();
          // 作り直した札の、足した行の最初の欄へ
          $('orders').querySelector(`.ocard[data-id="${o.id}"] tbody tr:last-child input`)?.focus();
        },
      }, '明細の行を足す')),
  );
}

function renderOrders(opts = {}) {
  const box = clear($('orders'));
  box.classList.remove('stagger');
  orders.forEach((o, i) => box.append(orderCard(o, i)));
  $('retry').hidden = !orders.some((o) => o.status === 'error');
  refresh(opts);
}

function paint(el, lv) {
  el.classList.remove('red', 'yellow');
  if (lv) el.classList.add(lv);
  const now = lv || '';
  if (el.dataset.lv !== undefined && el.dataset.lv !== now) flash(el);
  el.dataset.lv = now;
}

function putFlags(box, flags, extra = []) {
  clear(box);
  for (const t of extra) box.append(h('span', { class: 'flag red' }, t));
  for (const f of flags) box.append(h('span', { class: `flag ${f.level}` }, f.message));
}

/** 入力のたびに確かめ直して、色と指摘だけ書き換える（入力欄は作り直さない） */
function refresh(opts = {}) {
  checks = orders.map((o) => checkOrder(o, master, o.asOf || todayIso()));
  let red = 0; let yellow = 0; let lineCount = 0;
  let unread = 0;
  [...$('orders').children].forEach((card, i) => {
    const o = orders[i]; const c = checks[i];
    if (!o || !c) return;
    // 読めなかった注文書で、まだ何も入れていないとき：見出しの照合（マスタに無い・納品日が空）は出さない。「読めなかった」だけを出す
    const blank = o.status === 'error' && !o.lines.length && !o.customer && !o.orderDate && !o.deliveryDate;
    const headFlags = blank ? [] : c.header.flags;
    if (o.status === 'error') unread++;
    // 見出しの欄
    for (const el of card.querySelectorAll('.ohead .hf')) paint(el, levelAt(headFlags, el.dataset.f));
    const custSel = card.querySelector('.ohead select');
    custSel.options[0].textContent = blank ? '（選んでください）' : autoCustomerText(c);
    if (custSel.value !== (o.customerCode || '')) custSel.value = o.customerCode || '';
    putFlags(card.querySelector('.hflags'), headFlags);
    // 明細
    const trs = card.querySelectorAll('tbody tr');
    const headLevel = worst(headFlags);
    let cardRed = headLevel === 'red' || Boolean(o.error);
    let cardYellow = headLevel === 'yellow';
    if (blank) red++; // 読めなかった注文書も、要確認として数える（出力でも1行になる）
    o.lines.forEach((line, k) => {
      const r = c.lines[k]; const tr = trs[k];
      if (!tr) return;
      lineCount++;
      for (const td of tr.querySelectorAll('td[data-f]')) {
        const f = td.dataset.f;
        if (f === 'row' || f === 'read' || f === 'spec') continue;
        paint(td, levelAt(r.flags, f));
      }
      syncProductSelect(tr.querySelector('td.prod select'), line, r);
      // 注文書に単価・金額が無いとき：決まった商品のマスタの単価と、数量×単価を小さく出す（候補のままなら出さない）
      const [priceNote, amountNote] = tr.querySelectorAll('small.calc');
      const fromMaster = r.settled && r.priceFrom === 'マスタ';
      // ケースのときは、もとの単価と入数も出す（1ケースの値段だけだと、マスタと違うように見える）
      priceNote.textContent = !fromMaster ? '' : r.perUnit > 1 ? `マスタ ${yen(r.product.price)}×${r.perUnit}${r.product.unit}` : `マスタ ${yen(r.price)}`;
      amountNote.textContent = typeof line.amount !== 'number' && r.settled && r.amount != null ? `計算 ${yen(r.amount)}` : '';
      const box = tr.querySelector('.flags');
      putFlags(box, r.flags);
      // 行の色の数え方は、出力（Excel の要確認の列）と同じ：見出しの指摘も、その注文書の全部の行に入る
      const lv = worst([...headFlags, ...r.flags]);
      if (lv === 'red') red++; else if (lv === 'yellow') yellow++;
      if (r.flags.some((x) => x.level === 'red')) cardRed = true;
      if (r.flags.some((x) => x.level === 'yellow')) cardYellow = true;
      if (!r.flags.length && headLevel) box.append(h('span', { class: `flag ${headLevel}` }, '注文書の見出し（取引先・日付）を確かめてください'));
      const ok = !lv;
      if (ok) box.append(h('span', { class: tr.dataset.ok === '0' ? 'badge ok fresh' : 'badge ok' }, 'OK'));
      tr.dataset.ok = ok ? '1' : '0';
      tr.classList.toggle('dupe', r.flags.some((x) => x.field === 'row'));
    });
    const badge = card.querySelector('.ocard-badge');
    badge.className = `ocard-badge badge ${blank ? 'red' : cardRed ? 'red' : cardYellow ? 'yellow' : 'ok'}`;
    badge.textContent = blank ? '読めず' : cardRed ? '要確認あり' : cardYellow ? '注意あり' : 'OK';
  });
  $('summary').textContent = `${orders.length}枚${unread ? `（読めず${unread}枚）` : ''}・明細${lineCount}行：要確認（赤）${red}行／注意（黄）${yellow}行`;
  renderStats(lineCount, red, yellow, opts.quiet);
  // 出力の前に知らせる（ボタンより上・注意の面）
  const note = $('export-note');
  note.textContent = red
    ? `要確認（赤）が${red}行あります${unread ? `（読めなかった注文書${unread}枚を含む）` : ''}。出力はできますが、「要確認」の列とシートに理由が入ります。取引先に確かめてから使ってください。`
    : '';
  note.hidden = !red;
  checkSjis();
}

/** Shift_JIS を選んでいるとき、変換できない文字を、ダウンロードの前に知らせる */
function checkSjis(after = false) {
  const warn = $('sjis-warn');
  const sjis = document.querySelector('input[name=enc]:checked')?.value === 'sjis';
  const bad = sjis && orders.length ? [...new Set(sjisUnmappable(orderCsv(rowsNow())))] : [];
  warn.hidden = !bad.length;
  warn.textContent = bad.length
    ? `Shift_JIS にできない文字があります${after ? '（「?」に置き換えました）' : '（CSV では「?」になります）'}：${bad.join(' ')}。UTF-8 で出すか、品名を直してください。`
    : '';
}

// 大きな数字。入れ物は1回だけ作り、数字だけ入れ替える
const stats = {};
let linesEm = null; // 「明細 ◯ 行」（読み取った注文書の下）
const whole = (n) => String(Math.round(n));

function buildStats() {
  const stat = (key, label, unit, cls = '', extra = null) => {
    const b = h('b', {}, h('span', { class: 'v' }), h('small', {}, unit));
    const box = h('div', { class: `stat s-${key} ${cls}` }, h('span', {}, label), b, extra);
    stats[key] = { box, b, text: null, num: null, mid: whole };
    return box;
  };
  const mins = h('input', {
    type: 'number', min: '0', max: '60', step: '0.5', value: String(minutesPerSheet), inputMode: 'decimal', 'aria-label': '1枚の手入力の分',
    onchange: (e) => {
      // 下の「御社の場合」と同じ範囲に寄せた値にそろえる
      minutesPerSheet = est.set('order', 'before', Math.max(0, Number(e.target.value) || 0));
      e.target.value = String(minutesPerSheet);
      refresh();
    },
  });
  minsInput = mins;
  const bar = () => h('i', { class: 'cmp', 'aria-hidden': 'true', hidden: true }, h('i', { class: 'grow' }));
  linesEm = h('em', {});
  clear($('stats')).append(
    stat('count', '読み取った注文書', '枚', '', linesEm),
    stat('time', 'かかった時間', '秒', 'good', bar()),
    stat('manual', '手入力なら約', '分', '', [bar(), h('em', {}, '1枚 ', mins, ' 分（仮置き）')]),
    stat('red', '要確認（赤）', '行'),
    stat('yellow', '注意（黄）', '行'),
  );
}

function putStat(key, text, num, mid, quiet) {
  const s = stats[key];
  const changed = s.text !== null && s.text !== text;
  if (s.text === text) return;
  const v = h('span', { class: 'v' }, text);
  s.b.replaceChild(v, s.b.firstChild);
  if (changed && !quiet) {
    if (num != null && s.num != null && key !== 'red' && key !== 'yellow') {
      v.textContent = mid(s.num);
      countUp(v, num, { from: s.num, duration: 450, format: (n) => (n === num ? text : mid(n)) });
    }
    flash(s.box);
  }
  Object.assign(s, { text, num, mid });
}

function renderStats(lineCount, red, yellow, quiet = false) {
  if (!stats.count) buildStats();
  const read = orders.filter((o) => o.status === 'done').length;
  const manual = Math.round(orders.length * minutesPerSheet * 10) / 10;
  putStat('count', String(read), read, whole, quiet);
  linesEm.textContent = `明細 ${lineCount} 行`;
  putStat('time', elapsedSec == null ? '—' : elapsedSec.toFixed(1), elapsedSec, (n) => n.toFixed(1), quiet);
  putStat('manual', String(manual), manual, Number.isInteger(manual) ? whole : (n) => (Math.round(n * 10) / 10).toFixed(1), quiet);
  putStat('red', String(red), red, whole, quiet);
  putStat('yellow', String(yellow), yellow, whole, quiet);
  stats.red.box.classList.toggle('danger', red > 0);
  stats.yellow.box.classList.toggle('warn', yellow > 0);
  const manualSec = manual * 60;
  const show = elapsedSec != null && manualSec > 0;
  const scale = show ? Math.max(elapsedSec, manualSec) : 1;
  for (const [key, sec] of [['time', elapsedSec], ['manual', manualSec]]) {
    const cmp = stats[key].box.querySelector('.cmp');
    cmp.hidden = !show;
    if (show) cmp.firstChild.style.setProperty('--w', `${(sec / scale) * 100}%`);
  }
}

function primeStats() {
  if (reduced()) return;
  for (const [key, s] of Object.entries(stats)) {
    if (s.num == null || key === 'red' || key === 'yellow' || key === 'time') continue;
    s.b.replaceChild(h('span', { class: 'v' }, s.mid(0)), s.b.firstChild);
  }
}

function playStats() {
  for (const [key, s] of Object.entries(stats)) {
    if (s.num == null || key === 'red' || key === 'yellow' || key === 'time') continue;
    const { text, num, mid } = s;
    const v = h('span', { class: 'v' }, mid(0));
    s.b.replaceChild(v, s.b.firstChild);
    countUp(v, num, { duration: 900, format: (n) => (n === num ? text : mid(n)) });
  }
  replay($('stats'));
}

function zoom(o) {
  const dlg = $('zoom');
  dlg.querySelector('img').src = o.thumb;
  dlg.showModal();
}
$('zoom').addEventListener('click', () => $('zoom').close());

// ---- 3. 受注データにする ----------------------------------------------------------------

const rowsNow = () => orderRows(orders, checks, master);

function made(text, filename) {
  const el = $('made');
  clear(el).append(text, h('span', { class: 'fn' }, filename));
  el.hidden = false;
  replay(el, 'in');
  setStep(4);
}

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const wb = buildOrderWorkbook(window.ExcelJS, rowsNow());
  const buf = await wb.xlsx.writeBuffer();
  const filename = `受注一覧_${stamp()}.xlsx`;
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename);
  made('Excelを作りました：', filename);
});

$('csv').addEventListener('click', () => {
  const enc = document.querySelector('input[name=enc]:checked').value;
  const { blob, unmappable } = orderCsvBlob(rowsNow(), enc);
  const filename = `受注一覧_${stamp()}_${enc === 'sjis' ? 'SJIS' : 'UTF8'}.csv`;
  downloadBlob(blob, filename);
  if (unmappable.length) checkSjis(true);
  made('CSVを作りました：', filename);
});
document.querySelectorAll('input[name=enc]').forEach((el) => el.addEventListener('change', () => { $('made').hidden = true; checkSjis(); }));

// ---- はじめ ---------------------------------------------------------------------------

async function start() {
  try {
    const [m, s] = await Promise.all([
      fetch('/data/products.json').then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch('/samples/orders/samples.json').then((r) => (r.ok ? r.json() : Promise.reject())),
    ]);
    master = m; samples = s.samples;
  } catch {
    pickMsg('商品マスタを読み込めませんでした。再読み込みしてお試しください');
  }
  renderSamples();
  renderThumbs();
}

renderThumbs();
setStep(1);
start();
