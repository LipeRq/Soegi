// 画面の共通部品：合言葉、API呼び出し、DOM作成、ダウンロード。
// 入力は画面内で処理し、サーバーには保存しない。画面のテキストは textContent で入れる（AIの出力は信用しない）。

import { WHO, calcRoi, verdictText } from './roi.js';

const KEY = 'soegi-demo-pass';

export function getPass() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setPass(v) {
  try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* 保存できなくても動く */ }
}

/** 合言葉が無ければ入口へ戻す */
export function requireAuth() {
  if (!getPass()) location.replace('/');
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, body, pass = getPass()) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-demo-pass': encodeURIComponent(pass) },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('通信できませんでした。電波の状態をご確認ください', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* 本文なし */ }
  if (res.status === 401) {
    setPass('');
    if (location.pathname !== '/') location.replace('/');
    throw new ApiError(data?.error || '合言葉が違います', 401);
  }
  if (!res.ok || !data?.ok) throw new ApiError(data?.error || `エラーが発生しました（${res.status}）`, res.status);
  return data.data ?? data;
}

/** DOM作成：h('div', {class:'a', onclick}, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style') Object.assign(el.style, v); // CSPのため style 属性は使わず CSSOM で設定する
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function stamp(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 並行数を決めて順に処理する */
export async function pool(items, limit, worker) {
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}


// ---- 3段階の表示（1 撮る・読み込む → 2 確かめる → 3 Excelにする） ------------------------------

export function setStep(current) {
  document.querySelectorAll('.steps li').forEach((li, i) => {
    const n = i + 1;
    li.classList.toggle('done', n < current);
    if (n === current) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

// ---- 「御社の場合」の計算 ------------------------------------------------------------------


const yen = (n) => n.toLocaleString('ja-JP');

/**
 * @param box 入れ物
 * @param opts {unit:'枚', countLabel, count, minutes, monthlyFee, minutesLabel}
 * @returns {{setMinutes(n)}} 外から1件あたりの分を変えられる
 */
export function mountRoi(box, opts) {
  let who = 'office';
  const count = h('input', { type: 'number', min: '0', max: '100000', step: '1', value: String(opts.count), inputMode: 'numeric', 'aria-label': opts.countLabel });
  const minutes = h('input', { type: 'number', min: '0', max: '600', step: '0.5', value: String(opts.minutes), inputMode: 'decimal', 'aria-label': opts.minutesLabel });
  const rate = h('input', { type: 'range', min: '20', max: '70', step: '5', value: '50', 'aria-label': 'そのうち短くなる割合' });
  const rateOut = h('b', {}, '50%');
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'その作業をしている方' },
    Object.entries(WHO).map(([k, w]) => h('button', {
      type: 'button', 'aria-pressed': String(k === who),
      onclick: (e) => { who = k; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); update(); },
    }, w.label)));
  const out = {
    manual: h('b', {}), saved: h('b', { class: 'good' }), value: h('b', {}), be: h('b', {}), verdict: h('p', { class: 'verdict' }), wage: h('p', { class: 'small-note' }),
  };
  function update() {
    const r = calcRoi({ count: Number(count.value), minutesPerUnit: Number(minutes.value), ratePct: Number(rate.value), who, monthlyFee: opts.monthlyFee });
    rateOut.textContent = `${rate.value}%`;
    out.manual.textContent = `${r.manualHours}時間`;
    out.saved.textContent = `${r.savedHours}時間`;
    out.value.textContent = `月 ${yen(r.value)}円`;
    out.be.textContent = `月 ${r.breakEvenHours}時間`;
    out.verdict.textContent = verdictText(r, opts.monthlyFee);
    out.wage.textContent = `時給 ${yen(r.wage)}円として計算（サイトの「元が取れるかの目安」と同じ。社長・役員 5,000円／事務の方 1,500円（社会保険込み）／現場と兼任の方 2,000円）`;
  }
  [count, minutes, rate].forEach((el) => el.addEventListener('input', update));
  box.append(h('div', { class: 'roi' },
    h('div', {},
      h('div', { class: 'field' }, h('span', {}, 'その作業をしている方'), seg),
      h('div', { class: 'field' }, h('span', {}, opts.countLabel), h('div', { class: 'row' }, count, opts.unit)),
      h('div', { class: 'field' }, h('span', {}, opts.minutesLabel), h('div', { class: 'row' }, minutes, '分')),
      h('div', { class: 'field' }, h('span', {}, 'そのうち短くなる割合（仮置き）'), h('div', { class: 'row' }, rate, rateOut))),
    h('div', {},
      h('div', { class: 'res' },
        h('div', {}, h('span', {}, 'いまの手作業'), out.manual),
        h('div', {}, h('span', {}, '月に浮く時間（目安）'), out.saved),
        h('div', {}, h('span', {}, '金額に換算すると'), out.value),
        h('div', {}, h('span', {}, `月${opts.monthlyFee / 10000}万円の元が取れる目安`), out.be)),
      out.verdict,
      h('p', { class: 'small-note' }, '目安です。実際の割合と時間は、お試し導入で御社の数字を測って確かめます。'),
      out.wage)));
  update();
  return { setMinutes(n) { minutes.value = String(n); update(); } };
}
