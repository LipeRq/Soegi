import { reduce } from './common.js';
// 背景：ゆっくり動く光の点と線（動きを減らす設定のときは、止めた1枚）
const cv = document.getElementById('bg'); const g = cv.getContext('2d');
let W; let H; let pts = [];
const size = () => {
  const d = Math.min(devicePixelRatio || 1, 2);
  W = cv.width = innerWidth * d; H = cv.height = innerHeight * d;
  const n = Math.round((innerWidth * innerHeight) / 24000);
  pts = Array.from({ length: Math.max(18, Math.min(n, 70)) }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.3 * d, vy: (Math.random() - 0.5) * 0.3 * d }));
};
const draw = () => {
  g.clearRect(0, 0, W, H);
  const reach = Math.min(W, H) * 0.18;
  for (const p of pts) {
    if (!reduce) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; }
    g.fillStyle = 'rgba(61,240,255,.7)'; g.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const dx = pts[i].x - pts[j].x; const dy = pts[i].y - pts[j].y; const d = Math.hypot(dx, dy);
    if (d < reach) { g.strokeStyle = `rgba(61,240,255,${0.18 * (1 - d / reach)})`; g.beginPath(); g.moveTo(pts[i].x, pts[i].y); g.lineTo(pts[j].x, pts[j].y); g.stroke(); }
  }
  if (!reduce && !document.hidden) requestAnimationFrame(draw);
};
size(); draw();
addEventListener('resize', () => { size(); if (reduce) draw(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) draw(); });
// 数字
document.querySelectorAll('[data-to]').forEach((el) => {
  const to = Number(el.dataset.to); const dec = Number(el.dataset.dec || 0);
  if (reduce) { el.textContent = to.toFixed(dec); return; }
  const t0 = performance.now();
  const tick = (t) => { const p = Math.min(1, (t - t0) / 1600); el.textContent = (to * (1 - (1 - p) ** 3)).toFixed(dec); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
// タブ（矢印キーでも切り替え）
const tabs = [...document.querySelectorAll('[role=tab]')];
const pick = (t) => tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; });
tabs.forEach((t, i) => {
  t.addEventListener('click', () => pick(t));
  t.addEventListener('keydown', (e) => { const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!k) return; const n = tabs[(i + k + tabs.length) % tabs.length]; pick(n); n.focus(); });
});
const f = document.querySelector('.form');
f.addEventListener('submit', (e) => { e.preventDefault(); f.querySelector('.done').hidden = false; });
