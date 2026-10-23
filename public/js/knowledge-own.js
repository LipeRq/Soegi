// 「御社の資料で試す」（ナレッジの画面の3つ目の札）。Claude 固定。ファイルは画面の中で文字にし、文字だけを送る。
// 送り先（外部のAIサービス）への同意のチェックが先。資料も質問も、サーバーには残らない（画面を閉じれば消える）。
// 答えの根拠（引用）はサーバーで資料と照合済み。画面は textContent だけで組み立てる。
import { api, h, clear } from './common.js';
import { reduced, flash, thinking } from './motion.js';
import { extractText, ACCEPT, MAX_FILE_BYTES } from './doc-text.js';

const $ = (id) => document.getElementById(id);
const scrollHow = () => (reduced() ? 'auto' : 'smooth');
const n = (x) => x.toLocaleString('ja-JP');
const WINDOW = 500; // 根拠を開くとき、引用の前後に出す文字数

let limits = { maxDocs: 3, maxChars: 50000 };
let files = []; // [{ name, text, note }]
let reading = 0; // 文字を取り出し中のファイルの数
let asking = false;
let seq = 0;
let sampleMeta = null;

const total = () => files.reduce((t, f) => t + f.text.length, 0);
const over = () => total() > limits.maxChars;

function overMessage() {
  return `資料の文字が多すぎます（合わせて${n(total())}文字。上限は${n(limits.maxChars)}文字）。${files.map((f) => `「${f.name}」${n(f.text.length)}文字`).join('、')}。資料を外すか、減らしてください（切って送ることはしません）。`;
}

function sync() {
  const consent = $('own-consent').checked;
  const full = files.length >= limits.maxDocs;
  $('own-file').disabled = !consent || full || reading > 0 || asking;
  $('own-file-btn').setAttribute('aria-disabled', String($('own-file').disabled));
  $('own-sample').disabled = $('own-file').disabled;
  $('own-limit').textContent = full ? `${limits.maxDocs}つ入っています（上限）` : '';
  // 資料の一覧
  const list = clear($('own-files'));
  files.forEach((f, i) => list.append(h('li', {},
    h('span', { class: 'fn' }, f.name),
    h('span', { class: 'ch' }, `${n(f.text.length)}文字`),
    f.note ? h('span', { class: 'nt' }, f.note) : null,
    h('button', {
      type: 'button', class: 'small', 'aria-label': `${f.name}を外す`, disabled: asking,
      onclick: () => { files.splice(i, 1); sync(); (($('own-files').querySelectorAll('button')[Math.min(i, files.length - 1)]) ?? $('own-file-btn')).focus(); },
    }, '外す'))));
  if (reading) list.append(h('li', { class: 'reading' }, '文字を取り出しています…'));
  // 文字数の目盛り（上限を超えたら、理由を言葉で。色だけに頼らない）
  $('own-meter').hidden = !files.length;
  const t = total();
  $('own-bar').style.setProperty('width', `${Math.min(100, (t / limits.maxChars) * 100)}%`);
  $('own-bar').parentElement.classList.toggle('over', over());
  $('own-total').textContent = over() ? overMessage() : `合わせて ${n(t)} / ${n(limits.maxChars)} 文字`;
  $('own-total').classList.toggle('bad', over());
  // 質問の欄は、資料が入って、上限以内で、同意があるときだけ
  const ready = files.length > 0 && !over() && consent;
  $('own-ask').hidden = !(files.length > 0);
  $('own-btn').disabled = !ready || asking;
  for (const b of $('own-examples').querySelectorAll('button')) b.disabled = !ready || asking;
  $('own-q').disabled = !ready || asking;
  if (files.length && !consent) $('own-q').placeholder = '先に、上の確認のチェックを入れてください';
  else $('own-q').placeholder = '資料について質問（例：この資料の返品の条件は？）';
}

async function addFiles(picked) {
  const room = limits.maxDocs - files.length;
  const errs = [];
  if (picked.length > room) errs.push(`資料は${limits.maxDocs}つまでです（${picked.length - room}つは入れていません）`);
  reading += Math.min(picked.length, room);
  sync();
  for (const f of picked.slice(0, room)) {
    try {
      if (f.size > MAX_FILE_BYTES) throw new Error('10MBを超えています');
      const { text, note } = await extractText(f);
      if (files.some((x) => x.name === f.name && x.text === text)) throw new Error('同じ資料がすでに入っています');
      files.push({ name: f.name, text, note });
    } catch (e) { errs.push(`${f.name}：${e.message}`); }
    reading -= 1;
    sync();
  }
  $('own-err').textContent = errs.join(' ／ ');
}

/** 見本の資料3つ（架空の工務店）を入れる。質問の例も出す */
async function addSample() {
  $('own-sample').disabled = true;
  $('own-err').textContent = '';
  try {
    sampleMeta ??= await (await fetch('/samples/own/samples.json')).json();
    const picked = [];
    for (const f of sampleMeta.files) {
      if (files.some((x) => x.name === f.name)) continue;
      const res = await fetch(`/samples/own/${f.file}`);
      if (!res.ok) throw new Error();
      picked.push(new File([await res.blob()], f.name));
    }
    await addFiles(picked);
    const box = clear($('own-examples'));
    for (const { q } of sampleMeta.questions) box.append(h('button', { type: 'button', onclick: () => ask(q) }, h('small', {}, h('b', {}, '見本の質問')), h('span', { class: 'q' }, q)));
    $('own-examples').hidden = false;
  } catch { $('own-err').textContent = '見本の資料を読み込めませんでした。再読み込みしてお試しください'; }
  sync();
}

// ---- 答え -----------------------------------------------------------------------------------

const part = (label, text, cls = '') => h('div', { class: `part ${cls}` }, h('span', { class: 'lbl' }, label), h('p', {}, text));

/** 根拠を開く：引用の前後だけを出して、引用に印を付ける（資料が長くても、画面が長くならない） */
function showEvidence(a, c, chip) {
  const doc = files[c.docIndex];
  const box = clear($('own-ev'));
  $('own-ev').hidden = false;
  document.querySelectorAll('#own-log .cites button').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
  if (!doc) { box.append(h('p', { class: 'small-note' }, 'この資料は、外したため表示できません')); return; }
  let i = c.start >= 0 && doc.text.slice(c.start, c.end) === c.quote ? c.start : doc.text.indexOf(c.quote);
  const body = h('p', { class: 'evtext' });
  if (i < 0) body.append(c.quote);
  else {
    const from = Math.max(0, i - WINDOW); const to = Math.min(doc.text.length, i + c.quote.length + WINDOW);
    body.append(from > 0 ? '…' : '', doc.text.slice(from, i), h('mark', {}, c.quote), doc.text.slice(i + c.quote.length, to), to < doc.text.length ? '…' : '');
  }
  box.append(h('h3', {}, '根拠の箇所'), h('p', { class: 'doc-title' }, doc.name), body,
    h('p', { class: 'small-note' }, i >= 0 ? `資料の ${n(i + 1)} 文字目から。引用は、資料の文字と照合して確かめています。` : '引用は、資料の文字と照合して確かめています（位置は特定できませんでした）。'));
  box.scrollIntoView({ block: 'nearest', behavior: scrollHow() });
  flash(box);
}

function renderAnswer(a, sec) {
  const msg = h('div', { class: `msg bot${a.found ? '' : ' none'}` });
  if (a.requireConfirm) {
    msg.append(h('div', { class: 'part confirm' }, h('span', { class: 'lbl' }, '要確認'), h('p', {}, a.confirmText), a.confirmEasy ? h('p', {}, a.confirmEasy) : null));
  }
  if (a.laborNotice) {
    msg.append(h('div', { class: 'part confirm' }, h('span', { class: 'lbl' }, '要確認'), h('p', {}, a.laborText), a.laborEasy ? h('p', {}, a.laborEasy) : null));
  }
  if (!a.found) {
    msg.append(h('div', { class: 'part notfound' }, h('span', { class: 'badge gray' }, '資料に見当たりません'), h('p', { lang: a.language }, a.answer)));
    if (a.easyJa) msg.append(part('やさしい日本語', a.easyJa, 'easy'));
  } else {
    msg.append(part('答え', a.answer, 'ans'));
  }
  let chips = [];
  if (a.citations.length) {
    chips = a.citations.map((c) => {
      const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => showEvidence(a, c, b) },
        h('span', { class: 'ct' }, `${c.docName}：${c.quote.length > 40 ? `${c.quote.slice(0, 40)}…` : c.quote}`));
      return b;
    });
    msg.append(h('div', { class: 'part' }, h('span', { class: 'lbl' }, '根拠の引用（押すと、資料のその箇所が出ます）'), h('div', { class: 'cites in' }, chips)));
  }
  for (const t of a.notes) msg.append(h('p', { class: 'translated sys' }, t));
  const cache = a.usage?.cacheRead > 0 ? '・資料は前の質問のキャッシュを使いました' : '';
  msg.append(h('p', { class: 'translated meta' }, `${a.found ? `根拠 ${a.citations.length}件` : '根拠なし'}・${sec.toFixed(1)}秒${cache}`));
  return { msg, chips };
}

async function ask(question) {
  const q = question.trim();
  if (!q || asking) return;
  const mine = ++seq;
  asking = true;
  sync();
  const log = $('own-log');
  const asked = h('div', { class: 'msg user' }, q);
  const dots = thinking(); dots.setAttribute('aria-hidden', 'true');
  const waiting = h('div', { class: 'msg bot wait' }, dots, h('p', { class: 'phase' }, '資料を読んで、根拠を確かめています…'));
  log.append(asked, waiting);
  waiting.scrollIntoView({ block: 'nearest', behavior: scrollHow() });
  const t0 = performance.now();
  try {
    const a = await api('/api/knowledge-own', { docs: files.map((f) => ({ name: f.name, text: f.text })), question: q });
    if (mine !== seq) return;
    const view = renderAnswer(a, (performance.now() - t0) / 1000);
    waiting.replaceWith(view.msg);
    view.msg.scrollIntoView({ block: 'nearest', behavior: scrollHow() });
    // 根拠が無い答えのとき、前の答えの根拠を残さない
    if (a.citations[0]) showEvidence(a, a.citations[0], view.chips[0]); else $('own-ev').hidden = true;
  } catch (e) {
    waiting.replaceWith(h('div', { class: 'msg bot' }, h('p', { class: 'err' }, e.message)));
  } finally {
    asking = false;
    sync();
  }
}

/** 札を出せるかを、サーバーに確かめる（キーが無ければ、札ごと出さない） */
export async function setupOwn(onShow) {
  let st;
  try { st = await api('/api/knowledge-own-status', {}); } catch { return; }
  if (!st?.available) return;
  limits = { maxDocs: st.maxDocs, maxChars: st.maxChars };
  $('own-file').accept = ACCEPT;
  $('own-consent').addEventListener('change', sync);
  $('own-sample').addEventListener('click', addSample);
  $('own-file').addEventListener('change', (e) => { const picked = [...e.target.files]; e.target.value = ''; addFiles(picked); });
  $('own-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('own-q').value; $('own-q').value = ''; ask(v); });
  $('tab-own').hidden = false;
  sync();
  onShow?.();
}
