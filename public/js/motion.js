// 動きの共通部品（「ライブ」デザイン）。見た目は /css/style.css の「動きの部品」と組で使う。
// - 「動きを減らす」設定の人には、動かさずに最後の状態だけを出す（どの関数もそうなっている）
// - 画面のテキストは textContent だけで入れる（AIの出力は信用しない。common.js と同じ決まり）
// - CSP のため style 属性は使わず、CSSOM（style.setProperty）で値を入れる

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** 「動きを減らす」設定かどうか（途中で変えられても追従する） */
export const reduced = () => Boolean(mq && mq.matches);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 数字を 0（または from）から数え上げる。終わりの表示は format(to) と必ず同じになる。
 * @param el 入れ物
 * @param to 終わりの数
 * @param opts {from, duration, format:(n)=>string}
 */
export function countUp(el, to, opts = {}) {
  const { from = 0, duration = 900, format = (n) => String(Math.round(n)) } = opts;
  if (reduced() || !Number.isFinite(to) || duration <= 0 || typeof requestAnimationFrame !== 'function') {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    // 最初のコマは、フレームの開始時刻が t0 より前のことがある。マイナスにならないよう下も止める（数字が from より小さく出ないように）
    const p = Math.max(0, Math.min(1, (now - t0) / duration));
    const eased = 1 - (1 - p) ** 3;
    el.textContent = format(p < 1 ? from + (to - from) * eased : to);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * 文字を1つずつ出す（AIの答えが出てくる見せ方）。途中でやめても、必ず全文が入る。
 * @param el 入れ物
 * @param text 全文
 * @param opts {cps:1秒あたりの文字数, maxMs:全体の上限, signal:AbortSignal}
 */
export async function typeText(el, text, opts = {}) {
  const { cps = 60, maxMs = 2400, signal } = opts;
  const chars = Array.from(String(text ?? ''));
  if (reduced() || chars.length === 0) { el.textContent = chars.join(''); return; }
  const step = Math.max(1, Math.ceil(chars.length / Math.max(1, (maxMs / 1000) * cps)));
  el.classList.add('typing');
  try {
    for (let i = step; i < chars.length; i += step) {
      if (signal?.aborted) break;
      el.textContent = chars.slice(0, i).join('');
      await sleep(1000 / cps);
    }
  } finally {
    el.textContent = chars.join('');
    el.classList.remove('typing');
  }
}

/** 「考え中」の3つの点 */
export function thinking(label = '考えています') {
  const el = document.createElement('span');
  el.className = 'thinking';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', label);
  el.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  return el;
}

/** 並んだ子を順に出す（.stagger と --i）。max 個目から先は、待たせずに一緒に出す */
export function stagger(parent, max = 12) {
  parent.classList.add('stagger');
  Array.from(parent.children).forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, max))));
  return parent;
}

/** クラスを付け直して、CSS の動きをもう一度流す（棒が伸びる .play など） */
export function replay(el, cls = 'play') {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** 値が変わった所を、一瞬だけ光らせる */
export function flash(el) { replay(el, 'flash'); }

/** 入力の間違いなどを、横に揺らして知らせる */
export function shake(el) { replay(el, 'shake'); }

/** 画面に入ったときに1回だけ呼ぶ。対応しないブラウザでは、すぐ呼ぶ */
export function onVisible(el, fn, opts = {}) {
  if (typeof IntersectionObserver !== 'function') { fn(el); return () => {}; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(el); }
  }, { threshold: opts.threshold ?? 0.25 });
  io.observe(el);
  return () => io.disconnect();
}

/** 画面に見えている間だけ true（裏のタブ・画面の外では、繰り返しの動きを止めるために使う） */
export function watchVisible(el) {
  const state = { visible: true };
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => { state.visible = entries[entries.length - 1].isIntersecting; }).observe(el);
  }
  return () => state.visible && !document.hidden;
}

/** マウスの位置をタイルに渡す（タイルの上を光が追いかける。--mx / --my を CSS が使う） */
export function spotlight(selector = '.tile') {
  if (reduced() || !matchMedia('(hover: hover)').matches) return;
  document.addEventListener('pointermove', (e) => {
    const t = e.target instanceof Element ? e.target.closest(selector) : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}
