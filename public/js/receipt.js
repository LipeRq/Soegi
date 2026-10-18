// 経理デモ：レシート → Excel。1 撮る・読み込む（3枚ずつ並行）→ 2 確かめる → 3 Excelにする
// 動きは「いま出ている結果の見せ方」だけ。読み取りを待たせたり、測った秒数を変えたりはしない。
import {
  requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, pool, setStep,
} from './common.js';
import { toJpeg } from './image.js';
import { checkReceipts, levelOf, worstLevel } from './receipt-check.js';
import { buildReceiptWorkbook } from './receipt-xlsx.js';
import { mountEstimate } from './estimate-ui.js';
import { defaultValues } from './estimate.js';
import { reduced, countUp, stagger, replay, flash, onVisible } from './motion.js';

requireAuth();

const MAX_FILES = 20;
const CONCURRENCY = 3;
const ACCOUNTS = ['消耗品費', '事務用品費', '旅費交通費', '車両費（燃料）', '通信費', '会議費', '接待交際費', '福利厚生費', '新聞図書費', '雑費'];
const STYLE_NOTES = {
  standard: '1枚1行の明細に、科目別の集計と「要確認」の行だけのシートが付きます。',
  journal: '会計ソフトに取り込みやすい、日付・借方・貸方・金額・摘要の5列です。',
  office: '架空の会計事務所の取り込み様式の例です。10%と8%が混ざったレシートは税区分ごとに行を分けます。お試し導入では、御社の様式に列を合わせます。',
};
// 写真ごとの読み取りの状態（色だけにせず、必ず言葉も出す）
const READ_LABELS = { pending: '待ち', reading: '読み取り中', done: '済', error: '読めず' };

const $ = (id) => document.getElementById(id);

let files = []; // 選んだ写真
let rows = []; // 読み取り結果（確かめる対象）
let nextId = 1;
let elapsedSec = null;
// 1枚の手入力の分（仮置き）。上の「手入力なら約」と下の「御社の場合」で同じ値を使う
let minutesPerReceipt = defaultValues('receipt').before;
let minsInput = null; // 上の「1枚 ◯ 分」の欄（大きな数字を作るときにできる）
const est = mountEstimate($('estimate'), {
  keys: ['receipt'],
  onChange: (_, v) => {
    if (v.before === minutesPerReceipt) return;
    minutesPerReceipt = v.before;
    if (minsInput) minsInput.value = String(minutesPerReceipt); // 上の「1枚 ◯ 分」の欄もそろえる
    if (stats.count) refresh();
  },
});

// ---- 1. 撮る・選ぶ -----------------------------------------------------------------

const shown = new Set(); // 一度出した写真（出てくる動きは、新しく足した写真だけにする）
const readState = new Map(); // 写真の id → 読み取りの状態
const thumbEls = new Map(); // 写真の id → 画面の部品（読み取り中に、その1枚だけ書き換える）

function addFiles(list) {
  const room = MAX_FILES - files.length;
  const picked = [...list].filter((f) => f.type.startsWith('image/')).slice(0, room);
  for (const f of picked) files.push({ id: nextId++, file: f, filename: f.name || `撮影${nextId}.jpg`, thumb: URL.createObjectURL(f) });
  if (list.length > room) alert(`1回に読み取れるのは${MAX_FILES}枚までです。`);
  renderThumbs();
}

function renderThumbs() {
  const box = clear($('thumbs'));
  thumbEls.clear();
  let fresh = 0;
  for (const f of files) {
    const state = readState.get(f.id) || '';
    const st = h('span', { class: 'st' }, READ_LABELS[state] || '');
    const shot = h('span', { class: state === 'reading' ? 'shot scanning' : 'shot' }, h('img', { src: f.thumb, alt: f.filename }), st);
    const fig = h('figure', { class: shown.has(f.id) ? 'seen' : '', dataset: { state } },
      shot,
      h('button', { type: 'button', title: '外す', 'aria-label': `${f.filename}を外す`, onclick: () => { URL.revokeObjectURL(f.thumb); files = files.filter((x) => x !== f); renderThumbs(); } }, '×'),
      h('figcaption', {}, f.filename));
    if (!shown.has(f.id)) { fig.style.setProperty('--i', String(Math.min(fresh++, 12))); shown.add(f.id); }
    thumbEls.set(f.id, { fig, shot, st });
    box.append(fig);
  }
  $('count').textContent = files.length ? `${files.length} / ${MAX_FILES} 枚` : '';
  const go = $('go');
  const wasOff = go.disabled;
  go.disabled = files.length === 0;
  // 写真が入ったら、次に押す所（読み取る）を輪で知らせる
  if (wasOff && !go.disabled) replay(go, 'attn');
  $('step1').classList.toggle('has-files', files.length > 0);
}

/** 写真1枚の読み取りの状態を、その場で書き換える（読み取り中の線・済の印） */
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
$('clear').addEventListener('click', () => { files.forEach((f) => URL.revokeObjectURL(f.thumb)); files = []; renderThumbs(); });

// パソコンでは、枠の中に写真を置いても入る（入り方は「写真を選ぶ」と同じ）
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

/**
 * 読み取り中の時計。実際に経った時間をそのまま出す（作った数字ではない）。
 * 終わりの秒数は「読み取りが終わりました（◯秒）」の文と大きな数字に出るので、時計は終わったら消す。
 * @returns 止める関数
 */
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

async function readAll(targets) {
  $('reading').hidden = false;
  $('reading').dataset.state = 'busy';
  $('go').disabled = true;
  setStep(1);
  for (const row of targets) markThumb(row.id, 'pending');
  const t0 = performance.now();
  const stopClock = startClock(t0);
  let done = 0;
  const update = () => {
    $('bar').style.width = `${(done / targets.length) * 100}%`;
    $('progress-text').textContent = `${done} / ${targets.length} 枚を読み取りました`;
  };
  update();
  await pool(targets, CONCURRENCY, async (row) => {
    markThumb(row.id, 'reading');
    await readOne(row, rows.indexOf(row) + 1);
    markThumb(row.id, row.status === 'done' ? 'done' : 'error');
    done++; update();
  });
  elapsedSec = (performance.now() - t0) / 1000;
  stopClock();
  // 読めなかった写真があるときは、緑の印を出さない（終わったことだけを伝える）
  $('reading').dataset.state = targets.some((r) => r.status === 'error') ? 'ended' : 'done';
  $('phase').textContent = `読み取りが終わりました（${elapsedSec.toFixed(1)}秒）`;
  $('go').disabled = files.length === 0;
  renderRows({ quiet: true });
  stagger($('rows'));
  $('step2').hidden = false;
  $('step3').hidden = false;
  setStep(2);
  $('step2').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  // 大きな数字が見える所まで来てから、数え上げる。それまでは最初の形（0）で待つ（本当の数を一度見せてから 0 に戻すと、ちらつくため）
  primeStats();
  onVisible($('stats'), playStats);
}

$('go').addEventListener('click', () => {
  rows = files.map(blankRow);
  readState.clear();
  readAll(rows);
});
$('retry').addEventListener('click', () => readAll(rows.filter((r) => r.status === 'error' && r.file)));
$('add').addEventListener('click', () => {
  const r = blankRow({ id: nextId++, file: null, filename: '（手入力）', thumb: '' });
  r.status = 'done';
  rows.push(r);
  $('step2').hidden = false; $('step3').hidden = false;
  renderRows();
  $('rows').lastElementChild?.classList.add('in');
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

/** @param opts {quiet:true で、数字が変わった所を光らせない（読み取り直後は、あとで数え上げるため）} */
function renderRows(opts = {}) {
  const body = clear($('rows'));
  body.classList.remove('stagger'); // 順に出すのは読み取りの直後だけ（行を消す・足すたびに全部が動かないように）
  rows.forEach((row, i) => {
    const td = (label, content, extra = {}) => h('td', { dataset: { label }, ...extra }, content);
    const account = h('select', { 'aria-label': '勘定科目', onchange: (e) => { row.account = e.target.value; row.conf.account = '高'; refresh(); } },
      h('option', { value: '' }, '（選んでください）'),
      ACCOUNTS.map((a) => h('option', { value: a, selected: a === row.account }, a)));
    body.append(h('tr', { dataset: { id: row.id } },
      td('#', String(i + 1), { class: 'nolabel' }),
      td('写真', row.thumb
        ? h('img', {
          class: 'thumb-sm', src: row.thumb, alt: row.filename, title: row.filename, tabIndex: 0, role: 'button', onclick: () => zoom(row),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom(row); } },
        })
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
  refresh(opts);
}

/** 入力のたびにチェックをやり直して、色と指摘だけ更新する（入力欄は作り直さない） */
function refresh(opts = {}) {
  const checks = checkReceipts(rows);
  [...$('rows').children].forEach((tr, i) => {
    const row = rows[i]; const c = checks[i];
    for (const td of tr.querySelectorAll('td[data-f]')) {
      td.classList.remove('red', 'yellow');
      const lv = levelOf(c.flags, td.dataset.f);
      if (lv && td.dataset.f !== 'row') td.classList.add(lv);
      // 直して色が変わった（消えた）所を、一瞬だけ光らせる。作ったばかりの行は光らせない
      const now = lv || '';
      if (td.dataset.lv !== undefined && td.dataset.lv !== now) flash(td);
      td.dataset.lv = now;
    }
    tr.classList.toggle('dupe', c.duplicate);
    const box = clear(tr.querySelector('.flags'));
    if (row.error) box.append(h('span', { class: 'flag red' }, row.error));
    for (const f of c.flags) box.append(h('span', { class: `flag ${f.level}` }, f.message));
    const ok = !row.error && !c.flags.length;
    // 指摘が無くなった瞬間だけ、OK の印を弾ませる（入力のたびには動かさない）
    if (ok) box.append(h('span', { class: tr.dataset.ok === '0' ? 'badge ok fresh' : 'badge ok' }, 'OK'));
    tr.dataset.ok = ok ? '1' : '0';
  });
  const red = checks.filter((c, i) => worstLevel(c.flags) === 'red' || rows[i].error).length;
  const yellow = checks.filter((c, i) => worstLevel(c.flags) === 'yellow' && !rows[i].error).length;
  $('summary').textContent = `${rows.length}枚：要確認（赤）${red}枚／注意（黄）${yellow}枚`;
  renderStats(red, yellow, opts.quiet);
}

// 大きな数字。入れ物は1回だけ作り、数字だけ入れ替える（入力のたびに作り直すと、出てくる動きが毎回走ってしまう）
const stats = {};
const whole = (n) => String(Math.round(n));

function buildStats() {
  const stat = (key, label, unit, cls = '', extra = null) => {
    const b = h('b', {}, h('span', { class: 'v' }), h('small', {}, unit));
    const box = h('div', { class: `stat s-${key} ${cls}` }, h('span', {}, label), b, extra);
    stats[key] = { box, b, text: null, num: null, mid: whole };
    return box;
  };
  const mins = h('input', {
    type: 'number', min: '0', max: '60', step: '0.5', value: String(minutesPerReceipt), inputMode: 'decimal', 'aria-label': '1枚の手入力の分',
    onchange: (e) => {
      // 下の「御社の場合」と同じ範囲に寄せた値にそろえる
      minutesPerReceipt = est.set('receipt', 'before', Math.max(0, Number(e.target.value) || 0));
      e.target.value = String(minutesPerReceipt);
      refresh();
    },
  });
  minsInput = mins;
  // かかった時間と手入力の時間を、同じ目盛りの棒で並べる（長さは下の数字から計算。飾りなので読み上げない）
  const bar = () => h('i', { class: 'cmp', 'aria-hidden': 'true', hidden: true }, h('i', { class: 'grow' }));
  clear($('stats')).append(
    stat('count', '読み取った枚数', '枚'),
    stat('time', 'かかった時間', '秒', 'good', bar()),
    stat('manual', '手入力なら約', '分', '', [bar(), h('em', {}, '1枚 ', mins, ' 分（仮置き）')]),
    stat('red', '要確認（赤）', '枚'),
    stat('yellow', '注意（黄）', '枚'),
  );
}

/**
 * 数字を1つ入れる。終わりの表示（text）は、今までと同じ書き方の文字。
 * @param num 数え上げに使う数（無ければ文字だけ入れる）
 * @param mid 数え上げの途中の書き方
 */
function putStat(key, text, num, mid, quiet) {
  const s = stats[key];
  const changed = s.text !== null && s.text !== text;
  if (s.text === text) return;
  // 前の数え上げが残っていても混ざらないよう、数字の入れ物ごと取り替える
  const v = h('span', { class: 'v' }, text);
  s.b.replaceChild(v, s.b.firstChild);
  if (changed && !quiet) {
    // 要確認・注意の枚数は、変わったらすぐ出す（数え上げで遅らせない）
    if (num != null && s.num != null && key !== 'red' && key !== 'yellow') {
      v.textContent = mid(s.num);
      countUp(v, num, { from: s.num, duration: 450, format: (n) => (n === num ? text : mid(n)) });
    }
    flash(s.box);
  }
  Object.assign(s, { text, num, mid });
}

function renderStats(red, yellow, quiet = false) {
  if (!stats.count) buildStats();
  const manual = Math.round(rows.length * minutesPerReceipt * 10) / 10;
  putStat('count', String(rows.filter((r) => r.file).length), rows.filter((r) => r.file).length, whole, quiet);
  putStat('time', elapsedSec == null ? '—' : elapsedSec.toFixed(1), elapsedSec, (n) => n.toFixed(1), quiet);
  putStat('manual', String(manual), manual, Number.isInteger(manual) ? whole : (n) => (Math.round(n * 10) / 10).toFixed(1), quiet);
  putStat('red', String(red), red, whole, quiet);
  putStat('yellow', String(yellow), yellow, whole, quiet);
  stats.red.box.classList.toggle('danger', red > 0);
  stats.yellow.box.classList.toggle('warn', yellow > 0);

  // 同じ目盛りの棒：長いほうを 100% にする。どちらかが無いときは出さない
  const manualSec = manual * 60;
  const show = elapsedSec != null && manualSec > 0;
  const scale = show ? Math.max(elapsedSec, manualSec) : 1;
  for (const [key, sec] of [['time', elapsedSec], ['manual', manualSec]]) {
    const cmp = stats[key].box.querySelector('.cmp');
    cmp.hidden = !show;
    if (show) cmp.firstChild.style.setProperty('--w', `${(sec / scale) * 100}%`);
  }
}

/** 数え上げる数字（枚数・手入力なら約）を、数え上げの最初の形にしておく。測った時間と、要確認・注意の枚数は、はじめから本当の数のまま */
function primeStats() {
  if (reduced()) return;
  for (const [key, s] of Object.entries(stats)) {
    if (s.num == null || key === 'red' || key === 'yellow' || key === 'time') continue;
    s.b.replaceChild(h('span', { class: 'v' }, s.mid(0)), s.b.firstChild);
  }
}

/** 読み取りの直後：いまの数字を 0 から数え上げ、棒を伸ばす（終わりの表示は putStat が入れた文字と同じ） */
function playStats() {
  for (const [key, s] of Object.entries(stats)) {
    // 要確認・注意の枚数は数え上げず、最初から本当の数を出す（安全の表示を遅らせない）。かかった時間も測ったままを出す（終わった測定を、動いているように見せない）
    if (s.num == null || key === 'red' || key === 'yellow' || key === 'time') continue;
    const { text, num, mid } = s;
    const v = h('span', { class: 'v' }, mid(0));
    s.b.replaceChild(v, s.b.firstChild);
    countUp(v, num, { duration: 900, format: (n) => (n === num ? text : mid(n)) });
  }
  replay($('stats'));
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
  replay($('style-note'), 'swap');
  $('made').hidden = true; // 前の様式で作ったときの知らせは、様式を変えたら消す
}
document.querySelectorAll('input[name=style]').forEach((el) => el.addEventListener('change', onStyle));
onStyle();

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const style = currentStyle();
  const wb = buildReceiptWorkbook(window.ExcelJS, rows, checkReceipts(rows), { style, creditAccount: $('credit').value });
  const buf = await wb.xlsx.writeBuffer();
  const name = { standard: '明細', journal: '仕訳', office: '事務所様式' }[style];
  const filename = `レシート_${name}_${stamp()}.xlsx`;
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), filename);
  setStep(4);
  // ファイルを作り終えてから、できたことを知らせる
  const made = $('made');
  clear(made).append('Excelを作りました：', h('span', { class: 'fn' }, filename));
  made.hidden = false;
  replay(made, 'in');
});

renderThumbs();
setStep(1);
