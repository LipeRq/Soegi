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

// 昼と夜の切り替え（夜は星と蛍。選んだ時間は覚えない）
const tod = document.getElementById('tod');
tod.addEventListener('click', () => {
  const night = tod.getAttribute('aria-pressed') !== 'true';
  tod.setAttribute('aria-pressed', String(night));
  tod.setAttribute('aria-label', night ? '昼の景色に切り替える' : '夜の景色に切り替える');
  document.body.dataset.time = night ? 'night' : 'day';
});
// 区画のようす（見本。内容は架空）
const PLOTS = [
  ['A1', '川そば', '6×8m', '夏は涼しく、水の音が聞こえます', false], ['A2', '川そば', '6×8m', '水辺が近く、朝の霧がきれいです', true], ['A3', '木かげ', '7×9m', 'ブナの木かげ。夏も涼しい区画です', false], ['A4', '木かげ', '7×9m', '大きな木が1本。ハンモックをかけられます', false],
  ['B1', '平ら', '6×8m', '地面が平らで、はじめての方に向いています', false], ['B2', '平ら', '6×8m', '水場とトイレが近い区画です', true], ['B3', '焚き火', '8×10m', '広め。焚き火台を置いても余裕があります', false], ['B4', '焚き火', '8×10m', '広め。大きめのテントでも張れます', false],
  ['C1', '見晴らし', '7×9m', '夕日がきれいに見える高台です', false], ['C2', '見晴らし', '7×9m', '星がよく見える、開けた区画です', false], ['C3', '静か', '6×8m', '奥まった区画で、夜がとても静かです', true], ['C4', '静か', '6×8m', '森の入口。朝は鳥の声で目がさめます', false],
];
const plots = document.getElementById('plots'); const info = document.getElementById('plotinfo');
for (const [id, tag, size, text, taken] of PLOTS) {
  const b = document.createElement('button'); b.type = 'button'; b.className = `plot${taken ? ' taken' : ''}`; b.setAttribute('aria-pressed', 'false');
  b.append(id); const sm = document.createElement('small'); sm.textContent = taken ? '予約あり' : tag; b.append(sm);
  b.addEventListener('click', () => {
    plots.querySelectorAll('.plot').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    info.replaceChildren(); const t = document.createElement('b'); t.textContent = `${id}（${tag}・${size}）`;
    const d = document.createElement('span'); d.textContent = `${text}。${taken ? 'この日は予約が入っています（見本）。' : 'この日は空いています（見本）。'}`;
    info.append(t, d);
  });
  plots.append(b);
}
