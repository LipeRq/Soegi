// デモA：社内ナレッジ検索 ＋ 外国人スタッフ向け。
// 答えはサーバーで「根拠が資料にあるか」を照合済み。画面は textContent だけで組み立てる（AIの出力は信用しない）。
import { requireAuth, api, h, clear } from './common.js';
import { pricingText } from './pricing.js';

requireAuth();
const $ = (id) => document.getElementById(id);
$('pricing').textContent = pricingText('knowledge');

const LANG_LABEL = { ja: '日本語', en: '英語', vi: 'ベトナム語', id: 'インドネシア語', zh: '中国語', ko: '韓国語', tl: 'タガログ語', ne: 'ネパール語', my: 'ミャンマー語', th: 'タイ語', pt: 'ポルトガル語', es: 'スペイン語' };
const TYPE_LABEL = { manual: '作業手順書', rule: 'ルール・就業規則', error: '機械のエラー表', shipping: '出荷ルール', estimate: '過去の見積書' };

const EXAMPLES = [
  { role: '社長', q: '去年、やまびこスーパー（仮）向けに出したラ・フランスジャムの単価は？' },
  { role: '現場リーダー', q: '充填機でE-07が出た。どうする？' },
  { role: 'ベトナム人スタッフ（有給の取り方）', q: 'Tôi muốn xin nghỉ phép có lương, phải làm thế nào?' },
  { role: 'インドネシア人スタッフ（休憩後の手袋）', q: 'Apakah saya boleh memakai sarung tangan yang sama setelah istirahat?' },
  { role: '誰か（資料に無いこと）', q: '来月の社員旅行はどこ？' },
];

let docs = [];

// ---- 資料の一覧と、根拠の表示 ------------------------------------------------------------

async function loadDocs() {
  const res = await fetch('/data/sakuranbo.json');
  const data = await res.json();
  docs = data.docs;
  $('company').textContent = `架空の会社：${data.company.name}。${data.company.about}`;
  const list = clear($('doclist'));
  for (const [type, label] of Object.entries(TYPE_LABEL)) {
    const ds = docs.filter((d) => d.type === type);
    if (!ds.length) continue;
    list.append(h('li', { class: 'grp' }, `${label}（${ds.length}）`));
    for (const d of ds) {
      list.append(h('li', {}, h('button', { type: 'button', dataset: { doc: d.id }, onclick: () => showDoc(d.id) }, d.title)));
    }
  }
}

/** 本文の中の引用部分に印を付ける（見つからなければ節ごと強調するだけ） */
function markQuote(text, quote) {
  const q = String(quote || '').replace(/….*$/, '').trim();
  const i = q.length >= 4 ? text.indexOf(q) : -1;
  if (i < 0) return [text];
  return [text.slice(0, i), h('mark', {}, q), text.slice(i + q.length)];
}

function showDoc(docId, sectionId = null, quote = '') {
  const d = docs.find((x) => x.id === docId);
  if (!d) return;
  document.querySelectorAll('#doclist button').forEach((b) => b.setAttribute('aria-current', String(b.dataset.doc === docId)));
  const box = clear($('evidence'));
  box.append(h('p', { class: 'doc-title' }, d.title));
  for (const s of d.sections) {
    const hit = s.id === sectionId;
    box.append(h('div', { class: `sec${hit ? ' hit' : ''}`, id: hit ? 'hit' : null },
      h('b', {}, s.heading), h('span', {}, hit ? markQuote(s.text, quote) : s.text)));
  }
  showPane('evidence');
  document.getElementById('hit')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---- スマホでは「資料／質問／根拠」を切り替える ------------------------------------------------

function showPane(name) {
  if (!matchMedia('(max-width: 760px)').matches && name !== 'chat') return;
  document.querySelectorAll('.kb > section[data-pane]').forEach((s) => s.classList.toggle('show', s.dataset.pane === name));
  document.querySelectorAll('.kb-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.show === name)));
}
document.querySelectorAll('.kb-tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.kb > section[data-pane]').forEach((s) => s.classList.toggle('show', s.dataset.pane === b.dataset.show));
  document.querySelectorAll('.kb-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
}));

// ---- 質問と答え ------------------------------------------------------------------------

const part = (label, text, cls = '') => h('div', { class: `part ${cls}` }, h('span', { class: 'lbl' }, label), h('p', {}, text));

function renderAnswer(a, sec) {
  const langName = LANG_LABEL[a.language] ?? a.language;
  const msg = h('div', { class: 'msg bot' });
  if (!a.isJapanese && a.questionJa) msg.append(part('質問（日本語訳）', a.questionJa, 'ja'));
  if (!a.found) {
    msg.append(h('div', { class: 'part' }, h('span', { class: 'badge gray' }, '資料に見当たりません'), h('p', {}, a.answer)));
    if (!a.isJapanese) msg.append(part('やさしい日本語', a.easyJa, 'easy'));
  } else {
    msg.append(part(a.isJapanese ? '答え' : `答え（${langName}）`, a.answer));
    if (!a.isJapanese && a.easyJa) msg.append(part('やさしい日本語', a.easyJa, 'easy'));
  }
  if (a.requireConfirm) {
    msg.append(h('div', { class: 'part confirm' }, h('span', { class: 'lbl' }, '要確認'),
      h('p', {}, a.confirmText), a.confirmEasy ? h('p', {}, a.confirmEasy) : null,
      !a.isJapanese ? h('p', { class: 'small-note' }, a.confirmJa) : null));
  }
  if (a.laborNotice) {
    msg.append(h('div', { class: 'part confirm' }, h('span', { class: 'lbl' }, '要確認'),
      h('p', {}, a.laborText), a.laborEasy ? h('p', {}, a.laborEasy) : null));
  }
  if (a.citations.length) {
    msg.append(h('div', { class: 'part' }, h('span', { class: 'lbl' }, '根拠の箇所（押すと右に出ます）'),
      h('div', { class: 'cites' }, a.citations.map((c) => h('button', { type: 'button', onclick: () => showDoc(c.docId, c.sectionId, c.quote) }, `${c.title}／${c.heading}`)))));
  }
  if (a.found && !a.isJapanese && a.answerJa) {
    msg.append(h('details', { class: 'part' }, h('summary', {}, '日本語の答え（上司・リーダー向け）'), h('p', {}, a.answerJa)));
  }
  if (a.translatedNote) msg.append(h('p', { class: 'translated' }, `${a.translatedNote}（${a.translatedNoteJa}）`));
  for (const n of a.notes) msg.append(h('p', { class: 'translated' }, n));
  msg.append(h('p', { class: 'translated' }, `${a.found ? `根拠 ${a.citations.length}件` : '根拠なし'}・${sec.toFixed(1)}秒・${a.category}`));
  return msg;
}

async function ask(question) {
  const q = question.trim();
  if (!q) return;
  const log = $('chatlog');
  log.append(h('div', { class: 'msg user' }, q));
  const waiting = h('div', { class: 'msg bot' }, h('p', { class: 'phase' }, '資料を読んで、根拠を確かめています…'));
  log.append(waiting);
  waiting.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('ask-btn').disabled = true;
  const t0 = performance.now();
  try {
    const a = await api('/api/knowledge', { question: q });
    const msg = renderAnswer(a, (performance.now() - t0) / 1000);
    waiting.replaceWith(msg);
    log.scrollTop = msg.offsetTop - log.offsetTop - 8; // 新しい答えの先頭を見せる
    tally(a);
    if (a.citations[0]) showDoc(a.citations[0].docId, a.citations[0].sectionId, a.citations[0].quote);
    showPane('chat');
  } catch (e) {
    waiting.replaceWith(h('div', { class: 'msg bot' }, h('p', { class: 'err' }, e.message)));
  } finally {
    $('ask-btn').disabled = false;
  }
}

$('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('q').value; $('q').value = ''; ask(v); });

const roles = $('roles');
for (const ex of EXAMPLES) {
  roles.append(h('button', { type: 'button', onclick: () => ask(ex.q) }, h('small', {}, ex.role), ex.q));
}
roles.append(h('button', { type: 'button', onclick: () => setTab('admin') }, h('small', {}, '社長'), '管理画面を開く（よく聞かれた質問）'));

// ---- 管理画面 --------------------------------------------------------------------------

// 架空の「先月」のレポート（見本）
const LAST_MONTH = [
  { category: '有給・休み', count: 8, langs: 'ベトナム語 5・インドネシア語 2・日本語 1' },
  { category: '機械・エラー', count: 6, langs: '日本語 6' },
  { category: '衛生', count: 5, langs: 'インドネシア語 3・ベトナム語 2' },
  { category: '見積・単価', count: 4, langs: '日本語 4' },
  { category: '遅刻・欠勤', count: 3, langs: 'ベトナム語 2・日本語 1' },
  { category: '資料に見当たらない', count: 3, langs: '健康診断の日、駐車場、社員旅行' },
  { category: '出荷', count: 2, langs: '日本語 2' },
];
const SUGGEST = [
  '就業規則「有給休暇の申請」：先月8回。うち7回が外国人スタッフから。休暇届の書き方の見本を、写真付きにすると聞かれる回数が減るかもしれません。',
  '衛生ルール「手袋」：インドネシア語で3回。休憩室の入口に、母国語の短い掲示を足す候補です。',
  '資料に見当たらない質問が3件（健康診断の日、駐車場、社員旅行）。資料に足すかを決めます。',
];

function reportTable(table, rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  clear(table).append(
    h('thead', {}, h('tr', {}, h('th', {}, '質問の種類'), h('th', { class: 'num' }, '件数'), h('th', {}, ''), h('th', {}, '内訳'))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', {}, r.category), h('td', { class: 'cnt num' }, String(r.count)),
      h('td', { class: 'barcell' }, h('div', { class: 'minibar', style: { width: `${(r.count / max) * 100}%` } })),
      h('td', {}, r.langs)))),
  );
}

function sessionTally() {
  try { return JSON.parse(sessionStorage.getItem('kb-tally') || '[]'); } catch { return []; }
}
function tally(a) {
  const t = sessionTally();
  t.push({ category: a.found ? a.category : '資料に見当たらない', lang: LANG_LABEL[a.language] ?? a.language });
  try { sessionStorage.setItem('kb-tally', JSON.stringify(t.slice(-200))); } catch { /* 数えられなくても動く */ }
}

function renderAdmin() {
  reportTable($('report'), LAST_MONTH);
  clear($('suggest')).append(...SUGGEST.map((s) => h('li', {}, s)));
  const t = sessionTally();
  const by = new Map();
  for (const x of t) {
    const e = by.get(x.category) ?? { category: x.category, count: 0, langs: new Map() };
    e.count++; e.langs.set(x.lang, (e.langs.get(x.lang) ?? 0) + 1);
    by.set(x.category, e);
  }
  const rows = [...by.values()].sort((a, b) => b.count - a.count)
    .map((e) => ({ ...e, langs: [...e.langs].map(([l, n]) => `${l} ${n}`).join('・') }));
  if (rows.length) reportTable($('session-report'), rows);
  else clear($('session-report')).append(h('tbody', {}, h('tr', {}, h('td', {}, 'まだ質問がありません。「質問する」で試してください。'))));
}

function setTab(which) {
  $('tab-ask').setAttribute('aria-selected', String(which === 'ask'));
  $('tab-admin').setAttribute('aria-selected', String(which === 'admin'));
  $('pane-ask').hidden = which !== 'ask';
  $('pane-admin').hidden = which !== 'admin';
  if (which === 'admin') renderAdmin();
}
$('tab-ask').addEventListener('click', () => setTab('ask'));
$('tab-admin').addEventListener('click', () => setTab('admin'));

loadDocs();
if (location.hash === '#foreign') $('q').placeholder = 'Tôi muốn xin nghỉ phép… / Bagaimana cara…（母国語で質問できます）';
