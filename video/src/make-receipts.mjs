// 撮影用の架空のレシート画像をつくる（店・品物・番号はすべて架空）。
// 出力：assets/receipts/r1.jpg〜r4.jpg（机の上で撮った写真のように、少し傾けて影を付ける）
import { chromium } from './pw.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'assets', 'receipts');
mkdirSync(out, { recursive: true });
const font = path.join(here, '..', 'node_modules', '@fontsource', 'biz-udpgothic', 'files');

// 登録番号は実在しない「T0000000000001」の形にする。4枚目は登録番号なし（要確認の色が出る）
const receipts = [
  { shop: 'さくら文具店', date: '2026年11月4日', no: 'T0000000000001', items: [['コピー用紙 A4 500枚', 990], ['ボールペン 黒 3本', 660], ['クリアファイル 10枚', 330]], rate10: true, rot: -2.2 },
  { shop: 'みどり食堂', date: '2026年11月6日', no: 'T0000000000002', items: [['日替わり定食', 880], ['日替わり定食', 880]], rate10: true, rot: 1.6 },
  { shop: 'あおぞらガソリンスタンド', date: '2026年11月9日', no: 'T0000000000003', items: [['レギュラー 40.00L @155', 6200]], rate10: true, rot: -1.2 },
  { shop: '山の駅 売店', date: '2026年11月12日', no: null, items: [['お茶 500ml ※', 150], ['おにぎり 2個 ※', 360], ['フェイスタオル', 690]], mixed: true, rot: 2.4 },
];

const yen = (n) => '¥' + n.toLocaleString('ja-JP');

function html(r) {
  const total = r.items.reduce((s, [, v]) => s + v, 0);
  let taxRows;
  if (r.mixed) {
    const t8 = r.items.filter(([n]) => n.includes('※')).reduce((s, [, v]) => s + v, 0);
    const t10 = total - t8;
    taxRows = `<tr><td>8%対象</td><td>${yen(t8)}</td></tr><tr><td>（内消費税</td><td>${yen(Math.floor(t8 * 8 / 108))}）</td></tr>
      <tr><td>10%対象</td><td>${yen(t10)}</td></tr><tr><td>（内消費税</td><td>${yen(Math.floor(t10 * 10 / 110))}）</td></tr>
      <tr><td colspan="2" class="note">※は軽減税率（8%）対象</td></tr>`;
  } else {
    taxRows = `<tr><td>10%対象</td><td>${yen(total)}</td></tr><tr><td>（内消費税</td><td>${yen(Math.floor(total * 10 / 110))}）</td></tr>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: BIZ; src: url(file://${font}/biz-udpgothic-japanese-400-normal.woff2); font-weight: 400; }
  @font-face { font-family: BIZ; src: url(file://${font}/biz-udpgothic-japanese-700-normal.woff2); font-weight: 700; }
  @font-face { font-family: BIZ; src: url(file://${font}/biz-udpgothic-latin-400-normal.woff2); font-weight: 400; unicode-range: U+0000-00FF, U+2000-206F, U+20AC; }
  @font-face { font-family: BIZ; src: url(file://${font}/biz-udpgothic-latin-700-normal.woff2); font-weight: 700; unicode-range: U+0000-00FF, U+2000-206F, U+20AC; }
  html, body { margin: 0; width: 560px; height: 760px; overflow: hidden; }
  body { background: radial-gradient(ellipse at 40% 35%, #d9d3c7 0%, #b9b1a2 70%, #a69d8c 100%); display: grid; place-items: center; font-family: BIZ, sans-serif; color: #2a2a2a; }
  .r { width: 330px; background: #fbfaf6; padding: 26px 26px 34px; transform: rotate(${r.rot}deg); box-shadow: 0 2px 3px rgba(0,0,0,.18), 0 18px 30px -10px rgba(0,0,0,.35); font-size: 15px; line-height: 1.55; }
  h1 { font-size: 22px; text-align: center; margin: 0 0 4px; letter-spacing: .08em; }
  .c { text-align: center; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: baseline; padding: 1px 0; }
  td:last-child { text-align: right; white-space: nowrap; }
  .hr { border-top: 1px dashed #777; margin: 10px 0; }
  .tot td { font-size: 21px; font-weight: 700; padding-top: 4px; }
  .note { font-size: 12px; text-align: left !important; }
  </style></head><body><div class="r">
  <h1>${r.shop}</h1>
  <p class="c">山形県 ／ TEL 023-000-0000</p>
  <p class="c">${r.date}　領収書</p>
  <div class="hr"></div>
  <table>${r.items.map(([n, v]) => `<tr><td>${n}</td><td>${yen(v)}</td></tr>`).join('')}</table>
  <div class="hr"></div>
  <table><tr class="tot"><td>合計</td><td>${yen(total)}</td></tr>${taxRows}</table>
  <div class="hr"></div>
  <p class="c">${r.no ? '登録番号 ' + r.no : 'ありがとうございました'}</p>
  </div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 560, height: 760 }, deviceScaleFactor: 2 });
for (const [i, r] of receipts.entries()) {
  await page.setContent(html(r), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(out, `r${i + 1}.jpg`), type: 'jpeg', quality: 88 });
}
await browser.close();
console.log('receipts ->', out);
