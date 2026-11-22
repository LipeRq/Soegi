// demo.withsoegi.jp を実際に操作して、画面を録る（CDP の screencast で、変化した画面を時刻つきで保存する）。
// 使い方：DEMO_PASS=<合言葉> node src/record-demo.mjs [receipt|inn]
// 出力：assets/rec/<名前>/frames/<連番>.jpg と assets/rec/<名前>/log.json（各画像の時刻と、操作の印）
// 合言葉はファイルに書かない（環境変数で渡す）。
import { chromium } from './pw.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const BASE = 'https://demo.withsoegi.jp';
// 動画の中の枠に合わせた画面の大きさ（CSSピクセル）。2倍で撮るので 860×900 の画像になる
const VIEW = { width: 430, height: 450 };
const SCALE = 2;

async function record(name, script) {
  const dir = path.join(root, 'assets', 'rec', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'frames'), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, locale: 'ja-JP', isMobile: true, hasTouch: true });
  const pass = process.env.DEMO_PASS || '';
  await ctx.addInitScript((p) => { try { if (p) sessionStorage.setItem('soegi-demo-pass', p); } catch {} }, pass);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const marks = [];
  let t0 = null;
  cdp.on('Page.screencastFrame', async (f) => {
    const ts = f.metadata.timestamp;
    if (t0 === null) t0 = ts;
    const file = `${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(path.join(dir, 'frames', file), Buffer.from(f.data, 'base64'));
    frames.push({ file, t: +(ts - t0).toFixed(3) });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch {}
  });
  const now = () => (t0 === null ? 0 : +(Date.now() / 1000 - t0).toFixed(3));
  const mark = (label) => { marks.push({ label, t: now() }); console.log(name, label, now()); };
  const start = async () => {
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: VIEW.width * SCALE, maxHeight: VIEW.height * SCALE, everyNthFrame: 1 });
    await page.waitForTimeout(400);
  };
  try {
    await script({ page, start, mark });
  } finally {
    await page.waitForTimeout(300);
    await cdp.send('Page.stopScreencast').catch(() => {});
    writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ view: VIEW, scale: SCALE, frames, marks }, null, 1));
    await page.screenshot({ path: path.join(dir, 'last.png') });
    await browser.close();
  }
  console.log(name, 'frames:', frames.length, '->', dir);
}

// 撮る前に、端の方へゆっくり動かす（人がスクロールしたように見せる）
async function smoothScrollTo(page, y, ms = 900) {
  await page.evaluate(async ([y, ms]) => {
    const from = scrollY; const t0 = performance.now();
    await new Promise((done) => {
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        scrollTo(0, from + (y - from) * e);
        k < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }, [y, ms]);
}
const topOf = (page, sel, offset = 0) => page.$eval(sel, (el, o) => el.getBoundingClientRect().top + scrollY - o, offset);

const scripts = {
  // レシート：写真を4枚入れる → 読み取る → 表と色の付いた行
  async receipt({ page, start, mark }) {
    if (!process.env.DEMO_PASS) throw new Error('DEMO_PASS が要ります');
    await page.goto(`${BASE}/receipt.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (!page.url().includes('receipt')) throw new Error('合言葉の画面に戻されました: ' + page.url());
    await page.evaluate(() => scrollTo(0, 0));
    await page.$eval('#drop', (el) => el.scrollIntoView({ block: 'center' }));
    await start();
    mark('ready');
    await page.waitForTimeout(800);
    const files = [1, 2, 3, 4].map((i) => path.join(root, 'assets', 'receipts', `r${i}.jpg`));
    await page.setInputFiles('#pick', files);
    mark('added');
    await page.waitForTimeout(700);
    await smoothScrollTo(page, await topOf(page, '#thumbs', 120), 600);
    await page.waitForTimeout(500);
    mark('click-go');
    await page.click('#go');
    await page.waitForSelector('#step2:not([hidden])', { timeout: 120000 });
    mark('read-done');
    await page.waitForTimeout(2600); // 自動のスクロールと数え上げ
    mark('stats');
    await smoothScrollTo(page, await topOf(page, '#rows', 70), 1200);
    mark('rows');
    await page.waitForTimeout(2200);
    await smoothScrollTo(page, (await page.evaluate(() => scrollY)) + 380, 1600);
    mark('rows-2');
    await page.waitForTimeout(1500);
  },
  // 宿：英語の例文を選ぶ → 返信の下書きと日本語訳 → 要確認
  async inn({ page, start, mark }) {
    await page.goto(`${BASE}/inn.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const ex = page.locator('#examples > *', { hasText: 'Hello, we will arrive' }).first();
    await ex.scrollIntoViewIfNeeded();
    await smoothScrollTo(page, await ex.evaluate((el) => el.getBoundingClientRect().top + scrollY - 60), 10);
    await start();
    mark('ready');
    await page.waitForTimeout(1200);
    mark('click');
    await ex.click();
    await page.waitForSelector('#result:not([hidden])', { timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('r-replyja')?.textContent.trim().length > 0, null, { timeout: 120000 });
    mark('result');
    await page.waitForTimeout(2500);
    mark('quad');
    await smoothScrollTo(page, await topOf(page, '.box.reply', 74), 1000);
    await page.waitForTimeout(4500); // 下書きの文字が出そろうまで
    mark('reply');
    await smoothScrollTo(page, await topOf(page, '.box.ja2', 74), 1400);
    await page.waitForTimeout(2000);
    mark('ja2');
    await smoothScrollTo(page, await topOf(page, '#r-checkbox', 74), 1200);
    await page.waitForTimeout(2000);
    mark('check');
  },
};

const which = process.argv.slice(2);
for (const name of which.length ? which : Object.keys(scripts)) await record(name, scripts[name]);
