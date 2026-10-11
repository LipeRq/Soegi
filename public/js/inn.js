// デモB：宿の多言語対応（公開ページ・合言葉なし）。
// 例文はサーバー側でキャッシュされ、同じ例は毎回同じ結果。自由入力は Turnstile ＋ 1日5回まで。
import { api, h, clear, setStep } from './common.js';
import { pricingText } from './pricing.js';
import { FAQ_LANGS, faqToHtml } from './faq-html.js';

const $ = (id) => document.getElementById(id);
$('pricing').textContent = pricingText('inn');

const LANG_LABEL = { zh: '繁体字中国語', en: '英語', ko: '韓国語', ja: '日本語', vi: 'ベトナム語', th: 'タイ語', fr: 'フランス語', de: 'ドイツ語', es: 'スペイン語' };
let innName = '';
let faqItems = [];
let faqLang = 'ja';
let turnstileToken = '';
let turnstileWidget = null;

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
    box.append(h('button', {
      type: 'button', 'aria-pressed': 'false', dataset: { id: ex.id },
      onclick: (e) => {
        box.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        run({ exampleId: ex.id }, ex.text);
      },
    }, h('small', {}, `${ex.lang}：${ex.label}`), ex.text));
  }
}

// ---- 下書きを作る ------------------------------------------------------------------------

async function run(body, inquiryText) {
  $('result').hidden = false;
  setStep(1);
  $('phase').textContent = '宿の情報を読んで、返信の下書きを作っています…';
  for (const id of ['r-inq', 'r-reply', 'r-replyja']) $(id).textContent = '';
  clear($('r-check')); clear($('stats')); clear($('r-warn')); $('r-used').textContent = '';
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const t0 = performance.now();
  try {
    const r = await api('/api/inn-reply', body);
    show(r, (performance.now() - t0) / 1000, inquiryText);
    setStep(2);
  } catch (e) {
    $('phase').textContent = e.message;
  } finally {
    if (body.text) resetTurnstile();
  }
}

function show(r, sec, inquiryText) {
  const lang = LANG_LABEL[r.language] ?? r.language;
  $('phase').textContent = r.cached ? '用意した例文なので、前に作った下書きをそのまま出しています（AIは呼んでいません）。' : '下書きができました。';
  const stat = (label, value, unit, cls = '') => h('div', { class: `stat ${cls}` }, h('span', {}, label), h('b', {}, value, h('small', {}, unit)));
  $('stats').append(
    stat('かかった時間', sec.toFixed(1), '秒', 'good'),
    stat('問い合わせの言語', lang, ''),
    stat('送る前に確かめる点', String(r.needsCheck.length), '件', r.needsCheck.length ? 'warn' : ''),
  );
  $('r-inq').textContent = r.inquiryJa || inquiryText;
  $('r-reply-h').textContent = `② 返信の下書き（${lang}）`;
  $('r-reply').textContent = r.reply;
  $('r-replyja').textContent = r.replyJa;
  const list = $('r-check');
  if (!r.needsCheck.length) list.append(h('li', {}, '特にありません（それでも送る前に全体を読んでください）'));
  for (const n of r.needsCheck) {
    list.append(h('li', {}, h('b', {}, n.point), h('small', {}, `${n.reason}${n.source === 'rule' ? '（決まりで必ず表示）' : ''}`)));
  }
  $('r-used').textContent = r.usedInfo.length ? `返信に使った宿の情報：${r.usedInfo.map((u) => u.label).join('、')}` : '';
  for (const w of r.warnings) $('r-warn').append(h('p', { class: 'notice warn' }, w));
  if (typeof r.remaining === 'number') $('free-note').textContent = `今日はあと${r.remaining}回使えます`;
}

$('copy-reply').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('r-reply').textContent); $('copy-reply').textContent = 'コピーしました'; setStep(3); } catch { $('copy-reply').textContent = 'コピーできませんでした'; }
  setTimeout(() => { $('copy-reply').textContent = '下書きをコピー'; }, 2000);
});

// ---- 自由入力（Turnstile） -----------------------------------------------------------------

function resetTurnstile() {
  turnstileToken = '';
  if (window.turnstile && turnstileWidget != null) window.turnstile.reset(turnstileWidget);
}

async function setupFree() {
  let cfg = {};
  try { cfg = await (await fetch('/api/public-config')).json(); } catch { /* 設定を取れなければ自由入力は出さない */ }
  if (cfg.innFreePerDay) $('free-per-day').textContent = String(cfg.innFreePerDay);
  if (cfg.innFreeMax) $('free-max').textContent = String(cfg.innFreeMax);
  if (!cfg.turnstileSiteKey) { $('free-body').hidden = true; $('free-off').hidden = false; return; }
  window.onTurnstileLoad = () => {
    turnstileWidget = window.turnstile.render('#turnstile', {
      sitekey: cfg.turnstileSiteKey, language: 'ja',
      callback: (t) => { turnstileToken = t; },
      'expired-callback': () => { turnstileToken = ''; },
    });
  };
  document.head.append(h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit', async: true, defer: true }));
}

$('free-go').addEventListener('click', () => {
  const text = $('free-text').value.trim();
  if (!text) { $('free-note').textContent = '問い合わせの文を入れてください'; return; }
  if (!turnstileToken) { $('free-note').textContent = '「ロボットではありません」の確認を待っています'; return; }
  document.querySelectorAll('#examples button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  run({ text, turnstileToken }, text);
});

// ---- よくある質問 ------------------------------------------------------------------------

function renderFaq() {
  clear($('faq-lang')).append(...FAQ_LANGS.map((l) => h('button', {
    type: 'button', 'aria-pressed': String(l.key === faqLang), onclick: () => { faqLang = l.key; renderFaq(); },
  }, l.label)));
  const lang = FAQ_LANGS.find((l) => l.key === faqLang);
  const list = clear($('faq-list'));
  list.setAttribute('lang', lang.lang);
  for (const it of faqItems) list.append(h('dt', {}, it[`q_${faqLang}`]), h('dd', {}, it[`a_${faqLang}`]));
}

$('faq-go').addEventListener('click', async () => {
  $('faq-go').disabled = true;
  $('faq-note').textContent = '';
  const t0 = performance.now();
  try {
    const r = await api('/api/inn-faq', {});
    faqItems = r.items;
    $('faq').hidden = false;
    renderFaq();
    $('faq-note').textContent = `${faqItems.length}問・${((performance.now() - t0) / 1000).toFixed(1)}秒${r.cached ? '（前に作ったものをそのまま表示）' : ''}。載せる前に、スタッフが内容を確かめてください。`;
    setStep(2);
  } catch (e) {
    $('faq-note').textContent = e.message;
  } finally {
    $('faq-go').disabled = false;
  }
});

$('faq-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(faqToHtml(faqItems, innName)); $('faq-copy').textContent = 'コピーしました'; } catch { $('faq-copy').textContent = 'コピーできませんでした'; }
  setTimeout(() => { $('faq-copy').textContent = 'サイトに貼るHTMLをコピー'; }, 2000);
});

load();
setupFree();
setStep(1);
