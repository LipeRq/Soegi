/* ソエギ サイトのチャットボット（埋め込み用）
 * 使い方：サイトの </body> の前に1行貼る
 *   <script src="https://demo.withsoegi.jp/widget/chat.js" data-profile="soegi" data-mobile-offset="76" defer></script>
 *   data-mobile-offset：スマホ幅（640px未満）で、画面下に固定のバーがあるときに上へずらす高さ（px）
 * - サイトのCSSと混ざらないよう Shadow DOM の中に作る。スタイルは CSSOM で入れる（CSPの style-src に引っかからない）
 * - 答えはサーバーで「サイトの内容だけ」「決めたリンクだけ」に絞ってから返す。画面は textContent だけで組み立てる
 * - 会話は画面の中だけで持ち、直近の数往復だけを送る。保存しない
 */
(() => {
  if (window.SoegiChat) return;
  const script = document.currentScript;
  const BASE = script ? new URL(script.src).origin : location.origin;
  let profile = (script && script.dataset.profile) || 'soegi';
  const MAX = 300;
  const mobileOffset = Math.min(200, Math.max(0, Number(script && script.dataset.mobileOffset) || 0));

  const NAMES = { soegi: 'ソエギ', koumuten: 'やまなみ住建（架空）', yado: 'ゆきあかり荘（仮）' };
  const SUGGEST = {
    soegi: ['料金はいくら？', 'うちは従業員10人の工務店だけど、何ができる？', '補助金の申請書を書いてくれる？', 'Do you support companies outside Yamagata?'],
    koumuten: ['外壁塗装はいくらくらい？', '見積りは無料？', '雨漏りは今日来てもらえる？', 'Can you renovate a kitchen?'],
    yado: ['チェックインは何時から？', '山形駅からどう行く？', '子どもが卵アレルギーです', '可以用信用卡嗎？'],
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; font-family: "BIZ UDPGothic", "Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif; color: #1D2327; font-size: 15px; line-height: 1.7; }
    button { font: inherit; cursor: pointer; }
    .fab { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 10px 18px; border-radius: 26px; border: 0; background: #B3243B; color: #fff; font-weight: 700; box-shadow: 0 6px 20px -6px rgba(29,35,39,.45); }
    .fab:hover { background: #931A2E; }
    .fab svg { width: 20px; height: 20px; }
    .root { --mo: 0px; }
    @media (max-width: 639.98px) { .root { bottom: calc(16px + var(--mo) + env(safe-area-inset-bottom, 0px)); right: 12px; } }
    .panel { position: absolute; right: 0; bottom: 0; width: min(380px, calc(100vw - 24px)); height: min(580px, calc(100vh - 32px - var(--mo))); background: #fff; border: 1px solid #D3DBDE; border-radius: 14px; box-shadow: 0 16px 40px -12px rgba(29,35,39,.4); display: flex; flex-direction: column; overflow: hidden; }
    .panel[hidden], .fab[hidden] { display: none; }
    .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #E4EAEC; background: #F5F7F6; }
    .hd b { display: block; font-size: 15px; }
    .hd small { display: block; font-size: 11px; color: #5F6A70; line-height: 1.4; }
    .hd .x { margin-left: auto; min-width: 44px; min-height: 44px; border: 0; background: none; font-size: 22px; color: #465056; border-radius: 8px; }
    .hd .x:hover { background: #ECF0EF; }
    .log { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .m { border-radius: 10px; padding: 8px 11px; white-space: pre-wrap; word-break: break-word; max-width: 92%; }
    .m.u { align-self: flex-end; background: #1D2327; color: #fff; }
    .m.b { align-self: flex-start; background: #F5F7F6; border: 1px solid #E4EAEC; }
    .m.e { align-self: flex-start; background: #F7E7EA; color: #B3243B; }
    .links { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; white-space: normal; }
    .links a { display: inline-flex; align-items: center; min-height: 36px; padding: 2px 10px; border: 1px solid #1D2327; border-radius: 18px; color: #1D2327; text-decoration: none; font-size: 13px; background: #fff; }
    .links a.cta { background: #B3243B; border-color: #B3243B; color: #fff; font-weight: 700; }
    .sug { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
    .sug button { min-height: 36px; padding: 4px 10px; border: 1px solid #D3DBDE; border-radius: 18px; background: #fff; font-size: 13px; text-align: left; }
    .sug button:hover { border-color: #B3243B; background: #F7E7EA; }
    form { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #E4EAEC; }
    input { flex: 1; min-width: 0; min-height: 44px; padding: 6px 10px; border: 1px solid #8D989E; border-radius: 8px; font: inherit; color: #1D2327; }
    form button { min-height: 44px; padding: 0 16px; border: 0; border-radius: 8px; background: #B3243B; color: #fff; font-weight: 700; }
    form button:disabled { opacity: .5; }
    .ft { padding: 0 12px 10px; font-size: 11px; color: #5F6A70; line-height: 1.5; }
    :focus-visible { outline: 3px solid rgba(29,35,39,.4); outline-offset: 2px; }
    .dots::after { content: "答えを探しています…"; color: #5F6A70; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  `;

  const host = document.createElement('div');
  host.id = 'soegi-chat';
  const root = host.attachShadow({ mode: 'open' });
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } else {
    const st = document.createElement('style');
    st.textContent = CSS;
    root.append(st);
  }

  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };

  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  const fab = el('button', { class: 'fab', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'soegi-chat-panel' });
  fab.innerHTML = ICON; // 固定の図だけ（外からの文字は入れない）
  fab.append('質問する');

  const title = el('b', {});
  const log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
  const sug = el('div', { class: 'sug' });
  const input = el('input', { type: 'text', maxlength: String(MAX), 'aria-label': '質問', placeholder: '何語でも質問できます', autocomplete: 'off' });
  const send = el('button', { type: 'submit' }, '送る');
  const form = el('form', { onsubmit: (e) => { e.preventDefault(); ask(input.value); } }, input, send);
  const close = el('button', { class: 'x', type: 'button', 'aria-label': '閉じる', onclick: () => toggle(false) }, '×');
  const panel = el('div', { class: 'panel', id: 'soegi-chat-panel', role: 'dialog', 'aria-label': 'サイトの質問窓口', hidden: true },
    el('div', { class: 'hd' }, el('div', {}, title, el('small', {}, 'AIが、このサイトの内容をもとにお答えします')), close),
    log, sug, form,
    el('p', { class: 'ft' }, '入力内容は保存しません。名前や電話番号などの個人情報は入力しないでください。AIの答えは間違えることがあります。大事なことはお問い合わせください。'));
  const wrap = el('div', { class: 'root' }, panel, fab);
  wrap.style.setProperty('--mo', `${mobileOffset}px`);
  root.append(wrap);
  fab.addEventListener('click', () => toggle(true));

  let history = [];
  let busy = false;

  function toggle(open) {
    panel.hidden = !open;
    fab.hidden = open;
    fab.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!log.childElementCount) greet();
      input.focus();
    } else fab.focus();
  }

  function greet() {
    log.replaceChildren(el('div', { class: 'm b' }, `${NAMES[profile] || ''}について、お答えします。何語でもどうぞ。`));
    sug.replaceChildren(...(SUGGEST[profile] || []).map((q) => el('button', { type: 'button', onclick: () => ask(q) }, q)));
  }

  function bot(a) {
    const m = el('div', { class: 'm b' }, a.answer);
    const links = el('div', { class: 'links' });
    for (const l of a.links || []) links.append(el('a', { href: l.href, target: l.href.startsWith('#') ? null : '_top' }, l.label));
    if (a.consult) links.append(el('a', { href: a.consult.href, class: 'cta', target: a.consult.href.startsWith('#') ? null : '_top' }, a.consult.label));
    if (links.childElementCount) m.append(links);
    return m;
  }

  async function ask(text) {
    const q = String(text || '').trim();
    if (!q || busy) return;
    if (q.length > MAX) { log.append(el('div', { class: 'm e' }, `${MAX}文字までにしてください`)); return; }
    busy = true; send.disabled = true; input.value = ''; sug.replaceChildren();
    log.append(el('div', { class: 'm u' }, q));
    const wait = el('div', { class: 'm b dots' });
    log.append(wait);
    log.scrollTop = log.scrollHeight;
    try {
      const res = await fetch(`${BASE}/api/site-chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile, message: q, history: history.slice(-6) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || '答えを出せませんでした。時間をおいてお試しください');
      wait.replaceWith(bot(data.data));
      history.push({ role: 'user', text: q }, { role: 'bot', text: data.data.answer });
      window.dispatchEvent(new CustomEvent('soegi-chat:answer', { detail: { profile, category: data.data.category, found: data.data.found, language: data.data.language } }));
    } catch (e) {
      wait.replaceWith(el('div', { class: 'm e' }, e.message || '通信できませんでした'));
    } finally {
      busy = false; send.disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  function setProfile(p) {
    profile = p;
    history = [];
    title.textContent = `${NAMES[p] || ''}の質問窓口`;
    greet();
  }

  setProfile(profile);
  const mount = () => document.body.append(host);
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.SoegiChat = { open: () => toggle(true), close: () => toggle(false), setProfile, ask };
})();
