// デモC：サイトのチャットボットの見本ページ。ウィジェット本体は /widget/chat.js（サイトに貼るものと同じ）。
// 動きは、もう手元にある内容の「見せ方」だけ（見本の入れ替え・棒の伸び・件数の数え上げ）。待ち時間は足していない。
import { h, clear } from './common.js';
import { reduced, countUp, stagger, replay, flash } from './motion.js';

const $ = (id) => document.getElementById(id);

const MOCK = {
  soegi: { url: 'withsoegi.jp', title: '削減できた時間を、数字で確かめてから続ける。', lines: ['ソエギ（山形）— 仕事の流れを伺って、AIとITで仕組みを整え、社内に根付かせます。', '料金・進め方・情報の取り扱い・よくあるご質問を載せています。'] },
  koumuten: { url: 'yamanami-juken.example（架空）', title: 'やまなみ住建（架空）', lines: ['外壁・屋根の塗装、水まわりのリフォーム。山形市・上山市・天童市など。', '見積りは無料です。'] },
  yado: { url: 'yukiakari-so.example（架空）', title: '蔵王温泉 ゆきあかり荘（仮）', lines: ['客室12室の家族経営の宿。硫黄泉の大浴場と、貸切風呂が2つ。', 'ご宿泊・アクセス・よくあるご質問'] },
};
const ORDER = Object.keys(MOCK); // ボタンの並び順（右の見本へ移るときは右から、左へ移るときは左から出す）

// ---- 見本のサイト（小さなブラウザの窓） ------------------------------------------------

/** 文字の無い、形だけの部品（ロゴ・メニュー・写真の場所）。サイトについての新しい説明は足さない */
const blocks = (n) => Array.from({ length: n }, () => h('i'));

function mockPage(p, m) {
  // 見出しと文は、上から順に出す（文字ははじめから全文。打ち込みの演出はしない＝「（架空）」が遅れて出ることがない）
  const txt = stagger(h('div', { class: 'txt' },
    h('h2', {}, m.title), ...m.lines.map((l) => h('p', {}, l)),
    h('div', { class: 'acts', 'aria-hidden': 'true' }, blocks(2))));
  return h('div', { class: 'page in', dataset: { profile: p } },
    h('div', { class: 'site-hd', 'aria-hidden': 'true' }, h('span', { class: 'logo' }, blocks(2)), h('span', { class: 'nav' }, blocks(4))),
    h('div', { class: 'hero' }, txt, h('div', { class: 'pic', 'aria-hidden': 'true' }, blocks(3))),
    h('div', { class: 'cards', 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('div', { class: 'sk' }, blocks(3)))));
}

/** 前の見本を、横へ送り出してから消す。動きを減らす設定では、すぐ消す */
function leave(old, dx) {
  if (reduced()) { old.remove(); return; }
  old.setAttribute('aria-hidden', 'true');
  old.style.setProperty('--dx', `${-dx}px`);
  old.classList.replace('in', 'out');
  old.addEventListener('animationend', (e) => { if (e.target === old) old.remove(); });
  setTimeout(() => old.remove(), 400); // 動きが流れなかったときも、必ず消す
}

let shown = null; // いま出している見本

function showMock(p) {
  if (p === shown) return; // 同じ見本をもう一度押したときは、中身が同じなので入れ替えない
  const m = MOCK[p];
  const body = $('mock-body');
  const dx = shown == null ? 0 : Math.sign(ORDER.indexOf(p) - ORDER.indexOf(shown)) * 32;
  const first = shown == null;
  shown = p;
  $('mock-url').textContent = m.url;
  if (!first) replay($('mock-url'), 'swap');
  Array.from(body.children).forEach((old) => leave(old, dx));
  const page = mockPage(p, m);
  page.style.setProperty('--dx', `${dx}px`);
  body.append(page);
}

// ---- 業種の切り替え：選んだ所へ、墨の面がすべって移る ------------------------------------

const profiles = $('profiles');
const profileButtons = Array.from(profiles.querySelectorAll('button'));

/** 選んだボタンの位置と大きさを CSS へ渡す（CSP のため CSSOM で入れる） */
function moveThumb() {
  const b = profiles.querySelector('[aria-pressed=true]');
  if (!b || !b.offsetWidth) return; // 「管理画面」を開いている間は大きさが 0 になるので、何もしない
  profiles.style.setProperty('--tx', `${b.offsetLeft}px`);
  profiles.style.setProperty('--ty', `${b.offsetTop}px`);
  profiles.style.setProperty('--tw', `${b.offsetWidth}px`);
  profiles.style.setProperty('--th', `${b.offsetHeight}px`);
  profiles.classList.add('ready');
}
// 書体の読み込みや画面の幅でボタンの大きさが変わるので、そのたびに合わせ直す
if (typeof ResizeObserver === 'function') new ResizeObserver(moveThumb).observe(profiles);
else { moveThumb(); window.addEventListener('resize', moveThumb); }

profileButtons.forEach((b) => b.addEventListener('click', () => {
  profileButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  moveThumb();
  showMock(b.dataset.profile);
  window.SoegiChat?.setProfile(b.dataset.profile);
  window.SoegiChat?.open();
}));
$('open').addEventListener('click', () => window.SoegiChat?.open());
showMock('soegi');

// ---- 管理画面 ------------------------------------------------------------------------

const LAST_MONTH = [
  { category: '料金', count: 14, note: 'うち「お試しの後の費用」6件' },
  { category: '進め方', count: 9, note: '「どのくらいの期間か」が多い' },
  { category: '対応範囲', count: 7, note: '県外・業種・補助金' },
  { category: '情報の取り扱い', count: 4, note: '「資料はどこに置くか」' },
  { category: 'サイトに無い内容', count: 3, note: '駐車場、領収書の発行、土日の訪問' },
];
const SUGGEST = [
  '「お試しの後の費用」が料金の質問の4割。料金表の近くに、お試しから続ける場合の例を1行足す候補です。',
  '「土日に来てもらえるか」がサイトに無い内容でした。よくあるご質問に足すかを決めます。',
];
const sessionRows = new Map();
const seen = new Map(); // 前に管理画面を開いたときの件数（増えた行を光らせるために覚えておく）

/** 表を作る。棒は上の行から順に伸び、件数は 0 から数え上げる（終わりの数は、必ず元の件数と同じ） */
function table(el, rows, floor = 1) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const scale = Math.max(floor, max); // 棒の長さの基準（件数が少ない表で、1件が満タンの棒に見えないようにする。件数そのものは変えない）
  const body = h('tbody', {}, rows.map((r, i) => {
    const none = r.category === 'サイトに無い内容'; // 答えられなかった種類は、灰色の棒（ナレッジの画面と同じ見せ方）
    const top = rows.length > 1 && !none && r.count === max; // いちばん多い行は、朱の棒と「最多」の文字で示す
    const cnt = h('td', { class: 'cnt num' }, String(r.count));
    const bar = h('div', { class: 'minibar', style: { width: `${(r.count / scale) * 100}%` } });
    bar.style.setProperty('--i', String(i));
    countUp(cnt, r.count, { duration: 450 + i * 90 });
    return h('tr', { class: none ? 'none' : top ? 'top' : '' },
      h('td', { class: 'cat' }, r.category, top && h('span', { class: 'most' }, '最多')), cnt,
      h('td', { class: 'barcell' }, h('div', { class: 'bartrack', 'aria-hidden': 'true' }, bar)), h('td', { class: 'memo' }, r.note));
  }));
  clear(el).append(
    h('thead', {}, h('tr', {}, h('th', {}, '質問の種類'), h('th', { class: 'num' }, '件数'), h('th', {}, ''), h('th', {}, 'メモ'))),
    body,
  );
  return body;
}

window.addEventListener('soegi-chat:answer', (e) => {
  const cat = e.detail.found ? (e.detail.category || 'その他') : 'サイトに無い内容';
  const r = sessionRows.get(cat) ?? { category: cat, count: 0, langs: new Set() };
  r.count++; r.langs.add(e.detail.language);
  sessionRows.set(cat, r);
  // 数えたことが分かるよう、「管理画面」のタブに、このデモで聞かれた件数を出す（中身は管理画面の表と同じ数）
  const badge = $('tab-count');
  badge.textContent = String([...sessionRows.values()].reduce((n, x) => n + x.count, 0));
  badge.hidden = false;
  replay(badge, 'bump');
});

function renderAdmin() {
  table($('report'), LAST_MONTH);
  clear($('suggest')).append(...SUGGEST.map((s) => h('li', {}, s)));
  stagger($('suggest')); // 棒が伸びたあとに、候補を1つずつ出す（遅れの長さは chatbot.css）
  const rows = [...sessionRows.values()].sort((a, b) => b.count - a.count).map((r) => ({ ...r, note: `言語：${[...r.langs].join('・')}` }));
  if (rows.length) {
    const body = table($('session-report'), rows, 5);
    // 前に見たときから増えた行を、一瞬だけ光らせる
    rows.forEach((r, i) => { if (seen.get(r.category) !== r.count) flash(body.rows[i]); seen.set(r.category, r.count); });
  } else clear($('session-report')).append(h('tbody', {}, h('tr', {}, h('td', { class: 'empty' }, 'まだ質問がありません。「試す」で質問してください。'))));
}

function setTab(which) {
  $('tab-try').setAttribute('aria-selected', String(which === 'try'));
  $('tab-admin').setAttribute('aria-selected', String(which === 'admin'));
  $('pane-try').hidden = which !== 'try';
  $('pane-admin').hidden = which !== 'admin';
  if (which === 'admin') { renderAdmin(); window.SoegiChat?.close(); }
}
$('tab-try').addEventListener('click', () => setTab('try'));
$('tab-admin').addEventListener('click', () => setTab('admin'));
