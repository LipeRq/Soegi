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
