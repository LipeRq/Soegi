import { reduce } from './common.js';
// 数字がふえる
const nums = document.querySelectorAll('[data-count]');
const run = (el) => {
  const to = Number(el.dataset.count);
  if (reduce) { el.textContent = to; return; }
  const t0 = performance.now();
  const tick = (t) => { const p = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(to * (1 - (1 - p) ** 3)); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
if ('IntersectionObserver' in window && !reduce) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }), { threshold: 0.6 });
  nums.forEach((n) => io.observe(n));
} else nums.forEach(run);
// カードが、マウスに合わせて傾く
if (!reduce && matchMedia('(hover: hover)').matches) {
  document.querySelectorAll('[data-tilt]').forEach((c) => {
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5; const y = (e.clientY - r.top) / r.height - 0.5;
      c.style.setProperty('transform', `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`);
    });
    c.addEventListener('pointerleave', () => c.style.removeProperty('transform'));
  });
}
const f = document.querySelector('.form');
f.addEventListener('submit', (e) => { e.preventDefault(); f.querySelector('.done').hidden = false; });
