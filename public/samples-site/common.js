// 見本サイト共通：スクロールで現れる／動きを減らす設定のときは止める
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const els = document.querySelectorAll('[data-reveal]');
if (reduce || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('in'));
else {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
  els.forEach((e) => io.observe(e));
}
export { reduce };
