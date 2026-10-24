// 営業中かどうか：日本時間の曜日と時刻から、プログラムで決める
const H = { 0: [7, 14], 1: [7, 17], 2: null, 3: [7, 17], 4: [7, 17], 5: [7, 17], 6: [7, 18] };
const jp = new Date(Date.now() + (new Date().getTimezoneOffset() + 540) * 60000);
const d = jp.getDay(); const now = jp.getHours() + jp.getMinutes() / 60;
const st = document.getElementById('status'); const t = H[d];
if (!t) { st.textContent = '本日は定休日です'; st.classList.add('closed'); }
else if (now >= t[0] && now < t[1]) { st.textContent = `営業中（${t[1]}:00まで）`; st.classList.add('open'); }
else if (now < t[0]) { st.textContent = `まもなく開店（${t[0]}:00から）`; st.classList.add('closed'); }
else { st.textContent = '本日の営業は終了しました'; st.classList.add('closed'); }
document.querySelector(`#ht tr[data-d="${d}"]`)?.classList.add('today');
// 種類で絞る
const btns = document.querySelectorAll('.chips button'); const items = document.querySelectorAll('#items li');
btns.forEach((b) => b.addEventListener('click', () => {
  btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  items.forEach((li) => { li.hidden = b.dataset.k !== 'all' && li.dataset.k !== b.dataset.k; });
}));

// ---- パンの絵と、取り置き（見本。計算はプログラム。送信はしない） ----
const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  loaf: '<path class="a" d="M10 40 V26 Q10 12 32 12 Q54 12 54 26 V40 Q54 50 44 50 H20 Q10 50 10 40Z"/><path class="b" d="M22 24 L28 34 M32 22 L38 34 M42 24 L46 32"/>',
  baguette: '<path class="a" d="M8 46 Q4 40 10 34 L38 8 Q46 2 52 8 Q58 14 52 22 L24 50 Q16 56 8 46Z"/><path class="b" d="M20 36 L28 44 M30 26 L38 34 M40 16 L48 24"/>',
  bun: '<circle class="a" cx="32" cy="34" r="22"/><path class="e" d="M18 26 Q22 16 32 14"/><circle class="c" cx="32" cy="34" r="5"/>',
  roll: '<circle class="a" cx="32" cy="32" r="22"/><path class="b" d="M32 32 m0 -4 a4 4 0 1 1 -4 4 a9 9 0 1 1 9 9 a14 14 0 1 1 -14 -14"/>',
  danish: '<path class="a" d="M10 16 L54 16 L54 52 L10 52Z" stroke-linejoin="round"/><path class="d" d="M16 22 L48 22 L48 46 L16 46Z"/><circle class="c" cx="32" cy="34" r="8"/><path class="e" d="M28 30 Q30 27 34 28"/>',
};
const pick = (n) => (/バゲット/.test(n) ? 'baguette' : /食パン|くるみ/.test(n) ? 'loaf' : /シナモン/.test(n) ? 'roll' : /デニッシュ/.test(n) ? 'danish' : 'bun');
const cart = new Map(); const list = document.getElementById('hold-list'); const sum = document.getElementById('hold-sum'); const empty = document.getElementById('hold-empty'); const go = document.getElementById('hold-go'); const msg = document.getElementById('hold-msg');
const yen = (n) => `${n.toLocaleString('ja-JP')}円`;
function drawCart() {
  list.replaceChildren(); let total = 0;
  for (const [name, it] of cart) {
    total += it.price * it.n;
    const li = document.createElement('li'); const nm = document.createElement('span'); nm.textContent = name;
    const mk = (t, label, d) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'q'; b.textContent = t; b.setAttribute('aria-label', `${name}を${label}`); b.addEventListener('click', () => { it.n += d; if (it.n <= 0) cart.delete(name); drawCart(); }); return b; };
    const n = document.createElement('span'); n.className = 'n'; n.textContent = String(it.n);
    const s = document.createElement('span'); s.className = 's'; s.textContent = yen(it.price * it.n);
    li.append(nm, mk('−', '1つ減らす', -1), n, mk('＋', '1つ増やす', 1), s); list.append(li);
  }
  empty.hidden = cart.size > 0; sum.textContent = yen(total); go.disabled = cart.size === 0; msg.textContent = '';
}
items.forEach((li) => {
  const name = li.querySelector('b').textContent; const price = Number(li.querySelector('.p').textContent.replace(/[^0-9]/g, ''));
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true'); svg.innerHTML = ICONS[pick(name)];
  li.prepend(svg);
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add'; add.textContent = '＋'; add.setAttribute('aria-label', `${name}を取り置きに入れる`);
  add.addEventListener('click', () => { const it = cart.get(name) ?? { price, n: 0 }; it.n += 1; cart.set(name, it); drawCart(); li.classList.remove('pop'); void li.offsetWidth; li.classList.add('pop'); });
  li.append(add);
});
const sel = document.getElementById('hold-time');
for (let h = 8; h < (d === 0 ? 14 : d === 6 ? 18 : 17); h += 1) for (const m of ['00', '30']) { const o = document.createElement('option'); o.textContent = `${h}:${m}`; sel.append(o); }
go.addEventListener('click', () => { msg.textContent = `${sel.value}の受取で、${cart.size}種類・${sum.textContent}の取り置きを承りました（見本のため、実際には送信されません）。`; });
drawCart();
