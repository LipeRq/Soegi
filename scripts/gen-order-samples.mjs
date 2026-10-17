// 受注デモの見本の注文書（架空）を、画像にして作る。中身は public/samples/orders/samples.json。
//   node scripts/gen-order-samples.mjs
// - 印字2枚：取引先ごとに違う様式。FAX らしく灰色・ざらつき・少しの傾き
// - 手書き風1枚：手書き風の書体（Zen Kurenaido、SIL OFL 1.1）で1文字ずつ少し揺らす。本物の手書きではない
// 作るときだけ Playwright（同じ環境の Chromium）を使う。画面では使わない。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/node-tools/node_modules/')('playwright')); }

const root = new URL('..', import.meta.url);
const outDir = new URL('public/samples/orders/', root);
const data = JSON.parse(readFileSync(new URL('samples.json', outDir), 'utf8'));
const fontCss = fileURLToPath(new URL('node_modules/@fontsource/zen-kurenaido/index.css', root));
const tmp = fileURLToPath(new URL('.order-samples-tmp/', root));
mkdirSync(tmp, { recursive: true });

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const yen = (n) => (n == null ? '' : Number(n).toLocaleString('ja-JP'));

// 毎回同じ揺れになるよう、文字の位置から決める（乱数を使わない）
const wobble = (text, seed) => [...String(text)].map((ch, i) => {
  const k = (seed * 31 + i * 17) % 11;
  const rot = (k - 5) * 0.9; const dy = ((k * 7) % 5) - 2;
  return `<span style="display:inline-block;transform:translateY(${dy}px) rotate(${rot}deg)">${esc(ch)}</span>`;
}).join('');

const FAX = `
  body { margin: 0; background: #fff; }
  .page { width: 1240px; height: 1754px; box-sizing: border-box; padding: 90px 100px; position: relative; color: #111; background: #fff; transform: rotate(-0.6deg); transform-origin: 50% 50%; }
  .noise { position: absolute; inset: 0; pointer-events: none; opacity: .22; mix-blend-mode: multiply; }
  .faxhead { position: absolute; top: 24px; left: 60px; right: 60px; font: 22px monospace; color: #333; display: flex; justify-content: space-between; }
  .shot { filter: grayscale(1) contrast(1.15) blur(.35px); }
`;
const NOISE = `<svg class="noise" xmlns="http://www.w3.org/2000/svg" width="1240" height="1754"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.4"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

function yamabiko(s) {
  const rows = s.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${esc(l.spec)}</td><td class="r">${l.qty}</td><td class="c">${esc(l.unit)}</td><td></td></tr>`).join('');
  const empty = Array.from({ length: 8 - s.lines.length }, (_, i) => `<tr><td class="c">${s.lines.length + i + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><style>${FAX}
    .page { font-family: "IPAGothic", sans-serif; font-size: 30px; }
    h1 { text-align: center; font-size: 64px; letter-spacing: .5em; margin: 40px 0 30px; border-bottom: 4px double #111; padding-bottom: 10px; }
    .meta { display: flex; justify-content: space-between; margin: 20px 0; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; margin-top: 30px; }
    th, td { border: 2px solid #111; padding: 14px 12px; height: 46px; }
    th { background: #ddd; } .c { text-align: center; } .r { text-align: right; }
    .box { border: 2px solid #111; padding: 18px; margin-top: 30px; min-height: 120px; }
  </style><div class="shot"><div class="page">
    <div class="faxhead"><span>2027/01/12 09:41</span><span>FAX 023-000-0000（架空）</span><span>P.1/1</span></div>
    <h1>発 注 書</h1>
    <div class="meta"><div>さくらんぼ食品（仮）　御中<br>下記のとおり発注いたします。</div><div>発注日：${esc(s.order_date)}<br>${esc(s.from)}<br>担当：青葉（架空）</div></div>
    <div class="meta"><div><b>納品希望日：${esc(s.delivery_date)}</b></div><div>納品先：本部センター</div></div>
    <table><tr><th style="width:60px">No</th><th>品名</th><th style="width:150px">規格</th><th style="width:130px">数量</th><th style="width:120px">単位</th><th style="width:170px">備考</th></tr>${rows}${empty}</table>
    <div class="box">備考：${esc(s.note)}</div>
    ${NOISE}</div></div>`;
}

function gassan(s) {
  const rows = s.lines.map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.name)}${l.spec ? ` ${esc(l.spec)}` : ''}</td><td class="r">${l.qty}${esc(l.unit)}</td><td class="r">${yen(l.unit_price)}</td><td class="r">${yen(l.amount)}</td></tr>`).join('');
  const total = s.lines.reduce((t, l) => t + (l.amount || 0), 0);
  return `<!doctype html><meta charset="utf-8"><style>${FAX}
    .page { font-family: "IPAPGothic", sans-serif; font-size: 28px; }
    .top { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; border: 3px solid #111; padding: 24px; margin-top: 40px; }
    .top h1 { grid-column: 1 / -1; margin: 0 0 10px; font-size: 52px; }
    table { width: 100%; border-collapse: collapse; margin-top: 40px; }
    th, td { border-bottom: 2px solid #111; padding: 16px 10px; } th { text-align: left; border-top: 3px solid #111; }
    .r { text-align: right; } tfoot td { border-top: 3px double #111; font-weight: bold; }
    .note { margin-top: 40px; padding: 16px; border-left: 8px solid #555; }
  </style><div class="shot"><div class="page">
    <div class="faxhead"><span>27-01-13 14:05</span><span>月山ストア（仮）</span><span>1</span></div>
    <div class="top"><h1>注文書 No.0113-07</h1>
      <div>宛先：さくらんぼ食品（仮）様<br>注文日 ${esc(s.order_date)}</div>
      <div>${esc(s.from)}<br>納品指定日 <b>${esc(s.delivery_date)}</b></div></div>
    <table><thead><tr><th style="width:150px">品番</th><th>商品名</th><th class="r" style="width:150px">数量</th><th class="r" style="width:150px">単価</th><th class="r" style="width:170px">金額</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td></td><td>合計</td><td></td><td></td><td class="r">${yen(total)}</td></tr></tfoot></table>
    <div class="note">連絡：${esc(s.note)}</div>
    ${NOISE}</div></div>`;
}

function eki(s) {
  const hw = (t, k) => `<span class="hw">${wobble(t, k)}</span>`;
  const rows = s.lines.map((l, i) => `<tr><td>${hw(l.name, i + 3)}</td><td class="r">${hw(`${l.qty}${l.unit ?? ''}`, i + 9)}</td></tr>`).join('');
  const empty = Array.from({ length: 7 - s.lines.length }, () => '<tr><td></td><td></td></tr>').join('');
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${fontCss}"><style>${FAX}
    .page { font-family: "IPAGothic", sans-serif; font-size: 26px; }
    .hw { font-family: "Zen Kurenaido", cursive; font-size: 44px; color: #1a1a40; }
    h1 { font-size: 46px; margin: 50px 0 20px; }
    .lines { line-height: 2.4; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1.5px solid #333; padding: 6px 14px; height: 78px; } th { font-size: 26px; background: #eee; }
    .r { text-align: right; width: 260px; }
  </style><div class="shot"><div class="page">
    <div class="faxhead"><span>01/14 16:22</span><span>ミチノエキ（架空）</span><span>P01</span></div>
    <h1>注文用紙（FAX）　さくらんぼ食品（仮）行</h1>
    <div class="lines">
      <div>日付：${hw(s.order_date, 1)}　　　お店の名前：${hw(s.customer, 2)}</div>
      <div>納品してほしい日：<span style="display:inline-block;width:380px;border-bottom:2px solid #333">&nbsp;</span></div>
    </div>
    <table><tr><th>しなもの</th><th class="r">かず</th></tr>${rows}${empty}</table>
    <div class="lines" style="margin-top:24px">れんらく：${hw(s.note, 20)}</div>
    ${NOISE}</div></div>`;
}

const LAYOUTS = { yamabiko, gassan, eki };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
for (const s of data.samples) {
  const path = `${tmp}${s.id}.html`;
  writeFileSync(path, LAYOUTS[s.id](s));
  await page.goto(`file://${path}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL(s.file, outDir)), type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: 1240, height: 1754 } });
  console.log('ok', s.file);
}
await browser.close();
