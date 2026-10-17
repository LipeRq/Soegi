// 画面の共通部品：パスワード、API呼び出し、DOM作成、ダウンロード。
// 入力は画面内で処理し、サーバーには保存しない。画面のテキストは textContent で入れる（AIの出力は信用しない）。

const KEY = 'soegi-demo-pass';

export function getPass() {
  try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setPass(v) {
  try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* 保存できなくても動く */ }
}

/** パスワードが無ければ入口へ戻す */
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
    throw new ApiError(data?.error || 'パスワードが違います', 401);
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
