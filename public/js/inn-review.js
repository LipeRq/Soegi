// 宿：口コミ返信の下書き（/inn.html の「口コミ返信」タブ）。例文はサーバー側でキャッシュ、自由入力は Turnstile ＋ 1日5回まで。
// 「必ず責任者が確認」（星1〜2）・返金補償・人名の注意は、サーバー（プログラム）が決めて返す。ここは出すだけ。
import { api, h, clear, setStep } from './common.js';
import { reduced, stagger, replay, shake, thinking } from './motion.js';
import { mountTurnstile } from './turnstile.js';

const $ = (id) => document.getElementById(id);
const LANG_LABEL = { zh: '繁体字中国語', en: '英語', ko: '韓国語', ja: '日本語' };
const KIND = { praise: ['ほめ', 'ok'], complaint: ['不満', 'yellow'], request: ['要望', 'gray'] };
const langAttr = (key) => (key === 'zh' ? 'zh-Hant-TW' : /^[a-z]{2,3}$/.test(key || '') ? key : '');
const setLang = (el, key) => { const v = langAttr(key); if (v) el.setAttribute('lang', v); else el.removeAttribute('lang'); };
const starText = (n) => `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`;

let runSeq = 0;
let stars = 0; // 自由入力で選んだ星の数
const dots = thinking('返信の下書きを作っています');
let turnstile = null;

function setPhase(text, state) {
  $('rv-phase').textContent = text;
  $('rv-result').dataset.state = state;
  if (state === 'loading') $('rv-phase').after(dots); else dots.remove();
}

function mountStats() {
  const stat = (label, unit, cls) => {
    const v = h('span', { class: 'v' });
    return { el: h('div', { class: `stat ${cls}` }, h('span', {}, label), h('b', {}, v, h('small', {}, unit))), v };
  };
  const s = { time: stat('かかった時間', '秒', 'good'), lang: stat('口コミの言語', '', 'word'), stars: stat('星の数', '', 'word'), check: stat('送る前に確かめる点', '件', '') };
  clear($('rv-stats')).append(s.time.el, s.lang.el, s.stars.el, s.check.el);
  return s;
}

async function run(body, text, shownStars, lang = '') {
  const seq = ++runSeq;
  $('rv-result').hidden = false;
  setStep(1);
  setPhase('宿の情報を読んで、返信の下書きを作っています…', 'loading');
  for (const id of ['rv-review-ja', 'rv-reply', 'rv-reply-ja']) $(id).textContent = '';
  for (const id of ['rv-points', 'rv-check', 'rv-warn']) clear($(id));
  $('rv-used').textContent = ''; $('rv-rule-note').hidden = true; $('rv-reply-h').textContent = '② 返信の下書き';
  // 星1〜2の固定の文は、結果を待たずに出す（星の数は人が選んだもの）
  $('rv-must').hidden = shownStars > 2;
  if (shownStars <= 2) $('rv-must').textContent = '星1〜2の口コミです。返信は必ず責任者が確認してから出してください。';
  $('rv-origin').textContent = text;
  setLang($('rv-origin'), lang);
  clear($('rv-origin-stars')).append(h('span', { class: 'sr' }, `星${shownStars}`), h('span', { 'aria-hidden': 'true' }, ` ${starText(shownStars)}`));
  replay($('rv-origin').parentElement, 'in');
  const st = mountStats();
  $('rv-result').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  const t0 = performance.now();
  try {
    const r = await api('/api/inn-review', body);
    const sec = (performance.now() - t0) / 1000;
    if (typeof r.remaining === 'number') $('rv-free-note').textContent = `今日はあと${r.remaining}回使えます`;
    if (seq !== runSeq) return;
    show(r, sec, text, st);
    setStep(2);
  } catch (e) {
    if (seq !== runSeq) return;
    clear($('rv-stats'));
    $('rv-must').hidden = true;
    setPhase(e.message, 'error');
  } finally {
    if (body.text && turnstile) turnstile.reset();
  }
}

function show(r, sec, text, st) {
  const lang = LANG_LABEL[r.language] ?? r.language;
  setPhase(r.cached ? '用意した例なので、前に作った下書きをそのまま出しています（AIは呼んでいません）。' : '下書きができました。', 'done');
  // 固定の文はサーバーが返したものを出す（星の数と食い違わない）
  $('rv-must').hidden = !r.mustCheck;
  if (r.mustCheck) $('rv-must').textContent = r.mustCheckText;
  st.time.v.textContent = sec.toFixed(1);
  st.lang.v.textContent = lang;
  st.stars.v.textContent = `星${r.stars}`;
  st.check.v.textContent = String(r.needsCheck.length);
  st.check.el.classList.toggle('warn', r.needsCheck.length > 0);
  $('rv-review-ja').textContent = r.reviewJa || text;
  $('rv-reply-h').textContent = `② 返信の下書き（${lang}）`;
  $('rv-reply').textContent = r.reply;
  setLang($('rv-origin'), r.language); setLang($('rv-reply'), r.language);
  $('rv-reply-ja').textContent = r.replyJa;
  const pts = $('rv-points');
  if (!r.points.length) pts.append(h('li', {}, '指摘は見つかりませんでした'));
  for (const p of r.points) {
    const [word, cls] = KIND[p.kind] ?? KIND.complaint;
    pts.append(h('li', {}, h('span', { class: `badge ${cls}` }, word), ' ', p.text));
  }
  const list = $('rv-check');
  if (!r.needsCheck.length) list.append(h('li', {}, '特にありません（それでも送る前に全体を読んでください）'));
  for (const n of r.needsCheck) {
    const rule = n.source === 'rule' ? h('span', { class: 'rule' }, h('span', { class: 'sr' }, '（'), '決まりで必ず表示', h('span', { class: 'sr' }, '）')) : null;
    list.append(h('li', {}, h('b', {}, n.point), h('small', {}, n.reason, rule)));
  }
  $('rv-rule-note').hidden = !r.needsCheck.some((n) => n.source === 'rule');
  $('rv-used').textContent = r.usedInfo.length ? `返信に使った宿の情報：${r.usedInfo.map((u) => u.label).join('、')}` : '';
  for (const w of r.warnings) $('rv-warn').append(h('p', { class: 'notice warn' }, w));
  replay($('rv-quad'), 'in');
}

// ---- 例文 ----------------------------------------------------------------------------------

async function loadExamples() {
  const examples = await fetch('/data/review-examples.json').then((r) => r.json());
  const box = clear($('rv-examples'));
  for (const ex of examples) {
    const key = ex.id.split('-')[0];
    const text = h('span', { class: 'ex-text' }, ex.text);
    setLang(text, key);
    box.append(h('button', {
      type: 'button', 'aria-pressed': 'false', dataset: { id: ex.id },
      onclick: (e) => {
        box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        run({ exampleId: ex.id }, ex.text, ex.stars, key);
      },
    }, h('small', {}, h('span', { class: 'ex-lang' }, ex.lang), h('span', { class: 'ex-stars' }, h('span', { class: 'sr' }, `星${ex.stars}`), h('span', { 'aria-hidden': 'true' }, starText(ex.stars))),
      h('span', { class: 'sr' }, '：'), h('span', { class: 'ex-label' }, ex.label)), text,
    h('span', { class: 'ex-go', 'aria-hidden': 'true' }, '試す')));
  }
  stagger(box, 6);
}

// ---- 自由入力 ------------------------------------------------------------------------------

function mountStars() {
  const box = clear($('rv-stars'));
  for (let n = 1; n <= 5; n += 1) {
    box.append(h('button', {
      type: 'button', class: 'star', 'aria-pressed': 'false', 'aria-label': `星${n}`,
      onclick: () => { stars = n; box.querySelectorAll('button').forEach((b, i) => { b.setAttribute('aria-pressed', String(i + 1 === n)); b.classList.toggle('on', i < n); }); },
    }, '★', h('small', {}, String(n))));
  }
}

async function setupFree(cfg) {
  mountStars();
  if (cfg.innFreePerDay) $('rv-free-per-day').textContent = String(cfg.innFreePerDay);
  if (cfg.innReviewMax) { $('rv-free-max').textContent = String(cfg.innReviewMax); $('rv-free-text').maxLength = cfg.innReviewMax; }
  if (!cfg.turnstileSiteKey) { $('rv-free-body').hidden = true; $('rv-free-off').hidden = false; return; }
  // 開くまで置かない（隠れたままだと、ウィジェットの大きさが決まらないことがある）。設定を読む前に開かれていたら、いま置く
  const place = async () => {
    if (!$('rv-free').open || turnstile) return;
    try { turnstile = await mountTurnstile('#turnstile-rv', cfg.turnstileSiteKey); } catch { $('rv-free-note').textContent = 'ロボット対策の部品を読み込めませんでした。再読み込みしてお試しください'; }
  };
  $('rv-free').addEventListener('toggle', place);
  place();
}

$('rv-free-go').addEventListener('click', () => {
  const text = $('rv-free-text').value.trim();
  if (!stars) { $('rv-free-note').textContent = '星の数（1〜5）を選んでください'; shake($('rv-stars')); return; }
  if (!text) { $('rv-free-note').textContent = '口コミの文を入れてください'; shake($('rv-free-text')); return; }
  if (!turnstile?.token()) { $('rv-free-note').textContent = '「ロボットではありません」の確認を待っています'; return; }
  document.querySelectorAll('#rv-examples button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  run({ text, stars, turnstileToken: turnstile.token() }, text, stars);
});

// ---- コピー --------------------------------------------------------------------------------

let copyTimer = 0;
$('rv-copy').addEventListener('click', async () => {
  const btn = $('rv-copy');
  let ok = true;
  try { await navigator.clipboard.writeText($('rv-reply').textContent); } catch { ok = false; }
  btn.style.setProperty('min-width', `${Math.ceil(btn.getBoundingClientRect().width)}px`);
  btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
  btn.classList.toggle('copied', ok); btn.classList.toggle('failed', !ok);
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { btn.textContent = '下書きをコピー'; btn.classList.remove('copied', 'failed'); }, 2000);
  if (ok) setStep(3);
});

/** @param cfg /api/public-config の答え */
export function setupReview(cfg) {
  loadExamples();
  setupFree(cfg);
}
