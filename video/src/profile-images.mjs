// SNS・Googleビジネスプロフィールに登録する画像をつくる。名前・URL・添え書きは brand.json から読む。
// 出力：out/profile/
//   icon.png（1080×1080・青緑の地に白のNマーク）、icon-light.png（明るい地）
//   gbp-cover.png（1920×1080・Googleビジネスプロフィールのカバー）
//   x-header.png（1500×500・X のヘッダー。左下はプロフィール画像で隠れるので、文字は右に寄せる）
//   highlight-1〜5-*.png（1080×1920・Instagram のハイライトの表紙。丸く切り取られる中央に絵を置く）
import { chromium } from './pw.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const out = path.join(root, 'out', 'profile');
mkdirSync(out, { recursive: true });

const brand = JSON.parse(readFileSync(path.join(root, 'brand.json'), 'utf8'));
const wm = brand.wordmark ? 'data:image/png;base64,' + readFileSync(path.resolve(root, brand.wordmark)).toString('base64') : null;
const japan = JSON.parse(readFileSync(path.join(root, 'assets', 'japan.json'), 'utf8'));
const font = pathToFileURL(path.join(root, 'node_modules', '@fontsource', 'biz-udpgothic', 'files')).href;
// サイトのファビコンと同じ N マーク（public/favicon.svg）
const N_PATH = 'M725 562H968L1198 1179L1449 466L1735 284L1326 1497H1073L848 867L613 1523L321 1709Z';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const BASE = `
@font-face { font-family: B; src: url(${font}/biz-udpgothic-japanese-400-normal.woff2); font-weight: 400; }
@font-face { font-family: B; src: url(${font}/biz-udpgothic-japanese-700-normal.woff2); font-weight: 700; }
@font-face { font-family: B; src: url(${font}/biz-udpgothic-latin-400-normal.woff2); font-weight: 400; unicode-range: U+0000-00FF, U+2000-206F; }
@font-face { font-family: B; src: url(${font}/biz-udpgothic-latin-700-normal.woff2); font-weight: 700; unicode-range: U+0000-00FF, U+2000-206F; }
:root { --paper: #E9EEED; --ink: #1B2428; --ink-2: #44525A; --accent: #1A6D73; --accent-soft: #DCF0F0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; }
body { font-family: B, sans-serif; color: var(--ink); font-feature-settings: "palt" 1; -webkit-font-smoothing: antialiased; position: relative; }
.dots { position: absolute; inset: 0; background-image: radial-gradient(rgba(27,36,40,.12) 2.4px, transparent 2.8px); background-size: 46px 46px; }
.wm { background: var(--ink); -webkit-mask: url("${wm}") left center / contain no-repeat; mask: url("${wm}") left center / contain no-repeat; }
.jp path { fill: #C6D4D3; stroke: #fff; stroke-width: 1.4; vector-effect: non-scaling-stroke; }
.jp path.home { fill: var(--accent); }
.ring { position: absolute; border-radius: 50%; border: 5px solid var(--accent); }
.em { color: var(--accent); }
`;

function mapSvg(cls, style) {
  return `<svg class="jp ${cls}" style="${style}" viewBox="${japan.viewBox}">${japan.prefs.map((p) => `<path class="${p.name === 'Yamagata' ? 'home' : ''}" d="${p.d}"/>`).join('')}</svg>`;
}
// 地図の上の山形の位置に輪を重ねる（地図の左上・高さを渡す）
function rings(left, top, height, sizes) {
  const [, , vw, vh] = japan.viewBox.split(' ').map(Number);
  const s = height / vh; const x = left + japan.yamagata[0] * s; const y = top + japan.yamagata[1] * s;
  return sizes.map(([w, o]) => `<div class="ring" style="left:${x - w / 2}px;top:${y - w / 2}px;width:${w}px;height:${w}px;opacity:${o}"></div>`).join('');
}

const PAGES = [
  {
    file: 'icon.png', w: 1080, h: 1080,
    html: `<body style="background:#1A6D73"><svg viewBox="128 96 1800 1800" style="position:absolute;left:250px;top:250px;width:580px;height:580px"><path d="${N_PATH}" fill="#fff"/></svg></body>`,
  },
  {
    file: 'icon-light.png', w: 1080, h: 1080,
    html: `<body style="background:#E9EEED"><svg viewBox="128 96 1800 1800" style="position:absolute;left:250px;top:250px;width:580px;height:580px"><path d="${N_PATH}" fill="#1B2428"/></svg></body>`,
  },
  {
    file: 'gbp-cover.png', w: 1920, h: 1080,
    html: `<body style="background:var(--paper)"><div class="dots"></div>
      ${mapSvg('', 'position:absolute;left:1080px;top:110px;height:860px')}
      ${rings(1080, 110, 860, [[160, 0.6], [330, 0.35], [540, 0.18]])}
      <div style="position:absolute;left:140px;top:250px">
        <p style="font-size:104px;font-weight:700;line-height:1.3">事務の手間を、<br><span class="em">ITで</span>減らすお手伝い</p>
        <p style="font-size:52px;font-weight:700;color:var(--accent);margin-top:40px">山形を中心に、全国の企業をご支援</p>
        ${wm ? '<div class="wm" style="width:560px;height:92px;margin-top:56px"></div>' : `<p style="font-size:64px;font-weight:700;margin-top:56px">${esc(brand.name)}</p>`}
      </div></body>`,
  },
  {
    file: 'x-header.png', w: 1500, h: 500,
    html: `<body style="background:var(--paper)"><div class="dots"></div>
      ${mapSvg('', 'position:absolute;left:330px;top:40px;height:420px;opacity:.9')}
      ${rings(330, 40, 420, [[90, 0.6], [180, 0.35], [290, 0.18]])}
      <div style="position:absolute;right:90px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-end;text-align:right">
        ${wm ? '<div class="wm" style="width:520px;height:86px;-webkit-mask-position:right center;mask-position:right center"></div>' : `<p style="font-size:60px;font-weight:700">${esc(brand.name)}</p>`}
        <p style="font-size:38px;color:var(--ink-2);margin-top:22px">${esc(brand.tagline)}</p>
        <p style="font-size:40px;font-weight:700;color:var(--accent);margin-top:18px">山形を中心に、全国の企業の業務改善を支援</p>
      </div></body>`,
  },
];

// ハイライトの表紙：青緑の地に白い線の絵（中央の丸に収まる大きさ）
const HL = [
  ['highlight-1-features.png', '<rect x="14" y="12" width="20" height="26" rx="2"/><path d="M18 19h12M18 25h12M18 31h7"/><path d="M38 25h8M42 21l4 4-4 4"/><rect x="50" y="14" width="0.01" height="0.01"/><path d="M50 16h0"/>', 'できること'],
  ['highlight-2-steps.png', '<circle cx="14" cy="32" r="6"/><circle cx="32" cy="32" r="6"/><circle cx="50" cy="32" r="6"/><path d="M20 32h6M38 32h6"/>', '進め方'],
  ['highlight-3-price.png', '<path d="M22 16l10 14 10-14M32 30v18M23 34h18M23 41h18"/>', '料金'],
  ['highlight-4-about.png', '<circle cx="32" cy="24" r="9"/><path d="M15 50c3-9 9-13 17-13s14 4 17 13"/>', '代表'],
  ['highlight-5-faq.png', '<path d="M12 14h40v26H30l-10 8v-8h-8z"/><path d="M27 23a5 5 0 1 1 7 4.5c-1.4.6-2 1.5-2 3"/><path d="M32 35v0.1"/>', 'よくある質問'],
];
// できることの絵は、資料 → 表 の形にする
HL[0][1] = '<path d="M10 14h16l6 6v26H10z M26 14v6h6 M15 27h12 M15 33h12 M15 39h8"/><path d="M36 30h6M39 27l3 3-3 3"/><rect x="45" y="18" width="12" height="28" rx="1.5"/><path d="M45 25h12M45 32h12M45 39h12"/>';
for (const [file, svg] of HL) {
  PAGES.push({
    file, w: 1080, h: 1920,
    html: `<body style="background:#1A6D73"><svg viewBox="0 0 64 64" style="position:absolute;left:290px;top:710px;width:500px;height:500px;fill:none;stroke:#fff;stroke-width:3.4;stroke-linecap:round;stroke-linejoin:round">${svg}</svg></body>`,
  });
}

const browser = await chromium.launch();
try {
  for (const p of PAGES) {
    const page = await browser.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
    // 空のページからは手元の書体ファイルを読めないため、一時ファイルに書いて file:// で開く
    const tmp = path.join(os.tmpdir(), `nodus-profile-${p.file}.html`);
    writeFileSync(tmp, `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${BASE}</style></head>${p.html}</html>`);
    await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => document.fonts.check('700 40px B', 'あ'));
    if (!loaded && /<p[ >]/.test(p.html)) throw new Error('書体を読み込めませんでした：' + p.file);
    await page.screenshot({ path: path.join(out, p.file) });
    await page.close();
    console.log('->', p.file);
  }
} finally { await browser.close(); }
