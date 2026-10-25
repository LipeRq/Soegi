// デモB：宿の多言語対応（公開ページ・パスワードなし）。
// 例文はサーバー側でキャッシュされ、同じ例は毎回同じ結果。自由入力は Turnstile ＋ 1日5回まで。
// 動きの決まり：待ち時間を足さない。出ている秒数は実際に測った値。「要確認」は、動きの途中でも隠さない。
import { api, h, clear, setStep } from './common.js';
import { FAQ_LANGS, faqToHtml } from './faq-html.js';
import { reduced, typeText, thinking, stagger, replay, shake } from './motion.js';
import { mountEstimate } from './estimate-ui.js';
import { mountTurnstile } from './turnstile.js';
import { setupReview } from './inn-review.js';

const $ = (id) => document.getElementById(id);

const LANG_LABEL = { zh: '繁体字中国語', en: '英語', ko: '韓国語', ja: '日本語', vi: 'ベトナム語', th: 'タイ語', fr: 'フランス語', de: 'ドイツ語', es: 'スペイン語' };
let innName = '';
let faqItems = [];
let faqLang = 'ja';
let turnstile = null; // { token(), reset() }
let runSeq = 0; // 続けて押されたら、後から押した問い合わせの結果だけを出す
let stopTyping = () => {}; // 返信を1文字ずつ出す見せ方を、途中でやめる

/** lang 属性に入れる値（その言語に合った字形で出すため）。AIの返した値はそのまま信用せず、形を確かめる */
const langAttr = (key) => (key === 'zh' ? 'zh-Hant-TW' : /^[a-z]{2,3}$/.test(key || '') ? key : '');
function setLang(el, key) {
  const v = langAttr(key);
  if (v) el.setAttribute('lang', v); else el.removeAttribute('lang');
}

// ---- 宿の情報と例文 ----------------------------------------------------------------------

async function load() {
  const [inn, examples] = await Promise.all([
    fetch('/data/yukiakari.json').then((r) => r.json()),
    fetch('/data/inn-examples.json').then((r) => r.json()),
  ]);
  innName = inn.name;
  $('inn-name').textContent = `架空の宿：${inn.name}。${inn.about}`;
  clear($('inn-info')).append(...inn.items.flatMap((i) => [h('dt', {}, i.label), h('dd', {}, i.text)]), h('dd', { class: 'small-note' }, inn.note));
  const box = clear($('examples'));
  for (const ex of examples) {
    const key = ex.id.split('-')[0];
    const text = h('span', { class: 'ex-text' }, ex.text);
    setLang(text, key);
    box.append(h('button', {
      type: 'button', 'aria-pressed': 'false', dataset: { id: ex.id },
      onclick: (e) => {
        box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        run({ exampleId: ex.id }, ex.text, key);
      },
    }, h('small', {}, h('span', { class: 'ex-lang' }, ex.lang), h('span', { class: 'sr' }, '：'), h('span', { class: 'ex-label' }, ex.label)), text,
    h('span', { class: 'ex-go', 'aria-hidden': 'true' }, '試す')));
  }
  stagger(box, 6);
}

// ---- 下書きを作る ------------------------------------------------------------------------

const dots = thinking('返信の下書きを作っています');

/** いま何をしているかの一文。待っている間だけ、横に「考え中」の点を出す */
function setPhase(text, state) {
  $('phase').textContent = text;
  $('result').dataset.state = state;
  if (state === 'loading') $('phase').after(dots); else dots.remove();
}

/** 大きな数字の入れ物を先に並べておく（結果が出たときに、下の箱が動かないように） */
function mountStats() {
  const stat = (label, unit, cls, tag = 'div', attrs = {}) => {
    const v = h('span', { class: 'v' });
    const b = h('b', { class: 'wait' }, v, h('small', {}, unit));
    return { el: h(tag, { class: `stat ${cls}`, ...attrs }, h('span', {}, label), b), b, v };
  };
  // 「確かめる点」の数字は ④ への近道にする（スマホでは ④ が下のほうにあり、すぐには見えないため）
  const toCheck = (e) => {
    e.preventDefault();
    $('r-checkbox').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  };
  const s = {
    time: stat('かかった時間', '秒', 'good'),
    lang: stat('問い合わせの言語', '', 'word'),
    check: stat('送る前に確かめる点', '件', 'jump', 'a', { href: '#r-checkbox', onclick: toCheck }),
  };
  s.check.el.append(h('em', {}, '④ を見る'));
  clear($('stats')).append(s.time.el, s.lang.el, s.check.el);
  return s;
}

/** 待っている間、実際に過ぎた秒数をそのまま出す（作った数字ではない）。返り値で止める */
function startClock(st, t0) {
  if (reduced()) return () => {};
  let on = true;
  st.b.classList.remove('wait');
  const tick = () => {
    if (!on) return;
    st.v.textContent = ((performance.now() - t0) / 1000).toFixed(1);
    requestAnimationFrame(tick);
  };
  tick();
  return () => { on = false; };
}

async function run(body, inquiryText, inquiryLang = '') {
  const seq = ++runSeq;
  stopTyping();
  $('result').hidden = false;
  setStep(1);
  setPhase('宿の情報を読んで、返信の下書きを作っています…', 'loading');
  for (const id of ['r-inq', 'r-reply', 'r-replyja']) $(id).textContent = '';
  clear($('r-check')); clear($('r-warn')); $('r-used').textContent = '';
  $('r-rule-note').hidden = true;
  $('r-reply-h').textContent = '② 返信の下書き';
  // 選んだ問い合わせは、待っている間も見えるようにしておく（スマホでは例文が画面の外に出るため）
  $('r-origin').textContent = inquiryText;
  setLang($('r-origin'), inquiryLang);
  replay($('r-origin').parentElement, 'in');
  const st = mountStats();
  $('result').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  const t0 = performance.now();
  const stopClock = startClock(st.time, t0);
  try {
    const r = await api('/api/inn-reply', body);
    const sec = (performance.now() - t0) / 1000;
    if (typeof r.remaining === 'number') $('free-note').textContent = `今日はあと${r.remaining}回使えます`;
    if (seq !== runSeq) return;
    show(r, sec, inquiryText, st);
    setStep(2);
  } catch (e) {
    if (seq !== runSeq) return;
    clear($('stats'));
    setPhase(e.message, 'error');
  } finally {
    stopClock();
    if (body.text) turnstile?.reset();
  }
}

function show(r, sec, inquiryText, st) {
  const lang = LANG_LABEL[r.language] ?? r.language;
  setPhase(r.cached ? '例文なので、作り置きの下書きを出しています（AIは使っていません）。' : '下書きができました。', 'done');
  for (const s of Object.values(st)) s.b.classList.remove('wait');
  st.time.v.textContent = sec.toFixed(1);
  st.lang.v.textContent = lang;
  st.check.el.classList.toggle('warn', r.needsCheck.length > 0);
  // 注意の件数は、数え上げずに最初から本当の数を出す（少なく見える瞬間を作らない）
  st.check.v.textContent = String(r.needsCheck.length);

  $('r-inq').textContent = r.inquiryJa || inquiryText;
  $('r-reply-h').textContent = `② 返信の下書き（${lang}）`;
  $('r-reply').textContent = r.reply;
  setLang($('r-origin'), r.language);
  setLang($('r-reply'), r.language);
  $('r-replyja').textContent = r.replyJa;
  const list = $('r-check');
  if (!r.needsCheck.length) list.append(h('li', {}, '特にありません（それでも送る前に全体を読んでください）'));
  for (const n of r.needsCheck) {
    // 「決まりで必ず表示」は印にして目立たせる（かっこは読み上げ・コピー用に残す）
    const rule = n.source === 'rule' ? h('span', { class: 'rule' }, h('span', { class: 'sr' }, '（'), '決まりで必ず表示', h('span', { class: 'sr' }, '）')) : null;
    list.append(h('li', {}, h('b', {}, n.point), h('small', {}, n.reason, rule)));
  }
  $('r-rule-note').hidden = !r.needsCheck.some((n) => n.source === 'rule');
  $('r-used').textContent = r.usedInfo.length ? `返信に使った宿の情報：${r.usedInfo.map((u) => u.label).join('、')}` : '';
  for (const w of r.warnings) $('r-warn').append(h('p', { class: 'notice warn' }, w));

  replay($('quad'), 'in'); // 箱を ①→④ の順に出す（④は消さずに、位置だけ動かす）
  typeReply(r.reply, r.language);
}

/**
 * 返信の下書きを、1文字ずつ出して見せる。
 * 本物（#r-reply）には最初から全文が入っていて、コピーも読み上げも待たずにできる。上に重ねた写しだけを動かす。
 */
function typeReply(text, language) {
  stopTyping();
  if (reduced()) return;
  const box = $('r-typebox');
  const ghost = h('p', { class: 'ghost', 'aria-hidden': 'true' });
  setLang(ghost, language);
  const ac = new AbortController();
  box.append(ghost);
  box.classList.add('is-typing');
  stopTyping = () => {
    stopTyping = () => {};
    ac.abort();
    ghost.remove();
    box.classList.remove('is-typing');
  };
  typeText(ghost, text, { cps: 60, maxMs: 1500, signal: ac.signal }).then(() => { if (!ac.signal.aborted) stopTyping(); });
}
// 待たずに全文を見たいときは、下書きを押す
$('r-typebox').addEventListener('click', () => stopTyping());

// ---- コピー：押した結果を、ボタンの色と言葉で知らせる -----------------------------------------

const copyTimers = new Map();
function copyDone(btn, ok, label) {
  btn.style.setProperty('min-width', `${Math.ceil(btn.getBoundingClientRect().width)}px`); // 文字が変わっても、まわりを動かさない
  btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
  btn.classList.toggle('copied', ok);
  btn.classList.toggle('failed', !ok);
  clearTimeout(copyTimers.get(btn));
  copyTimers.set(btn, setTimeout(() => { btn.textContent = label; btn.classList.remove('copied', 'failed'); }, 2000));
}

$('copy-reply').addEventListener('click', async () => {
  let ok = true;
  try { await navigator.clipboard.writeText($('r-reply').textContent); } catch { ok = false; }
  copyDone($('copy-reply'), ok, '下書きをコピー');
  if (ok) setStep(3);
});

// ---- 自由入力（Turnstile） -----------------------------------------------------------------

async function setupFree() {
  let cfg = {};
  try { cfg = await (await fetch('/api/public-config')).json(); } catch { /* 設定を取れなければ自由入力は出さない */ }
  setupReview(cfg);
  if (cfg.innFreePerDay) $('free-per-day').textContent = String(cfg.innFreePerDay);
  if (cfg.innFreeMax) $('free-max').textContent = String(cfg.innFreeMax);
  if (!cfg.turnstileSiteKey) { $('free-body').hidden = true; $('free-off').hidden = false; return; }
  try { turnstile = await mountTurnstile('#turnstile', cfg.turnstileSiteKey); } catch { $('free-note').textContent = 'ロボット対策の部品を読み込めませんでした。再読み込みしてお試しください'; }
}

$('free-go').addEventListener('click', () => {
  const text = $('free-text').value.trim();
  if (!text) { $('free-note').textContent = '問い合わせの文を入れてください'; shake($('free-text')); return; }
  if (!turnstile?.token()) { $('free-note').textContent = '「ロボットではありません」の確認を待っています'; return; }
  document.querySelectorAll('#examples button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  run({ text, turnstileToken: turnstile.token() }, text);
});

// ---- よくある質問 ------------------------------------------------------------------------

// 言語のボタンは1回だけ作る（作り直すと、キーボードで選んでいる位置が外れるため）
$('faq-lang').append(...FAQ_LANGS.map((l) => h('button', {
  type: 'button', 'aria-pressed': String(l.key === faqLang), lang: l.lang, dataset: { key: l.key },
  onclick: () => { if (l.key !== faqLang) { faqLang = l.key; renderFaq(); } },
}, l.label)));

function renderFaq() {
  $('faq-lang').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === faqLang)));
  const lang = FAQ_LANGS.find((l) => l.key === faqLang);
  const list = clear($('faq-list'));
  list.setAttribute('lang', lang.lang);
  for (const it of faqItems) list.append(h('div', { class: 'qa' }, h('dt', {}, it[`q_${faqLang}`]), h('dd', {}, it[`a_${faqLang}`])));
  stagger(list, 8); // 言語を切り替えるたびに、上から順にさっと出し直す
}

$('faq-go').addEventListener('click', async () => {
  $('faq-go').disabled = true;
  const wait = clear($('faq-wait'));
  wait.classList.remove('err');
  wait.append(thinking('よくある質問を作っています'), '宿の情報から、4言語のよくある質問をまとめています…');
  const t0 = performance.now();
  try {
    const r = await api('/api/inn-faq', {});
    faqItems = r.items;
    $('faq').hidden = false;
    renderFaq();
    // 載せる前の注意は、質問の一覧より上に、太字で出す
    clear($('faq-note')).append(
      `${faqItems.length}問・${((performance.now() - t0) / 1000).toFixed(1)}秒${r.cached ? '（前に作ったものをそのまま表示）' : ''}。`,
      h('b', {}, '載せる前に、スタッフが内容を確かめてください。'));
    setStep(2);
    clear(wait);
  } catch (e) {
    clear(wait).textContent = e.message;
    wait.classList.add('err');
  } finally {
    $('faq-go').disabled = false;
  }
});

$('faq-copy').addEventListener('click', async () => {
  let ok = true;
  try { await navigator.clipboard.writeText(faqToHtml(faqItems, innName)); } catch { ok = false; }
  copyDone($('faq-copy'), ok, 'サイトに貼るHTMLをコピー');
});

// ---- 切り替え（問い合わせ／口コミ返信） ------------------------------------------------------
function setTab(which, focus = false) {
  for (const k of ['inquiry', 'review']) {
    $(`tab-${k}`).setAttribute('aria-selected', String(k === which));
    $(`tab-${k}`).tabIndex = k === which ? 0 : -1;
    $(`pane-${k}`).hidden = k !== which;
  }
  setStep(1); // 3段階の表示は2つのタブで共有。切り替えたら、はじめに戻す
  $('step1-label').textContent = which === 'review' ? '口コミを選ぶ' : '問い合わせを選ぶ';
  if (focus) $(`tab-${which}`).focus();
  history.replaceState(null, '', which === 'review' ? '#review' : location.pathname);
}
$('tab-inquiry').addEventListener('click', () => setTab('inquiry'));
$('tab-review').addEventListener('click', () => setTab('review'));
for (const k of ['inquiry', 'review']) {
  $(`tab-${k}`).addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(k === 'inquiry' ? 'review' : 'inquiry', true); }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setTab(e.key === 'Home' ? 'inquiry' : 'review', true); }
  });
}
$('tab-review').tabIndex = -1;

load();
setupFree();
if (location.hash === '#review') setTab('review');
setStep(1);

// 御社の場合（試算）と持ち帰り1枚
mountEstimate(document.getElementById('estimate'), { keys: ['inn'] });
