// 労務デモの見本のタイムカード（架空・2026年9月）を、画像にして作る。中身は public/samples/timecards/samples.json。
//   node scripts/gen-timecard-samples.mjs
// - 打刻カード2枚：タイムレコーダーの印字（紫のインク、遅い退勤は赤）。机の上で撮った写真のように、少し傾ける
//   鈴木さんの1枚には、手書きの修正（8日の出勤）・二重打刻（15日の退勤）・外出と戻り（10日）・打刻忘れの手書き（25日の退勤）
// - 手書きの出勤簿1枚：手書き風の書体（Zen Kurenaido、SIL OFL 1.1）で1文字ずつ少し揺らす。本物の手書きではない
// 作るときだけ Playwright（同じ環境の Chromium）を使う。画面では使わない。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/node-tools/node_modules/')('playwright')); }

const root = new URL('..', import.meta.url);
const outDir = new URL('public/samples/timecards/', root);
const data = JSON.parse(readFileSync(new URL('samples.json', outDir), 'utf8'));
const fontCss = fileURLToPath(new URL('node_modules/@fontsource/zen-kurenaido/index.css', root));
const tmp = fileURLToPath(new URL('.timecard-samples-tmp/', root));
mkdirSync(tmp, { recursive: true });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const dow = (day) => WEEK[new Date(Date.UTC(2026, 8, day)).getUTCDay()];
const dayOf = (iso) => Number(iso.slice(8, 10));
const shortTime = (t) => (t ? t.replace(/^0/, '') : ''); // 08:21 → 8:21（タイムレコーダーの印字）

// 毎回同じ揺れになるよう、文字の位置から決める（乱数を使わない）
const wobble = (text, seed) => [...String(text)].map((ch, i) => {
  const k = (seed * 31 + i * 17) % 11;
  const rot = (k - 5) * 1.1; const dy = ((k * 7) % 5) - 2;
  return `<span style="display:inline-block;transform:translateY(${dy}px) rotate(${rot}deg)">${esc(ch)}</span>`;
}).join('');
const hw = (t, k, cls = 'hw') => `<span class="${cls}">${wobble(t, k)}</span>`;

const DESK = `
  body { margin: 0; }
  .desk { width: 1240px; height: 1754px; position: relative; overflow: hidden;
    background: radial-gradient(circle at 30% 20%, #d9d2c4, #b9b0a0 70%, #a39a8a); }
  .card { position: absolute; left: 290px; top: 40px; width: 640px; height: 1660px; box-sizing: border-box; padding: 28px 30px;
    background: #f5efdc; border-radius: 6px; box-shadow: 0 18px 30px rgba(40, 30, 20, .35), 0 2px 4px rgba(0,0,0,.2);
    transform: rotate(-1.4deg); font-family: "IPAGothic", sans-serif; color: #2a2a2a; }
  .card::after { content: ""; position: absolute; inset: 0; border-radius: 6px; pointer-events: none;
    background: linear-gradient(115deg, rgba(255,255,255,.18), rgba(255,255,255,0) 40%, rgba(0,0,0,.05)); }
  .ttl { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #b3242b; padding-bottom: 6px; }
  .ttl b { font-size: 34px; letter-spacing: .3em; color: #b3242b; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin: 10px 0 12px; font-size: 21px; }
  .meta span { border-bottom: 1.5px solid #8a7f68; padding: 2px 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 18px; }
  th { background: #e6dcc2; font-weight: 400; border: 1.5px solid #8a7f68; padding: 3px; }
  td { border: 1.5px solid #8a7f68; height: 43px; padding: 0 6px; text-align: center; position: relative; }
  td.d { width: 46px; font-size: 18px; } td.w { width: 36px; font-size: 16px; color: #666; }
  td.w.sun { color: #b3242b; } td.w.sat { color: #2b55b3; }
  .st { font-family: "IPAGothic", monospace; font-size: 25px; letter-spacing: .06em; color: #4b2c6b; filter: blur(.35px); opacity: .9; }
  .st.red { color: #c2262e; }
  /* 二重打刻：同じ欄に2つの時刻（少しずらして重なる） */
  .st.a, .st.b { position: absolute; font-size: 20px; } .st.a { left: 6px; top: 0; } .st.b { left: 46px; top: 19px; }
  /* 手書きの修正：打刻を線で消し（左上・小さく）、右下に手書きの時刻、右上に訂正の印 */
  .st.old { position: absolute; left: 6px; top: 1px; font-size: 18px; }
  .fix8 { position: absolute; right: 26px; bottom: -4px; } .fix8 .hw { font-size: 27px; }
  .seal.s8 { top: 2px; bottom: auto; width: 18px; height: 18px; line-height: 16px; font-size: 10px; }
  .strike { position: relative; display: inline-block; }
  .strike::after { content: ""; position: absolute; left: -6px; right: -6px; top: 52%; height: 2.5px; background: #1d3f8f; transform: rotate(-8deg); }
  .hw { font-family: "Zen Kurenaido", cursive; font-size: 30px; color: #1d3f8f; }
  .fix { position: absolute; right: 4px; top: 1px; }
  .seal { position: absolute; right: 4px; bottom: 2px; width: 22px; height: 22px; border: 2px solid #c2262e; border-radius: 50%; color: #c2262e; font-size: 12px; line-height: 20px; }
`;

function punchCard(s) {
  const byDay = new Map(s.entries.map((e) => [dayOf(e.date), e]));
  const rows = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1; const w = dow(day); const e = byDay.get(day);
    const cls = w === '日' ? 'sun' : w === '土' ? 'sat' : '';
    const stamp = (t, late) => (t ? `<span class="st${late ? ' red' : ''}">${esc(shortTime(t))}</span>` : '');
    let start = ''; let out = ''; let back = ''; let end = '';
    if (e) {
      start = stamp(e.start, e.start > '09:00'); out = stamp(e.out); back = stamp(e.back); end = stamp(e.end, e.end > '18:30');
      if (s.id === 'suzuki' && day === 8) start = `<span class="st red strike old">10:02</span><span class="fix8">${hw('8:30', day)}</span><span class="seal s8">鈴</span>`;
      if (s.id === 'suzuki' && day === 15) end = `<span class="st a">17:32</span><span class="st b red">21:48</span>`;
      if (s.id === 'suzuki' && day === 25) end = `<span class="fix" style="right:30px">${hw('20:15', day)}</span><span class="seal">鈴</span>`;
    }
    return `<tr><td class="d">${day}</td><td class="w ${cls}">${w}</td><td>${start}</td><td>${out}</td><td>${back}</td><td>${end}</td></tr>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${fontCss}"><style>${DESK}</style>
    <div class="desk"><div class="card">
      <div class="ttl"><b>タイムカード</b><span style="font-size:22px">2026年 9月分　No.${s.id === 'suzuki' ? '12' : '07'}</span></div>
      <div class="meta"><span>所属：製造課</span><span>さくらんぼ食品（仮）</span><span style="grid-column:1/-1">氏名：${esc(s.employee_name)}</span></div>
      <table><tr><th>日</th><th>曜</th><th>出勤</th><th>外出</th><th>戻り</th><th>退勤</th></tr>${rows}</table>
    </div></div>`;
}

function handbook(s) {
  const byDay = new Map(s.entries.map((e) => [dayOf(e.date), e]));
  const rows = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1; const w = dow(day); const e = byDay.get(day);
    if (!e) return `<tr><td>${day}</td><td>${w}</td><td></td><td></td><td></td><td>${w === '土' || w === '日' ? hw('休', day + 40) : ''}</td></tr>`;
    const night = e.end < e.start;
    const endText = day === 17 ? `<span class="smudge">${hw(shortTime(e.end), day + 3)}</span>` : hw(shortTime(e.end), day + 3);
    return `<tr><td>${day}</td><td>${w}</td><td>${hw(shortTime(e.start), day)}</td><td>${endText}</td><td>${hw(String(e.break_min ?? ''), day + 7)}</td><td>${night ? hw('夜勤（翌朝まで）', day + 11) : ''}</td></tr>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${fontCss}"><style>
    body { margin: 0; background: #fff; }
    .page { width: 1240px; height: 1754px; box-sizing: border-box; padding: 70px 90px; font-family: "IPAGothic", sans-serif; color: #222;
      background: #fdfdfb; transform: rotate(0.5deg); }
    h1 { font-size: 46px; letter-spacing: .4em; text-align: center; margin: 10px 0 20px; }
    .meta { display: flex; justify-content: space-between; font-size: 26px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 22px; }
    th { border: 2px solid #333; background: #f0f0f0; padding: 6px; font-weight: 400; }
    td { border: 1.5px solid #555; height: 43px; text-align: center; padding: 0 6px; }
    td:nth-child(1), td:nth-child(2) { width: 56px; }
    .hw { font-family: "Zen Kurenaido", cursive; font-size: 32px; color: #1a1a40; }
    .smudge { display: inline-block; filter: blur(1.6px); position: relative; }
    .smudge::after { content: ""; position: absolute; left: 30%; top: 10%; width: 46px; height: 30px; border-radius: 50%; background: rgba(40, 40, 90, .25); filter: blur(4px); }
    .sign { margin-top: 18px; font-size: 24px; text-align: right; }
  </style><div class="page">
    <h1>出勤簿</h1>
    <div class="meta"><span>2026年 9月分</span><span>グループホームさくら（架空）</span><span>氏名：${hw(s.employee_name.replace(/（架空）$/, ''), 2)}（架空）</span></div>
    <table><tr><th>日</th><th>曜</th><th>出勤</th><th>退勤</th><th>休憩（分）</th><th>備考</th></tr>${rows}</table>
    <div class="sign">確認印　管理者 ________</div>
  </div>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
for (const s of data.samples) {
  const path = `${tmp}${s.id}.html`;
  writeFileSync(path, s.id === 'tanaka' ? handbook(s) : punchCard(s));
  await page.goto(`file://${path}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL(s.file, outDir)), type: 'jpeg', quality: 74, clip: { x: 0, y: 0, width: 1240, height: 1754 } });
  console.log('ok', s.file);
}
await browser.close();
