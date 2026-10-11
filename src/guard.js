// 使いすぎを防ぐしくみ：1分あたりの回数制限、1日あたりの回数制限、合言葉、Turnstile、CORS。
// 1日の回数は IP をそのまま残さず、ハッシュにして KV に置く（翌日には消える）。

const RATE_LIMIT = 30; // 同じIPから1分に
const RATE_WINDOW_MS = 60_000;
const memoryHits = new Map(); // バインディングが無いとき（ローカル開発）の簡易版
const memoryDaily = new Map();

export const clientIp = (request) => request.headers.get('cf-connecting-ip') || 'unknown';

export async function allowPerMinute(env, ip) {
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: ip });
    return success;
  }
  const now = Date.now();
  const hits = (memoryHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) { memoryHits.set(ip, hits); return false; }
  hits.push(now);
  memoryHits.set(ip, hits);
  if (memoryHits.size > 1000) {
    for (const [k, v] of memoryHits) if (!v.some((t) => now - t < RATE_WINDOW_MS)) memoryHits.delete(k);
  }
  return true;
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const jstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 1日の回数を数えて、上限以内なら true。KV（DEMO_KV）があれば使い、無ければメモリで数える。
 * KV は結果整合なので、上限は「目安」として扱う（デモの使いすぎ防止には十分）。
 */
export async function allowPerDay(env, bucket, ip, limit) {
  const key = `${bucket}:${jstDate()}:${(await sha256Hex(`${env.HASH_SALT || 'soegi'}:${ip}`)).slice(0, 32)}`;
  if (env.DEMO_KV) {
    const n = Number(await env.DEMO_KV.get(key)) || 0;
    if (n >= limit) return { ok: false, remaining: 0 };
    await env.DEMO_KV.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
    return { ok: true, remaining: limit - n - 1 };
  }
  const n = memoryDaily.get(key) || 0;
  if (n >= limit) return { ok: false, remaining: 0 };
  memoryDaily.set(key, n + 1);
  if (memoryDaily.size > 5000) memoryDaily.clear();
  return { ok: true, remaining: limit - n - 1 };
}

// ---- 合言葉 ---------------------------------------------------------------------------

/** 合言葉はヘッダーに日本語を載せられないため、画面側でURLエンコードして送る */
function readPass(request) {
  const raw = request.headers.get('x-demo-pass') || '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** 長さを漏らさないよう、ハッシュにして定数時間で比べる */
export async function checkPass(request, env) {
  if (!env.DEMO_PASSCODE) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(readPass(request))),
    crypto.subtle.digest('SHA-256', enc.encode(env.DEMO_PASSCODE)),
  ]);
  const x = new Uint8Array(ha); const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---- Turnstile ------------------------------------------------------------------------

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: false, reason: 'not-configured' };
  if (!token || typeof token !== 'string' || token.length > 2048) return { ok: false, reason: 'missing' };
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    return { ok: data.success === true, reason: data.success ? '' : 'failed' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

// ---- CORS（サイトのチャットボットだけ、withsoegi.jp からの呼び出しを許す） ------------------

export function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  const allowed = (env.CHAT_ALLOWED_ORIGINS || 'https://withsoegi.jp,https://www.withsoegi.jp')
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
