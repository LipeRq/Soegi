import { api, getPass, setPass, ApiError } from './common.js';

const gate = document.getElementById('gate');
const menu = document.getElementById('menu');
const err = document.getElementById('gate-err');

function show(authed) {
  gate.hidden = authed;
  menu.hidden = !authed;
}

async function check(pass) {
  await api('/api/verify', {}, pass);
  setPass(pass);
  show(true);
}

document.getElementById('gate-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  const btn = e.submitter; if (btn) btn.disabled = true;
  try {
    await check(document.getElementById('pass').value);
  } catch (ex) {
    err.textContent = ex instanceof ApiError ? ex.message : '確認できませんでした';
  } finally { if (btn) btn.disabled = false; }
});

document.getElementById('logout').addEventListener('click', () => { setPass(''); show(false); });

// すでに入力済みなら、そのまま確認して進む
if (getPass()) check(getPass()).catch(() => show(false));
