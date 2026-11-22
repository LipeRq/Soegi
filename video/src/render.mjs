// 動画とサムネイルを書き出す。名前・URL・添え書きは brand.json の1か所から読む。
// 使い方：node src/render.mjs [v30] [v15] [sq30] [thumbs]（何も付けなければ全部）
// 出力：out/nodus-<版>.mp4、out/thumb-<版>.png、out/check/<版>-<場面>.png（各場面の確認用の1枚）
import { chromium } from './pw.mjs';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const FPS = 30;
const out = path.join(root, 'out');
const work = process.env.WORK_DIR || path.join(os.tmpdir(), 'nodus-video-frames');
mkdirSync(path.join(out, 'check'), { recursive: true });

// ---- 設定 ----
const brandRaw = JSON.parse(readFileSync(path.join(root, 'brand.json'), 'utf8'));
const svg = readFileSync(path.join(root, 'assets', 'yamagata.svg'), 'utf8');
const brand = {
  ...brandRaw,
  // CSS の mask は file:// の画像を読めないため、データURLにして渡す
  wordmarkUrl: brandRaw.wordmark ? 'data:image/png;base64,' + readFileSync(path.resolve(root, brandRaw.wordmark)).toString('base64') : null,
  mapViewBox: svg.match(/viewBox="([^"]+)"/)[1],
  mapPath: svg.match(/ d="([^"]+)"/)[1],
};
const edl = JSON.parse(readFileSync(path.join(here, 'edl.json'), 'utf8'));

const V30 = [
  { id: 's1', start: 0, end: 3 }, { id: 's2', start: 3, end: 8 },
  // レシートの場面（id: 'receipt'）は、本番の読み取りが直るまで社内検索（'knowledge'）に替えている
  { id: 'knowledge', start: 8, end: 13 }, { id: 'inn', start: 13, end: 18 },
  { id: 's5', start: 18, end: 23 }, { id: 's6', start: 23, end: 27 }, { id: 's7', start: 27, end: 30 },
];
const FORMATS = {
  v30: { format: 'v', size: [1080, 1920], duration: 30, scenes: V30 },
  v15: { format: 'v', size: [1080, 1920], duration: 15, scenes: [
    { id: 's1', start: 0, end: 2 }, { id: 'knowledge', start: 2, end: 6 }, { id: 'inn', start: 6, end: 10 },
    { id: 's7', start: 10, end: 15, opt: { lead: '山形で、訪問してお手伝いします' } },
  ] },
  sq30: { format: 'sq', size: [1080, 1080], duration: 30, scenes: V30 },
};
const THUMBS = {
  v30: { format: 'v', size: [1080, 1920], opt: {} },
  v15: { format: 'v', size: [1080, 1920], opt: { hook: true } },
  sq30: { format: 'sq', size: [1080, 1080], opt: {} },
};

// ---- 録画のコマを、動画の時刻に割り当てる ----
function clipFrames(name, seconds) {
  const segs = edl[name]?.[String(seconds)];
  if (!segs) return null;
  const log = JSON.parse(readFileSync(path.join(root, 'assets', 'rec', name, 'log.json'), 'utf8'));
  const at = (t) => {
    let f = log.frames[0];
    for (const x of log.frames) { if (x.t <= t) f = x; else break; }
    return pathToFileURL(path.join(root, 'assets', 'rec', name, 'frames', f.file)).href;
  };
  const XF = 4; // つなぎ目で重ねるコマ数
  const list = [];
  segs.forEach(([s0, s1, d], si) => {
    const n = Math.round(d * FPS);
    for (let k = 0; k < n; k++) {
      const src = s0 + (s1 - s0) * (k / n);
      const item = { a: at(src) };
      if (si > 0 && k < XF) {
        const [p0, p1] = segs[si - 1];
        item.b = item.a; item.a = at(p1 + (k / FPS) * ((p1 - p0) / segs[si - 1][2])); item.mix = (k + 1) / (XF + 1);
      }
      list.push(item);
    }
  });
  return list;
}

function clipsAt(f, t) {
  const res = {};
  for (const s of f.scenes) {
    if (!(s.id in f._clips) || t < s.start || t >= s.end) continue;
    const list = f._clips[s.id];
    if (!list) continue;
    res[s.id] = list[Math.min(list.length - 1, Math.max(0, Math.floor((t - s.start) * FPS + 1e-6)))];
  }
  return res;
}

async function openStage(browser, size, planObj) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'stage.html')).href);
  await page.evaluate((p) => window.setup(p), planObj);
  return page;
}

async function renderVideo(browser, key) {
  const f = FORMATS[key];
  f._clips = {};
  for (const s of f.scenes) if (['receipt', 'knowledge', 'inn'].includes(s.id)) f._clips[s.id] = clipFrames(s.id, s.end - s.start);
  const planObj = { format: f.format, duration: f.duration, scenes: f.scenes, brand };
  const dir = path.join(work, key);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const total = f.duration * FPS;
  const WORKERS = 4;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const page = await openStage(browser, f.size, planObj);
    for (let i = w; i < total; i += WORKERS) {
      const t = i / FPS;
      await page.evaluate(([t, c]) => window.renderAt(t, c), [t, clipsAt(f, t)]);
      await page.screenshot({ path: path.join(dir, `${String(i).padStart(5, '0')}.png`) });
    }
    await page.close();
  }));
  const mp4 = path.join(out, `nodus-${key}.mp4`);
  // H.264（High）・yuv420p・30fps。BGMは入れない（無音の音声トラックだけ付ける：音声トラックが無い動画を受け付けない投稿先があるため）
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.png'),
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', mp4]);
  // 確認用：各場面の終わり近く（すべての文字が出そろった所）を1枚ずつ
  for (const s of f.scenes) {
    const t = Math.max(s.start, s.end - 0.5);
    const i = Math.min(total - 1, Math.round(t * FPS));
    execFileSync('cp', [path.join(dir, `${String(i).padStart(5, '0')}.png`), path.join(out, 'check', `${key}-${s.id}.png`)]);
  }
  console.log(key, `${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s ->`, mp4);
}

async function renderThumb(browser, key) {
  const th = THUMBS[key];
  const planObj = { format: th.format, duration: 1, scenes: [{ id: 'thumb', start: 0, end: 1, opt: th.opt }], brand };
  const page = await openStage(browser, th.size, planObj);
  await page.evaluate(() => window.renderAt(0.5));
  await page.screenshot({ path: path.join(out, `thumb-${key}.png`) });
  await page.close();
  console.log('thumb', key);
}

const args = process.argv.slice(2);
const want = args.length ? args : ['v30', 'v15', 'sq30', 'thumbs'];
const browser = await chromium.launch();
try {
  for (const k of want) {
    if (k === 'thumbs') { for (const t of Object.keys(THUMBS)) await renderThumb(browser, t); }
    else if (FORMATS[k]) await renderVideo(browser, k);
    else throw new Error('知らない版：' + k);
  }
} finally { await browser.close(); }
if (!existsSync(out)) throw new Error('出力がありません');
