// LINE で答える（デモ用の架空の公式アカウント）。Worker の POST /line/webhook。
// 署名を確かめたらすぐ 200 を返し、AI への問い合わせと返信は ctx.waitUntil で後から行う。返信は応答メッセージだけ。
// 保存するのは、モード（宿／ソエギ）だけ。利用者IDはハッシュにして、24時間で消える。本文はログにも出さない。
import { HttpError } from '../http.js';
import { allowPerDay, sha256Hex } from '../guard.js';
import { answerSite } from './sitechat.js';
import { draft } from './inn.js';
import {
  verifyLineSignature, readEvents, parseCommand, withQuickReply, textMessage, greeting, siteAnswerMessages, innDraftMessages,
  NOTICE, QUESTION_MAX, LINE_PER_DAY, LINE_ALL_PER_DAY, SWITCH_PER_DAY, MODES,
} from '../core/line.js';

const MAX_BODY = 64 * 1024;
const AI_TIMEOUT_MS = 25_000; // AI の待ちは25秒で打ち切る（応答トークンは約1分で切れる）
const MODE_TTL_SEC = 24 * 3600;
const memoryModes = new Map(); // KV が無いとき（ローカル開発）の簡易版

const aiName = (env) => ((env.AI_PROVIDER || 'deepseek').toLowerCase() === 'claude' ? 'Claude' : (env.AI_PROVIDER || 'deepseek').toLowerCase() === 'mock' ? '見本の答え' : 'DeepSeek');

async function modeKey(env, userId) {
  return `line-mode:${(await sha256Hex(`${env.HASH_SALT || 'soegi'}:line:${userId}`)).slice(0, 32)}`;
}
async function getMode(env, userId) {
  const key = await modeKey(env, userId);
  const v = env.DEMO_KV ? await env.DEMO_KV.get(key) : memoryModes.get(key);
  return v === 'inn' || v === 'site' ? v : 'site';
}
async function setMode(env, userId, mode) {
  const key = await modeKey(env, userId);
  if (env.DEMO_KV) await env.DEMO_KV.put(key, mode, { expirationTtl: MODE_TTL_SEC });
  else { memoryModes.set(key, mode); if (memoryModes.size > 2000) memoryModes.clear(); }
}

/** 時間切れのときは、待たずに「うまく答えられませんでした」にする */
const withTimeout = (p, ms) => {
  let t;
  return Promise.race([p, new Promise((_, ng) => { t = setTimeout(() => ng(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
};

/** 同じ通知（webhookEventId）は、10分のあいだ1回だけ処理する（LINE の再送・再生で、AI を何度も呼ばない） */
const memorySeen = new Map();
async function firstTime(env, ev) {
  if (!ev.eventId) return true;
  const key = `line-ev:${(await sha256Hex(ev.eventId)).slice(0, 32)}`;
  if (env.DEMO_KV) {
    if (await env.DEMO_KV.get(key)) return false;
    await env.DEMO_KV.put(key, '1', { expirationTtl: 600 }).catch(() => {});
    return true;
  }
  const now = Date.now();
  if ((memorySeen.get(key) ?? 0) > now) return false;
  memorySeen.set(key, now + 600_000);
  if (memorySeen.size > 2000) memorySeen.clear();
  return true;
}

/** 1つのイベントに対する返信のメッセージを作る */
export async function respond(env, ev) {
  if (ev.kind === 'follow') return withQuickReply(greeting(aiName(env)));
  if (ev.kind === 'other') return withQuickReply([textMessage(NOTICE.other)]);
  const text = ev.text.trim();
  const cmd = parseCommand(text);
  if (cmd?.type === 'help') return withQuickReply(greeting(aiName(env)));
  if (cmd?.type === 'mode') {
    // 切り替えの連打で、書き込みを使い切らせない（上限を超えたら、切り替えずに知らせる）
    if (!(await allowPerDay(env, 'line-switch', ev.userId, SWITCH_PER_DAY)).ok) return withQuickReply([textMessage(NOTICE.limit)]);
    try { await setMode(env, ev.userId, cmd.mode); } catch { return withQuickReply([textMessage(NOTICE.failed)]); }
    return withQuickReply([textMessage(NOTICE.modeSet[cmd.mode])]);
  }
  if (!text) return withQuickReply([textMessage(NOTICE.other)]);
  if (text.length > QUESTION_MAX) return withQuickReply([textMessage(NOTICE.tooLong)]);
  // 1人1日20回（ハッシュにした利用者IDで数える）
  const day = await allowPerDay(env, 'line', ev.userId, LINE_PER_DAY);
  if (!day.ok) return withQuickReply([textMessage(NOTICE.limit)]);
  // アカウント全体の1日の上限（Turnstile の無い LINE の、費用の歯止め）
  if (!(await allowPerDay(env, 'line-all', 'all', LINE_ALL_PER_DAY)).ok) return withQuickReply([textMessage(NOTICE.limit)]);
  const mode = await getMode(env, ev.userId);
  try {
    if (mode === 'inn') return withQuickReply(innDraftMessages(await withTimeout(draft(env, text), AI_TIMEOUT_MS)));
    return withQuickReply(siteAnswerMessages(await withTimeout(answerSite(env, 'soegi', text), AI_TIMEOUT_MS)));
  } catch {
    return withQuickReply([textMessage(NOTICE.failed)]);
  }
}

/** 応答メッセージを送る。応答トークンは1回だけ使える */
async function reply(env, replyToken, messages) {
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ replyToken, messages }),
      signal: AbortSignal.timeout(10_000),
    });
    // 本文は記録しない。失敗したときの状態（401＝トークンの間違い、400＝応答トークンの期限切れ、429＝多すぎ）だけ残す
    if (!res.ok) console.warn(`line reply failed: ${res.status}`);
  } catch { console.warn('line reply failed: network'); }
}

/** 1つずつ順に処理する（同じ人の回数を数えるとき、同時に走らせて上限を破られないように） */
export async function processEvents(env, events) {
  for (const ev of events.slice(0, 5)) {
    if (!(await firstTime(env, ev).catch(() => true))) continue;
    const messages = await respond(env, ev).catch(() => withQuickReply([textMessage(NOTICE.failed)]));
    await reply(env, ev.replyToken, messages);
  }
}

/** Worker の fetch から呼ぶ。署名が合わなければ 401、合えば 200 を先に返す */
export async function lineWebhook(request, env, ctx) {
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) throw new HttpError(503, 'LINE は準備中です');
  // 大きすぎる本文は、読む前に断る。署名は、受け取ったバイト列のままで確かめる
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) throw new HttpError(413, '送信内容が大きすぎます');
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY) throw new HttpError(413, '送信内容が大きすぎます');
  if (!(await verifyLineSignature(env.LINE_CHANNEL_SECRET, raw, request.headers.get('x-line-signature')))) throw new HttpError(401, '署名が合いません');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(raw) || '{}'); } catch { throw new HttpError(400, '送信内容を読めませんでした'); }
  const events = readEvents(body);
  if (events.length) ctx.waitUntil(processEvents(env, events));
  return { ok: true };
}

export { MODES };
