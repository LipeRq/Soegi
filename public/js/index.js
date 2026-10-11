import { api, getPass, setPass, ApiError } from './common.js';
import { reduced, shake, spotlight } from './motion.js';
import { startLive } from './index-live.js';

const gate = document.getElementById('gate');
const err = document.getElementById('gate-err');
const pass = document.getElementById('pass');
const logout = document.getElementById('logout');

// タイルはパスワードの前から見せる（動きの見本）。パスワードが要るデモを押したときだけ、入力欄を出す
let authed = false;
let pending = null; // パスワードの前に押されたタイルの行き先

function show(ok) {
  authed = ok;
  if (ok) gate.hidden = true;
  logout.hidden = !ok;
  document.body.classList.toggle('authed', ok);
}

async function check(value) {
  await api('/api/verify', {}, value);
  setPass(value);
  show(true);
}

document.getElementById('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    await check(pass.value);
    if (pending) location.href = pending;
  } catch (ex) {
    err.textContent = ex instanceof ApiError ? ex.message : '確認できませんでした';
    shake(gate);
  } finally { if (btn) btn.disabled = false; }
});

document.querySelectorAll('a[data-lock]').forEach((a) => a.addEventListener('click', (e) => {
  if (authed) return;
  e.preventDefault();
  pending = a.getAttribute('href');
  gate.hidden = false;
  err.textContent = 'パスワードを入れると、このデモを開けます';
  gate.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  pass.focus({ preventScroll: true });
  shake(gate);
}));

logout.addEventListener('click', () => { setPass(''); pending = null; show(false); });

// すでに入力済みなら、そのまま確認して進む
if (getPass()) check(getPass()).catch(() => show(false));

spotlight('.tile');
startLive();
