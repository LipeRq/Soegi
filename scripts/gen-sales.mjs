// 月次レポートの見本の売上CSV（架空・さくらんぼ食品（仮）、2024年10月〜2026年9月の24か月）を作る。毎回まったく同じ内容。
//   node scripts/gen-sales.mjs → public/samples/monthly/sales-sample.csv（UTF-8 BOM付き。列：日付,顧客,商品,数量,金額）
// 季節の波：ジャム・ギフトは11〜12月、さくらんぼは6〜7月、りんごジュースは秋に山。
// わざと入れた動き（台本と単体テストで見る）：
//   落ちた取引先：月山ストア（仮）…2026年1月から減り、2026年4月からは注文なし
//   伸びた取引先：温泉旅館みずき（仮）…2025年4月から取引が始まり、その後も増える
//   伸びた商品：ドライフルーツミックス（2026年は前年の約1.9倍）
//   落ちた商品：ブルーベリージャム（2026年は前年の約4割）
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const master = JSON.parse(readFileSync(new URL('../public/data/products.json', import.meta.url), 'utf8'));

// 毎回同じ乱数（mulberry32）
const rng = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = rng(20261023);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const months = [];
for (let i = 0; i < 24; i += 1) { const d = new Date(Date.UTC(2024, 9 + i, 1)); months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, i }); }
const idx = (y, m) => (y - 2024) * 12 + (m - 10); // 2024年10月 = 0

// 顧客ごとの、1か月の注文の件数の目安（かけ算の係数）
const CUSTOMERS = {
  'やまびこスーパー（仮）': (mo) => 1.0,
  '月山ストア（仮）': (mo) => { const k = idx(mo.y, mo.m); if (k >= idx(2026, 4)) return 0; if (k >= idx(2026, 1)) return 0.4 - 0.1 * (k - idx(2026, 1)); return 0.8; },
  '道の駅さくらんぼの里（仮）': (mo) => ([5, 6, 7, 8, 9, 10].includes(mo.m) ? 1.1 : 0.45),
  '温泉旅館みずき（仮）': (mo) => { const k = idx(mo.y, mo.m); return k < idx(2025, 4) ? 0 : 0.35 + 0.05 * (k - idx(2025, 4)); },
  'カフェ森のテラス（仮）': (mo) => 0.3,
};

// 商品ごとの重み（月ごとの季節・年ごとの伸び縮み）
const season = (mo) => ({ gift: [11, 12].includes(mo.m) ? 3.2 : mo.m === 10 ? 1.4 : 0.5, cherry: [6, 7].includes(mo.m) ? 3 : [5, 8].includes(mo.m) ? 1.5 : 0.7, juice: [9, 10, 11].includes(mo.m) ? 2.2 : 0.9 });
const weight = (p, mo) => {
  const s = season(mo); const k = idx(mo.y, mo.m);
  let w = 1;
  if (/^G-/.test(p.code)) w = s.gift;
  else if (/さくらんぼ/.test(p.name)) w = s.cherry;
  else if (p.code === 'S-102') w = s.juice;
  else if (p.code === 'D-201') w = k >= idx(2026, 1) ? 1.9 : 1;
  else if (p.code === 'J-104') w = k >= idx(2026, 1) ? 0.4 : 1;
  else if (/^J-3/.test(p.code)) w = 0.4;
  else if (/^S-10[45]|^S-101/.test(p.code)) w = 0.6;
  return w;
};

const pad = (n) => String(n).padStart(2, '0');
const rows = [];
for (const mo of months) {
  const dim = new Date(Date.UTC(mo.y, mo.m, 0)).getUTCDate();
  for (const [name, factor] of Object.entries(CUSTOMERS)) {
    const f = factor(mo);
    if (f <= 0) continue;
    const orders = Math.max(1, Math.round(f * (4 + rand() * 3))); // 1か月の注文の回数
    for (let o = 0; o < orders; o += 1) {
      let day = 1 + Math.floor(rand() * dim);
      const dow = new Date(Date.UTC(mo.y, mo.m - 1, day)).getUTCDay();
      if (dow === 0) day = Math.min(dim, day + 1); // 日曜は休み
      const lines = 2 + Math.floor(rand() * 3);
      const used = new Set();
      for (let l = 0; l < lines; l += 1) {
        // 重みづけで商品を選ぶ
        const ws = master.products.map((p) => weight(p, mo));
        const total = ws.reduce((t, w) => t + w, 0);
        let r = rand() * total; let p = master.products[0];
        for (let i = 0; i < ws.length; i += 1) { r -= ws[i]; if (r <= 0) { p = master.products[i]; break; } }
        if (used.has(p.code)) continue;
        used.add(p.code);
        const cases = 1 + Math.floor(rand() * 3) + (name.startsWith('やまびこ') ? 1 : 0);
        const qty = p.caseQty * cases;
        rows.push({ date: `${mo.y}-${pad(mo.m)}-${pad(day)}`, customer: name, product: `${p.name}${p.spec ? ` ${p.spec}` : ''}`, qty, amount: qty * p.price });
      }
    }
  }
}
rows.sort((a, b) => a.date.localeCompare(b.date) || a.customer.localeCompare(b.customer, 'ja') || a.product.localeCompare(b.product, 'ja'));
const csv = ['日付,顧客,商品,数量,金額', ...rows.map((r) => [r.date, r.customer, r.product, r.qty, r.amount].join(','))].join('\r\n');
writeFileSync(fileURLToPath(new URL('../public/samples/monthly/sales-sample.csv', import.meta.url)), `﻿${csv}\r\n`);
const sum = (f) => rows.filter(f).reduce((t, r) => t + r.amount, 0);
console.log(`rows ${rows.length}, total ${sum(() => true).toLocaleString()}円`);
for (const y of [['2024-10', '2025-09'], ['2025-10', '2026-09']]) console.log(y.join('〜'), sum((r) => r.date.slice(0, 7) >= y[0] && r.date.slice(0, 7) <= y[1]).toLocaleString());
