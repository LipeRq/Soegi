import './common.js';
const T = {
  spring: ['春：芽吹きの森', '山菜と新緑の季節。夜はまだ冷えるので、あたたかい寝袋を。'],
  summer: ['夏：木かげの涼しさ', '標高があるので、昼も風が涼しい。夜は蛍と星空を楽しめます。'],
  autumn: ['秋：色づく森', '紅葉は10月中旬から。焚き火のぬくもりが、いちばん似合う季節です。'],
  winter: ['冬：雪の静けさ', 'コテージのみ営業。薪ストーブの前で、雪の音を聞いてください。'],
};
const box = document.getElementById('sbox');
document.querySelectorAll('.seasons button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.seasons button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  const [t, x] = T[b.dataset.s];
  box.dataset.s = b.dataset.s; document.getElementById('stitle').textContent = t; document.getElementById('stext').textContent = x;
}));
document.getElementById('calc').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target; const n = Number(f.n.value); const p = Number(f.p.value);
  f.querySelector('.out').textContent = `${n}泊で、${(n * p).toLocaleString('ja-JP')}円からが目安です（見本）。`;
});
