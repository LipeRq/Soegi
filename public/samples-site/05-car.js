// 在庫は架空。絞り込み・並べ替え・月々の目安は、すべてプログラムの計算
const STOCK = [
  { id: 1, name: 'ミライ ポコ', type: 'kei', year: 2022, km: 18000, price: 118, color: '#ff8a3d', note: 'ワンオーナー' },
  { id: 2, name: 'ミライ ポコ X', type: 'kei', year: 2020, km: 41000, price: 89, color: '#3dbf8a' },
  { id: 3, name: 'ミライ ドライブ', type: 'suv', year: 2021, km: 32000, price: 248, color: '#0b5fff', note: '4WD・スタッドレス付' },
  { id: 4, name: 'ミライ ドライブ L', type: 'suv', year: 2023, km: 9000, price: 329, color: '#1f2a44', note: '試乗できます' },
  { id: 5, name: 'ミライ クロス', type: 'suv', year: 2019, km: 62000, price: 176, color: '#c93b3b' },
  { id: 6, name: 'ミライ リムジン', type: 'sedan', year: 2021, km: 27000, price: 214, color: '#7a8699' },
  { id: 7, name: 'ミライ スパーク', type: 'ev', year: 2023, km: 12000, price: 298, color: '#7a5cff', note: '電気・充電ケーブル付' },
  { id: 8, name: 'ミライ スパーク S', type: 'ev', year: 2022, km: 21000, price: 262, color: '#00a6b8' },
  { id: 9, name: 'ミライ セレナーデ', type: 'sedan', year: 2018, km: 74000, price: 132, color: '#2b2f38' },
];
const LABEL = { kei: '軽', suv: 'SUV', sedan: 'セダン', ev: '電気' };
const st = { type: 'all', max: 400, sort: 'p' };
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const monthly = (priceMan, downMan, n, rate) => {
  const loan = Math.max(0, (priceMan - downMan) * 10000);
  if (!loan) return { m: 0, total: 0 };
  const r = rate / 100 / 12;
  const m = r === 0 ? loan / n : (loan * r) / (1 - (1 + r) ** -n);
  return { m: Math.round(m), total: Math.round(m * n) };
};
function card(c) {
  const li = document.createElement('li');
  li.style.setProperty('--cc', c.color);
  const pic = document.createElement('div'); pic.className = 'pic';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 400 160'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use'); use.setAttribute('href', `#car-${c.type}`); svg.append(use); pic.append(svg);
  if (c.note) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = c.note; pic.append(b); }
  const info = document.createElement('div'); info.className = 'info';
  const h = document.createElement('h3'); h.textContent = c.name;
  const meta = document.createElement('div'); meta.className = 'meta';
  for (const t of [LABEL[c.type], `${c.year}年式`, `${(c.km / 10000).toFixed(1)}万km`, '修復歴なし']) { const s = document.createElement('span'); s.textContent = t; meta.append(s); }
  const price = document.createElement('div'); price.className = 'price'; price.textContent = `${c.price}万円`;
  const sm = document.createElement('small'); sm.textContent = '総額'; price.append(sm);
  const mo = document.createElement('div'); mo.className = 'mo'; mo.textContent = `月々 約${monthly(c.price, 0, 60, 3.9).m.toLocaleString('ja-JP')}円〜（60回・目安）`;
  info.append(h, meta, price, mo); li.append(pic, info);
  return li;
}
function render() {
  const list = STOCK.filter((c) => (st.type === 'all' || c.type === st.type) && c.price <= st.max)
    .sort((a, b) => (st.sort === 'p' ? a.price - b.price : st.sort === 'y' ? b.year - a.year : a.km - b.km));
  $('cars').replaceChildren(...list.map(card));
  $('count').textContent = list.length ? `${list.length}台` : '条件に合う車がありません。予算や種類を変えてみてください。';
}
document.querySelectorAll('.chips button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.chips button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  st.type = b.dataset.t; render();
}));
$('price').addEventListener('input', (e) => { st.max = Number(e.target.value); $('pv').textContent = `${st.max}万円`; render(); });
$('sort').addEventListener('change', (e) => { st.sort = e.target.value; render(); });
function calc() {
  const p = Number($('c-price').value); const d = Number($('c-down').value); const n = Number($('c-n').value); const r = Number($('c-r').value);
  if (![p, d, r].every(Number.isFinite) || p < 0 || d < 0 || r < 0) { $('monthly').textContent = '—'; $('total').textContent = '数字を入れてください'; return; }
  if (d >= p) { $('monthly').textContent = '0円'; $('total').textContent = '頭金だけで足ります'; return; }
  const x = monthly(p, d, n, r);
  $('monthly').textContent = `${x.m.toLocaleString('ja-JP')}円`;
  $('total').textContent = `${n}回の合計：約${x.total.toLocaleString('ja-JP')}円（頭金のぞく・目安）`;
}
$('calc').addEventListener('input', calc);
$('calc').addEventListener('submit', (e) => e.preventDefault());
render(); calc();
