// デモC：サイトのチャットボットの見本ページ。ウィジェット本体は /widget/chat.js（サイトに貼るものと同じ）。
import { h, clear } from './common.js';
import { pricingText } from './pricing.js';

const $ = (id) => document.getElementById(id);
$('pricing').textContent = pricingText('chatbot');

const MOCK = {
  soegi: { url: 'withsoegi.jp', title: '削減できた時間を、数字で確かめてから続ける。', lines: ['ソエギ（山形）— 仕事の流れを伺って、AIとITで仕組みを整え、社内に根付かせます。', '料金・進め方・情報の取り扱い・よくあるご質問を載せています。'] },
  koumuten: { url: 'yamanami-juken.example（架空）', title: 'やまなみ住建（架空）', lines: ['外壁・屋根の塗装、水まわりのリフォーム。山形市・上山市・天童市など。', '見積りは無料です。'] },
  yado: { url: 'yukiakari-so.example（架空）', title: '蔵王温泉 ゆきあかり荘（仮）', lines: ['客室12室の家族経営の宿。硫黄泉の大浴場と、貸切風呂が2つ。', 'ご宿泊・アクセス・よくあるご質問'] },
};

function showMock(p) {
  const m = MOCK[p];
  $('mock-url').textContent = m.url;
  clear($('mock-body')).append(h('h2', {}, m.title), ...m.lines.map((l) => h('p', {}, l)));
}

document.querySelectorAll('#profiles button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#profiles button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
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

function table(el, rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  clear(el).append(
    h('thead', {}, h('tr', {}, h('th', {}, '質問の種類'), h('th', { class: 'num' }, '件数'), h('th', {}, ''), h('th', {}, 'メモ'))),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.category), h('td', { class: 'cnt num' }, String(r.count)),
      h('td', { class: 'barcell' }, h('div', { class: 'minibar', style: { width: `${(r.count / max) * 100}%` } })), h('td', {}, r.note)))),
  );
}

window.addEventListener('soegi-chat:answer', (e) => {
  const cat = e.detail.found ? (e.detail.category || 'その他') : 'サイトに無い内容';
  const r = sessionRows.get(cat) ?? { category: cat, count: 0, langs: new Set() };
  r.count++; r.langs.add(e.detail.language);
  sessionRows.set(cat, r);
});

function renderAdmin() {
  table($('report'), LAST_MONTH);
  clear($('suggest')).append(...SUGGEST.map((s) => h('li', {}, s)));
  const rows = [...sessionRows.values()].sort((a, b) => b.count - a.count).map((r) => ({ ...r, note: `言語：${[...r.langs].join('・')}` }));
  if (rows.length) table($('session-report'), rows);
  else clear($('session-report')).append(h('tbody', {}, h('tr', {}, h('td', {}, 'まだ質問がありません。「試す」で質問してください。'))));
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
