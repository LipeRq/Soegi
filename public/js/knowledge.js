// デモA：社内ナレッジ検索 ＋ 外国人スタッフ向け。
// 答えはサーバーで「根拠が資料にあるか」を照合済み。画面は textContent だけで組み立てる（AIの出力は信用しない）。
// 動きの決まり：待たせる動きは入れない。届いた答えの「見せ方」だけを動かす。
// 「要確認」「見当たりません」「AIの翻訳です」などの決まった文言は、1文字ずつ出さず、はじめから全文を出す。
import { requireAuth, api, h, clear } from './common.js';
import { reduced, typeText, thinking, stagger } from './motion.js';
import { mountEstimate } from './estimate-ui.js';
import { setupOwn } from './knowledge-own.js';

requireAuth();
const $ = (id) => document.getElementById(id);

const LANG_LABEL = { ja: '日本語', en: '英語', vi: 'ベトナム語', id: 'インドネシア語', zh: '中国語', ko: '韓国語', tl: 'タガログ語', ne: 'ネパール語', my: 'ミャンマー語', th: 'タイ語', pt: 'ポルトガル語', es: 'スペイン語' };
const TYPE_LABEL = { manual: '作業手順書', rule: 'ルール・就業規則', error: '機械のエラー表', shipping: '出荷ルール', estimate: '過去の見積書' };

// lang は質問の言語（読み上げと、入口の「外国人スタッフ向け」から来たときの目印に使う）
const EXAMPLES = [
  { role: '社長', q: '去年、やまびこスーパー（仮）向けに出したラ・フランスジャムの単価は？' },
  { role: '現場リーダー', q: '充填機でE-07が出た。どうする？' },
  { role: 'ベトナム人スタッフ（有給の取り方）', q: 'Tôi muốn xin nghỉ phép có lương, phải làm thế nào?', lang: 'vi' },
  { role: 'インドネシア人スタッフ（休憩後の手袋）', q: 'Apakah saya boleh memakai sarung tangan yang sama setelah istirahat?', lang: 'id' },
  { role: '誰か（資料に無いこと）', q: '来月の社員旅行はどこ？' },
];

let docs = [];

/** 「見積書 No.2025-031（やまびこスーパー（仮）・2025年9月）」を、名前と（ ）の部分に分ける。文字は変えず、強弱だけ付ける */
function splitParen(s) {
  const m = /^([^（]+)(（.+）)$/.exec(s);
  return m ? [m[1], m[2]] : [s, ''];
}

const scrollHow = () => (reduced() ? 'auto' : 'smooth');

/** 入れ物の中だけを動かして、el を見える位置へ（ページ全体は動かさない） */
function scrollWithin(sc, el, pad = 8) {
  if (!sc || !el || sc.scrollHeight <= sc.clientHeight) return;
  const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
  // 真ん中に置く。入りきらない大きさのときは、先頭を pad だけ空けて見せる
  sc.scrollTo({ top: Math.max(0, top - Math.max(pad, (sc.clientHeight - el.offsetHeight) / 2)), behavior: scrollHow() });
}

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
    list.append(h('li', { class: 'grp' }, h('span', {}, label), h('span', { class: 'n' }, `（${ds.length}）`)));
    for (const d of ds) {
      const [name, sub] = splitParen(d.title);
      list.append(h('li', {}, h('button', { type: 'button', dataset: { doc: d.id }, onclick: () => showDoc(d.id) },
        h('span', { class: 't' }, name), sub ? h('small', {}, sub) : null)));
    }
  }
  stagger(list);
}

/** 本文の中の引用部分に印を付ける（見つからなければ節ごと強調するだけ） */
function markQuote(text, quote) {
  const q = String(quote || '').replace(/….*$/, '').trim();
  const i = q.length >= 4 ? text.indexOf(q) : -1;
  if (i < 0) return [text];
  return [text.slice(0, i), h('mark', {}, q), text.slice(i + q.length)];
}

// 根拠の表示を替えるたびに増やす（答えを出し終えたあとの印が、その間に開いた別の資料に走らないように）
let evSeq = 0;

/**
 * 資料を「根拠の箇所」に開く。
 * @param opts {chip: 押された根拠の札, auto: 答えが届いたときに自動で開く場合 true}
 *   auto のときは、画面を根拠へ動かさず（答えを読んでいる最中なので）、印も答えを出し終えるまで待つ
 * @returns この表示の番号（sweepHit に渡す）
 */
function showDoc(docId, sectionId = null, quote = '', opts = {}) {
  const d = docs.find((x) => x.id === docId);
  if (!d) return 0;
  const { chip = null, auto = false } = opts;
  evSeq += 1;
  let current = null;
  document.querySelectorAll('#doclist button').forEach((b) => {
    const on = b.dataset.doc === docId;
    b.setAttribute('aria-current', String(on));
    if (on) current = b;
  });
  document.querySelectorAll('.cites button').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
  const box = clear($('evidence'));
  // 資料の名前は、中を動かしても上に残す（どの資料の話かを見失わないように）
  const head = h('div', { class: 'doc-head' }, h('p', { class: 'doc-type' }, TYPE_LABEL[d.type] ?? ''), h('p', { class: 'doc-title' }, d.title));
  box.append(head);
  let hasHit = false;
  for (const s of d.sections) {
    const hit = s.id === sectionId;
    if (hit) hasHit = true;
    box.append(h('div', { class: `sec${hit ? ' hit' : ''}`, id: hit ? 'hit' : null },
      hit ? h('span', { class: 'hitlbl' }, '根拠') : null,
      h('b', {}, s.heading), h('span', {}, hit ? markQuote(s.text, quote) : s.text)));
  }
  const pane = $('evidence-pane');
  pane.classList.add('open');
  pane.classList.toggle('has-hit', hasHit);
  stagger(box, 8);
  box.classList.toggle('hold', auto && !reduced());
  scrollWithin($('docscroll'), current);
  const hitEl = document.getElementById('hit');
  if (auto) {
    scrollWithin(box, hitEl, head.offsetHeight + 8);
  } else {
    box.querySelector('mark')?.classList.add('sweep');
    showPane('evidence');
    hitEl?.scrollIntoView({ block: 'nearest', behavior: scrollHow() });
  }
  return evSeq;
}

/** 自動で開いた根拠に、印を走らせる（その間に別の資料を開いていたら、何もしない） */
function sweepHit(seq) {
  if (!seq || seq !== evSeq) return;
  const box = $('evidence');
  box.classList.remove('hold');
  box.querySelector('mark')?.classList.add('sweep');
}

// ---- スマホでは「資料／質問／根拠」を切り替える ------------------------------------------------

function showPane(name) {
  if (!matchMedia('(max-width: 760px)').matches && name !== 'chat') return;
  document.querySelectorAll('.kb > section[data-pane]').forEach((s) => s.classList.toggle('show', s.dataset.pane === name));
  document.querySelectorAll('.kb-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.show === name)));
}
// 手で切り替えたとき：ページの縦位置がそのまま残ると、面の途中から見えてしまう。面の先頭（根拠なら引用した節）へ合わせる
document.querySelectorAll('.kb-tabs button').forEach((b) => b.addEventListener('click', () => {
  const name = b.dataset.show;
  document.querySelectorAll('.kb > section[data-pane]').forEach((s) => s.classList.toggle('show', s.dataset.pane === name));
  document.querySelectorAll('.kb-tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  if (name === 'evidence') (document.getElementById('hit') ?? $('evidence-pane')).scrollIntoView({ block: 'start', behavior: 'auto' });
  else if (name === 'docs') $('docs-pane').scrollIntoView({ block: 'start', behavior: 'auto' });
  else $('ask-form').scrollIntoView({ block: 'nearest', behavior: 'auto' });
}));

// ---- 質問と答え ------------------------------------------------------------------------

const part = (label, text, cls = '') => h('div', { class: `part ${cls}` }, h('span', { class: 'lbl' }, label), h('p', {}, text));

/**
 * 答えの吹き出しを組み立てる。全文をはじめから入れておく（動きは revealAnswer が後から付ける）。
 * @returns {{msg, typed:[{p, maxMs}], cites, chips}} typed は1文字ずつ出す段落（AIが書いた答えだけ。決まった文言は入れない）
 */
function renderAnswer(a, sec) {
  const langName = LANG_LABEL[a.language] ?? a.language;
  const msg = h('div', { class: `msg bot${a.found ? '' : ' none'}` });
  const typed = [];
  const say = (label, text, cls, maxMs) => {
    const el = part(label, text, cls);
    typed.push({ p: el.lastChild, maxMs });
    return el;
  };
  // 「要確認」は吹き出しの先頭に出す（答えが長いスマホでも、下に隠れない。答えより後には出さない）
  if (a.requireConfirm) {
    msg.append(h('div', { class: 'part confirm' }, h('span', { class: 'lbl' }, '要確認'),
      h('p', {}, a.confirmText), a.confirmEasy ? h('p', {}, a.confirmEasy) : null,
      !a.isJapanese ? h('p', { class: 'small-note' }, a.confirmJa) : null));
  }
  if (a.laborNotice) {
    msg.append(h('div', { class: 'part confirm' }, h('span', { class: 'lbl' }, '要確認'),
      h('p', {}, a.laborText), a.laborEasy ? h('p', {}, a.laborEasy) : null));
  }
  if (!a.isJapanese && a.questionJa) msg.append(part('質問（日本語訳）', a.questionJa, 'ja'));
  if (!a.found) {
    msg.append(h('div', { class: 'part notfound' }, h('span', { class: 'badge gray' }, '資料に見当たりません'), h('p', {}, a.answer)));
    if (!a.isJapanese) msg.append(part('やさしい日本語', a.easyJa, 'easy'));
  } else {
    const ans = say(a.isJapanese ? '答え' : `答え（${langName}）`, a.answer, 'ans', 1300);
    if (!a.isJapanese) ans.lastChild.lang = a.language;
    msg.append(ans);
    if (!a.isJapanese && a.easyJa) msg.append(say('やさしい日本語', a.easyJa, 'easy', 800));
  }
  let cites = null;
  let chips = [];
  if (a.citations.length) {
    chips = a.citations.map((c, i) => {
      const b = h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => showDoc(c.docId, c.sectionId, c.quote, { chip: b }) }, h('span', { class: 'ct' }, `${c.title}／${c.heading}`));
      b.style.setProperty('--i', String(Math.min(i, 6)));
      return b;
    });
    cites = h('div', { class: 'cites' }, chips);
    msg.append(h('div', { class: 'part' }, h('span', { class: 'lbl' }, '根拠の箇所（押すと右に出ます）'), cites));
  }
  if (a.found && !a.isJapanese && a.answerJa) {
    msg.append(h('details', { class: 'part' }, h('summary', {}, '日本語の答え（上司・リーダー向け）'), h('p', {}, a.answerJa)));
  }
  if (a.translatedNote) msg.append(h('p', { class: 'translated ai' }, `${a.translatedNote}（${a.translatedNoteJa}）`));
  for (const n of a.notes) msg.append(h('p', { class: 'translated sys' }, n));
  msg.append(h('p', { class: 'translated meta' }, `${a.found ? `根拠 ${a.citations.length}件` : '根拠なし'}・${sec.toFixed(1)}秒・${a.category}`));
  return { msg, typed, cites, chips };
}

// いま1文字ずつ出している答え（次の質問が来たら、すぐ全文にする）
let typing = null;

/**
 * 届いた答えを、順に見せる：答え → やさしい日本語 → 根拠の札 → 右の資料に印。
 * - 全文は透明のまま先に置いてあるので、吹き出しの高さは変わらない。読み上げも全文を1回だけ
 * - 全部で2秒ほど。吹き出しを押すか、次の質問をすると、すぐ全文になる。途中でやめても必ず全文が残る
 */
async function revealAnswer(view, seq) {
  const { msg, typed, cites } = view;
  if (reduced() || !typed.length) { sweepHit(seq); return; }
  const ctl = new AbortController();
  typing = ctl;
  msg.addEventListener('pointerdown', () => ctl.abort(), { once: true });
  // キーボードで札へ来たときも、すぐ全文にする（見えない札に印だけ付くことがないように）
  msg.addEventListener('focusin', () => ctl.abort(), { once: true });
  const slots = typed.map(({ p, maxMs }) => {
    const text = p.textContent;
    const live = h('span', { class: 'live', 'aria-hidden': 'true' });
    clear(p).append(h('span', { class: 'full' }, text), live);
    p.classList.add('typed');
    return { p, text, live, maxMs };
  });
  cites?.classList.add('wait');
  try {
    for (const s of slots) await typeText(s.live, s.text, { cps: 60, maxMs: s.maxMs, signal: ctl.signal });
  } finally {
    // 重ねていた方を外すだけ（全文は残っているので、読み上げが2回にならない）
    for (const s of slots) { s.live.remove(); s.p.classList.remove('typed'); }
    if (cites) { cites.classList.remove('wait'); cites.classList.add('in'); }
    if (typing === ctl) typing = null;
    sweepHit(seq);
  }
}

// 答えを待っている質問の数。待っている間だけ、資料の一覧の上を線が走る（AIが資料を読んでいる間）
let waitingCount = 0;
function setReading(delta) {
  waitingCount += delta;
  $('docs-pane').classList.toggle('scanning', waitingCount > 0 && !reduced());
}

async function ask(question, role = '') {
  const q = question.trim();
  if (!q) return;
  typing?.abort();
  const log = $('chatlog');
  const asked = h('div', { class: 'msg user' }, q);
  const who = role ? h('span', { class: 'who' }, role) : null;
  log.append(...(who ? [who, asked] : [asked]));
  const dots = thinking();
  dots.setAttribute('aria-hidden', 'true'); // 同じ内容を、すぐ横の文で読み上げる
  const waiting = h('div', { class: 'msg bot wait' }, dots, h('p', { class: 'phase' }, '資料を読んで、根拠を確かめています…'));
  log.append(waiting);
  waiting.scrollIntoView({ block: 'nearest', behavior: scrollHow() });
  $('ask-btn').disabled = true;
  setReading(1);
  const t0 = performance.now();
  try {
    const a = await api('/api/knowledge', { question: q });
    const view = renderAnswer(a, (performance.now() - t0) / 1000);
    waiting.replaceWith(view.msg);
    // 新しい答えの先頭を見せる。質問と答えが枠に収まるときは、質問から見せる（収まらないときは、答えを優先する）
    const first = who ?? asked;
    const topOf = (el) => el.offsetTop - (el.offsetParent === log ? 0 : log.offsetTop);
    const fits = topOf(view.msg) + view.msg.offsetHeight - topOf(first) + 12 <= log.clientHeight;
    log.scrollTop = fits ? topOf(first) - 6 : topOf(view.msg) - 2;
    tally(a);
    let seq = 0;
    if (a.citations[0]) seq = showDoc(a.citations[0].docId, a.citations[0].sectionId, a.citations[0].quote, { chip: view.chips[0], auto: true });
    showPane('chat');
    // ページは、会話の枠と入力欄が画面に入る所まで動かす（会話の枠の中の位置は、上で決めたまま）
    $('ask-form').scrollIntoView({ block: 'nearest', behavior: scrollHow() });
    revealAnswer(view, seq);
  } catch (e) {
    const failed = h('div', { class: 'msg bot' }, h('p', { class: 'err' }, e.message));
    waiting.replaceWith(failed);
    failed.scrollIntoView({ block: 'nearest', behavior: scrollHow() }); // エラーの文が、枠の下に隠れないように
  } finally {
    $('ask-btn').disabled = false;
    setReading(-1);
  }
}

$('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('q').value; $('q').value = ''; ask(v); });

// 役のボタン：小さな札が「誰の役か」、大きな文字が「質問」
const roles = $('roles');
const fromForeign = location.hash === '#foreign';
for (const ex of EXAMPLES) {
  const [who, gloss] = splitParen(ex.role);
  roles.append(h('button', { type: 'button', class: fromForeign && ex.lang ? 'pick' : null, onclick: () => ask(ex.q, ex.role) },
    h('small', {}, h('b', {}, who), gloss ? h('span', {}, gloss) : null), h('span', { class: 'q', lang: ex.lang ?? null }, ex.q)));
}
roles.append(h('button', { type: 'button', class: 'to-admin', onclick: () => setTab('admin') },
  h('small', {}, h('b', {}, '社長')), h('span', { class: 'q' }, '管理画面を開く（よく聞かれた質問）')));
stagger(roles);

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
    h('tbody', {}, rows.map((r, i) => {
      // 棒は上の行から順に伸びる（数は左の件数に出ているので、棒は読み上げない）
      const bar = h('div', { class: 'minibar', style: { width: `${(r.count / max) * 100}%` } });
      bar.style.setProperty('--i', String(Math.min(i, 10)));
      // 朱はいちばん多い行だけ（答えられなかった種類は灰色の棒。チャットボットの画面と同じ見せ方）
      const none = r.category === '資料に見当たらない';
      const top = rows.length > 1 && !none && r.count === max;
      return h('tr', { class: none ? 'none' : top ? 'top' : null },
        h('td', { class: 'cat' }, r.category, top && h('span', { class: 'most' }, '最多')), h('td', { class: 'cnt num' }, String(r.count)),
        h('td', { class: 'barcell' }, h('div', { class: 'bartrack', 'aria-hidden': 'true' }, bar)),
        h('td', { class: 'langs' }, r.langs));
    })),
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
  const sg = clear($('suggest'));
  sg.append(...SUGGEST.map((s) => h('li', {}, s)));
  stagger(sg);
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
  else clear($('session-report')).append(h('tbody', {}, h('tr', {}, h('td', { class: 'empty' }, 'まだ質問がありません。「質問する」で試してください。'))));
}

function setTab(which) {
  for (const k of ['ask', 'admin', 'own']) {
    $(`tab-${k}`).setAttribute('aria-selected', String(which === k));
    $(`pane-${k}`).hidden = which !== k;
  }
  if (which === 'admin') renderAdmin();
}
$('tab-ask').addEventListener('click', () => setTab('ask'));
$('tab-admin').addEventListener('click', () => setTab('admin'));
$('tab-own').addEventListener('click', () => setTab('own'));
setupOwn(() => { if (location.hash === '#own') setTab('own'); }); // Claude のキーがあるときだけ、3つ目の札が出る

loadDocs();
if (fromForeign) {
  $('q').placeholder = 'Tôi muốn xin nghỉ phép… / Bagaimana cara…（母国語で質問できます）';
  // 総称の書体が日本語用に決まると、ベトナム語の記号が離れて見える。言語を示して、ラテン文字用の書体に任せる
  $('q').classList.add('foreign');
  $('q').lang = 'vi';
}

// 御社の場合（試算）と持ち帰り1枚
// 入口の「外国人スタッフ向け」（#foreign）から来たときは、外国人スタッフ向けの試算から始める
mountEstimate(document.getElementById('estimate'), { keys: ['knowledge', 'foreign'], initialKey: fromForeign ? 'foreign' : 'knowledge' });
