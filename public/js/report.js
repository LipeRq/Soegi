// 音声日報。話した言葉（ブラウザの音声認識か、キーボードの音声入力）→ 項目 → 日報。
// 文字だけを送る（音声はサーバーに届かない）。日報の文・足りない項目・安全の固定の文は、画面でもプログラム（report-format.js）が決める。
import { requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, setStep } from './common.js';
import { mountEstimate } from './estimate-ui.js';
import { reduced, flash, replay } from './motion.js';
import { REQUIRED, emptyFields, missingFields, isSafety, safetyWords, formatReport, formatShort, SHORT_MAX } from './report-format.js';
import { buildReportWorkbook } from './report-xlsx.js';

requireAuth();
const $ = (id) => document.getElementById(id);

const EXAMPLES = {
  ex1: '今日は田中さんのお宅の外壁塗装で、足場を組みました。職人3人です。2階ベランダの手すりがぐらついていて、ヒヤリとしました。午後から風が強くなりました。明日は下塗りの予定です。',
  ex2: '今日は午後、山本さんのお宅に訪問して、入浴の介助と居室の掃除をしました。2人で、2時間くらいです。足のむくみが少しありました。',
};

const est = mountEstimate($('estimate'), { keys: ['report'] });
void est;

let fields = emptyFields();
let spoken = '';
let seq = 0;
let started = 0;
let dirty = false; // 手で直した項目があるか（もう一度「整える」を押すときに確かめる）
let busy = false;

// ---- 話す（ブラウザの音声認識） -------------------------------------------------------------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false;
let base = ''; // 話し始める前の文字

let ended = null; // 止まったことを待つ（止めた後に届く最後の結果を、取りこぼさない）
function setMicUi(on) {
  listening = on;
  $('spoken').readOnly = on; // 話している間は、欄を直せない（認識の結果で書き換わるため）
  $('mic').setAttribute('aria-pressed', String(on));
  $('mic-label').textContent = on ? '止める（話しています…）' : '話す（マイクを使う）';
  $('mic').classList.toggle('on', on);
}

function startMic() {
  rec = new SR();
  rec.lang = 'ja-JP';
  rec.continuous = true;
  rec.interimResults = true;
  base = $('spoken').value;
  rec.onresult = (e) => {
    let fin = ''; let tmp = '';
    for (let i = 0; i < e.results.length; i += 1) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
    $('spoken').value = `${base}${base && fin ? '\n' : ''}${fin}`.slice(0, 1500);
    $('interim').textContent = tmp;
    sync();
  };
  rec.onerror = (e) => {
    const m = { aborted: '音声認識が止まりました', 'language-not-supported': 'この端末は日本語の音声認識に対応していません。キーボードの音声入力でどうぞ', 'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定で許可するか、キーボードの音声入力でどうぞ', 'service-not-allowed': 'この端末では音声認識を使えません。キーボードの音声入力でどうぞ', 'no-speech': '声が聞こえませんでした', 'audio-capture': 'マイクが見つかりません', network: '音声認識のサービスに接続できませんでした' }[e.error];
    $('mic-note').textContent = m ?? `音声認識でエラーが出ました（${e.error}）`;
  };
  rec.onend = () => {
    setMicUi(false); $('interim').textContent = '';
    if (/話してください/.test($('mic-note').textContent)) $('mic-note').textContent = '止まりました。続けるときは、もう一度「話す」を押してください。';
    ended?.(); ended = null;
    sync();
  };
  try { rec.start(); setMicUi(true); $('mic-note').textContent = '話してください。止めるときは、もう一度ボタンを押します。'; } catch { $('mic-note').textContent = 'マイクを始められませんでした'; }
}

if (SR) {
  $('mic').hidden = false;
  $('mic').addEventListener('click', () => { if (listening) rec?.stop(); else startMic(); });
} else {
  $('mic-note').textContent = 'このブラウザでは、ボタンでの音声認識は使えません。入力欄で、スマホのキーボードの音声入力（マイクのキー）を使って話してください。';
}

// ---- 入れる・整える ---------------------------------------------------------------------------

function sync() {
  const n = $('spoken').value.trim().length;
  $('go').disabled = n === 0 || busy;
  $('count').textContent = `${n} / 1500 文字`;
}
$('spoken').addEventListener('input', sync);
for (const k of ['ex1', 'ex2']) {
  $(k).addEventListener('click', () => { $('spoken').value = EXAMPLES[k]; sync(); $('spoken').focus(); });
}

$('go').addEventListener('click', async () => {
  const text0 = $('spoken').value.trim();
  if (!text0) return;
  if (listening) { // 止めて、最後の結果が届くのを待ってから読む（欄と送る文が食い違わないように）
    await new Promise((ok) => { ended = ok; setTimeout(ok, 800); rec?.stop(); });
    setMicUi(false);
  }
  const text2 = $('spoken').value.trim();
  if (dirty && !$('step2').hidden && text2 && !confirm('手で直した項目は、新しく取り出した内容に置き換わります。よいですか？')) return;
  const mine = ++seq;
  busy = true; sync(); $('err').textContent = '';
  $('reading').hidden = false; $('rtext').textContent = '話した内容から、日報の項目を取り出しています…';
  $('bar').style.width = '60%';
  started = performance.now();
  try {
    const text = $('spoken').value.trim();
    const r = await api('/api/report', { text });
    if (mine !== seq) return;
    spoken = text;
    dirty = false;
    fields = { ...emptyFields(), ...r.fields };
    showFields(r, (performance.now() - started) / 1000);
  } catch (e) {
    if (mine === seq) $('err').textContent = e.message;
  } finally {
    if (mine === seq) { busy = false; $('reading').hidden = true; $('bar').style.width = '0'; sync(); }
  }
});

// ---- 項目（直せる）と日報 ------------------------------------------------------------------------

const FIELD_INPUT = { date: 'f-date', site: 'f-site', work: 'f-work', people: 'f-people', hours: 'f-start', tomorrow: 'f-tomorrow' };

function fillForm() {
  $('f-date').value = fields.date;
  $('f-site').value = fields.site;
  $('f-work').value = fields.work.join('\n');
  $('f-people').value = fields.people ?? '';
  $('f-start').value = fields.start;
  $('f-end').value = fields.end;
  $('f-hours').value = fields.hours ?? '';
  $('f-hazards').value = fields.hazards;
  $('f-notes').value = fields.notes;
  $('f-tomorrow').value = fields.tomorrow;
}

/** 欄に入れた値が、範囲の外のとき：「未入力」ではなく、どう直すかを欄の下に出す */
const RANGE = [['f-people', 'people', (v) => Number.isInteger(v) && v >= 1 && v <= 999, '1〜999の整数で入れてください'], ['f-hours', 'hours3', (v) => v > 0 && v <= 24, '0より大きく24以下で入れてください']];
function checkRanges() {
  for (const [id, label, ok, msg] of RANGE) {
    const raw = $(id).value; const n = raw === '' ? null : Number(raw);
    const l = document.querySelector(`#form label[data-f="${label}"]`);
    l.classList.toggle('bad', n != null && !ok(n));
    l.dataset.msg = msg;
  }
}

function readForm() {
  const num = (id) => { const v = $(id).value; return v === '' ? null : Number(v); };
  const people = num('f-people');
  const hours = num('f-hours');
  fields = {
    date: $('f-date').value,
    site: $('f-site').value,
    work: $('f-work').value.split('\n').map((x) => x.trim()).filter(Boolean),
    people: Number.isInteger(people) && people > 0 && people <= 999 ? people : null,
    start: $('f-start').value, end: $('f-end').value,
    hours: Number.isFinite(hours) && hours > 0 && hours <= 24 ? hours : null,
    hazards: $('f-hazards').value, notes: $('f-notes').value, tomorrow: $('f-tomorrow').value,
  };
}

let extra = [];

/** 色と言葉：足りない項目は、欄の中に「未入力」と、決まった質問を出す */
function refresh() {
  checkRanges();
  const missing = missingFields(fields);
  const names = new Set(missing.map((m) => m.field));
  const map = { date: ['date'], site: ['site'], work: ['work'], people: ['people'], hours: ['hours', 'hours2', 'hours3'], tomorrow: ['tomorrow'] };
  for (const label of document.querySelectorAll('#form label')) label.classList.remove('missing');
  for (const [k, labels] of Object.entries(map)) for (const l of labels) document.querySelector(`#form label[data-f="${l}"]`)?.classList.toggle('missing', names.has(k));
  const list = clear($('asklist'));
  for (const m of missing) {
    list.append(h('li', {}, h('span', { class: 'badge yellow' }, '未入力'), h('b', {}, m.label), h('span', { class: 'q' }, m.question),
      h('button', { type: 'button', class: 'small', 'aria-label': `${m.label}を入力する`, onclick: () => $(FIELD_INPUT[m.field]).focus() }, '入力する')));
  }
  $('asks').hidden = !missing.length;
  $('safety').hidden = !isSafety(fields, spoken);
  const w = safetyWords(fields, spoken);
  $('safety-words').textContent = w.length ? `（見つけた語：${w.slice(0, 4).join('・')}。違うときは、そのまま責任者に「問題なし」と伝えてください）` : '';
  const text = formatReport(fields, spoken);
  $('preview').textContent = text;
  const short = formatShort(fields, spoken);
  $('short').textContent = short;
  $('short-count').textContent = `${short.length} / ${SHORT_MAX} 文字`;
  $('made').hidden = true;
  renderStats(missing.length);
}

function renderStats(nMissing) {
  const stat = (name, v, unit, cls = '') => h('div', { class: `stat ${cls}` }, h('span', {}, name), h('b', {}, v, h('small', {}, unit)));
  clear($('stats')).append(
    stat('項目を取り出した時間', String(lastSec.toFixed(1)), '秒', 'good'),
    stat('話した文字数', String(spoken.length), '文字', 'quiet'),
    stat('足りない項目', String(nMissing), `／ ${REQUIRED.length}`, nMissing ? 'warn' : ''));
}
let lastSec = 0;

function showFields(r, sec) {
  lastSec = sec;
  fillForm();
  extra = r.extraQuestions ?? [];
  const ex = clear($('extralist'));
  for (const q of extra) ex.append(h('li', {}, q.question));
  $('extra').hidden = !extra.length;
  $('step2').hidden = false; $('step3').hidden = false; $('estimate').hidden = false;
  refresh();
  setStep(2);
  replay($('step2'), 'in');
  $('step2').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
}

$('form').addEventListener('input', () => { dirty = true; readForm(); refresh(); });
$('form').addEventListener('submit', (e) => e.preventDefault());

// ---- コピー・Excel --------------------------------------------------------------------------------

function done(text) { const el = clear($('made')); el.append(text); el.hidden = false; replay(el, 'in'); setStep(3); }

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); done(`${label}をコピーしました`); } catch { $('made').hidden = false; $('made').textContent = 'コピーできませんでした。文字を選んで、手でコピーしてください'; }
}
$('copy').addEventListener('click', () => copy($('preview').textContent, '日報'));
$('copy-short').addEventListener('click', () => copy($('short').textContent, '短い形'));

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const wb = buildReportWorkbook(window.ExcelJS, fields, spoken);
  const buf = await wb.xlsx.writeBuffer();
  const name = `日報_${(fields.date || stamp().slice(0, 8)).replace(/-/g, '')}_${stamp()}.xlsx`;
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), name);
  const el = clear($('made')); el.append('Excelを作りました：', h('span', { class: 'fn' }, name)); el.hidden = false; replay(el, 'in'); setStep(4);
});

void flash;
sync();
setStep(1);
