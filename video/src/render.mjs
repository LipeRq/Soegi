// 動画とサムネイルを書き出す。名前・URL・添え書きは brand.json の1か所から読む。
// 使い方：node src/render.mjs [v30] [v15] [sq30] [thumbs]（何も付けなければ全部）
// 出力：out/nodus-<版>.mp4、out/thumb-<版>.png、out/check/<版>-<場面>.png（各場面の確認用の1枚）
// 映像：60fps・H.264（High）。音声：BGMと効果音（src/make-audio.py で合成）を -14 LUFS にそろえる
import { chromium } from './pw.mjs';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const FPS = 60;
const out = path.join(root, 'out');
const work = process.env.WORK_DIR || path.join(os.tmpdir(), 'nodus-video-frames');
mkdirSync(path.join(out, 'check'), { recursive: true });

// ---- 設定 ----
const brandRaw = JSON.parse(readFileSync(path.join(root, 'brand.json'), 'utf8'));
const brand = {
  ...brandRaw,
  // CSS の mask は file:// の画像を読めないため、データURLにして渡す
  wordmarkUrl: brandRaw.wordmark ? 'data:image/png;base64,' + readFileSync(path.resolve(root, brandRaw.wordmark)).toString('base64') : null,
};
brand.japan = JSON.parse(readFileSync(path.join(root, 'assets', 'japan.json'), 'utf8')); // 日本地図（src/make-japan.py でつくる）
// 場面の並び（秒）。切り替えは BGM の拍（0.5秒）にそろえる
const V30 = [
  { id: 's1', start: 0, end: 3 }, { id: 's2', start: 3, end: 6.5 },
  { id: 'receipt', start: 6.5, end: 11 }, { id: 'search', start: 11, end: 15.5 }, { id: 'inquiry', start: 15.5, end: 20 },
  { id: 's5', start: 20, end: 24 }, { id: 'japan', start: 24, end: 27 }, { id: 's7', start: 27, end: 30 },
];
// BGMの流れ（場面に合わせる）
const V30_MUSIC = [
  { from: 0, to: 3, mode: 'intro' }, { from: 3, to: 6.5, mode: 'groove' }, { from: 6.5, to: 24, mode: 'full' },
  { from: 24, to: 27, mode: 'break' }, { from: 27, to: 30, mode: 'outro' },
];
const FORMATS = {
  v30: { format: 'v', size: [1080, 1920], duration: 30, scenes: V30, music: V30_MUSIC },
  v15: { format: 'v', size: [1080, 1920], duration: 15, scenes: [
    { id: 's1', start: 0, end: 2 }, { id: 'receipt', start: 2, end: 5 }, { id: 'search', start: 5, end: 8 }, { id: 'inquiry', start: 8, end: 11 },
    { id: 's7', start: 11, end: 15, opt: { lead: '山形を中心に、全国の企業を支援' } },
  ], music: [{ from: 0, to: 2, mode: 'intro' }, { from: 2, to: 11, mode: 'full' }, { from: 11, to: 15, mode: 'outro' }] },
  sq30: { format: 'sq', size: [1080, 1080], duration: 30, scenes: V30, music: V30_MUSIC },
};
const THUMBS = {
  v30: { format: 'v', size: [1080, 1920], opt: {} },
  v15: { format: 'v', size: [1080, 1920], opt: { hook: true, dark: true } },
  sq30: { format: 'sq', size: [1080, 1080], opt: {} },
};

async function openStage(browser, size, planObj) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(path.join(here, 'stage.html')).href);
  const cues = await page.evaluate((p) => window.setup(p), planObj);
  return { page, cues };
}

// 音声：合成 → 2回に分けて -14 LUFS にそろえる。AAC にしたあとも割れないよう、最大値をリミッターで -2.5 dB に抑える
function makeAudio(key, f, cues) {
  const spec = path.join(work, `${key}-audio.json`);
  const raw = path.join(work, `${key}-raw.wav`);
  const norm = path.join(work, `${key}.wav`);
  writeFileSync(spec, JSON.stringify({ duration: f.duration, sections: f.music, cues }, null, 1));
  writeFileSync(path.join(out, 'check', `${key}-cues.json`), JSON.stringify(cues, null, 1));
  execFileSync('python3', [path.join(here, 'make-audio.py'), spec, raw], { stdio: 'inherit' });
  const target = 'I=-14:TP=-2:LRA=11';
  const m = spawnSync('ffmpeg', ['-hide_banner', '-i', raw, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  const j = JSON.parse(m.stderr.slice(m.stderr.lastIndexOf('{')));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af',
    `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true,alimiter=limit=0.75:level=false:attack=1:release=60,aresample=48000`,
    '-ar', '48000', norm]);
  return norm;
}

async function renderVideo(browser, key) {
  const f = FORMATS[key];
  const planObj = { format: f.format, duration: f.duration, scenes: f.scenes, brand };
  const dir = path.join(work, key);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const total = f.duration * FPS;
  const WORKERS = 4;
  const t0 = Date.now();
  let cues = null;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const { page, cues: c } = await openStage(browser, f.size, planObj);
    if (w === 0) cues = c;
    for (let i = w; i < total; i += WORKERS) {
      const t = i / FPS;
      await page.evaluate((t) => window.renderAt(t), t);
      await page.screenshot({ path: path.join(dir, `${String(i).padStart(5, '0')}.png`) });
    }
    await page.close();
  }));
  const wav = makeAudio(key, f, cues);
  const mp4 = path.join(out, `nodus-${key}.mp4`);
  // 高画質：CRF 14・preset slow・60fps・2秒ごとのキーフレーム。音声は AAC 256kbps
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%05d.png'), '-i', wav,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level:v', '4.2',
    '-r', String(FPS), '-g', String(FPS * 2), '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', mp4]);
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
  const { page } = await openStage(browser, th.size, planObj);
  await page.evaluate(() => window.renderAt(0.5));
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await page.screenshot({ path: path.join(out, `thumb-${key}.png`) });
  await page.close();
  console.log('thumb', key);
}

const args = process.argv.slice(2);
const want = args.length ? args : ['v30', 'v15', 'sq30', 'thumbs'];
mkdirSync(work, { recursive: true });
const browser = await chromium.launch();
try {
  for (const k of want) {
    if (k === 'thumbs') { for (const t of Object.keys(THUMBS)) await renderThumb(browser, t); }
    else if (FORMATS[k]) await renderVideo(browser, k);
    else throw new Error('知らない版：' + k);
  }
} finally { await browser.close(); }
if (!existsSync(out)) throw new Error('出力がありません');
