// soegi-demo Worker：静的ファイル（public/）は assets が配信し、ここは /api/* だけを受ける。
// 何も保存しない（自由入力の1日の回数だけ、IPのハッシュで翌日まで数える）。ログにも本文を出さない。
//
//   パスワードが必要（demo.withsoegi.jp の中のデモ）：/api/verify /api/receipt /api/timecard /api/order /api/knowledge /api/knowledge-own /api/report
//   LINE（署名で確かめる）：/line/webhook
//   公開（サイトから使うデモ）：/api/public-config /api/inn-reply /api/inn-review /api/inn-faq /api/site-chat

import { AIError } from './ai.js';
import { json, err, readJson, HttpError } from './http.js';
import { allowPerMinute, checkPass, clientIp, corsHeaders } from './guard.js';
import { receipt, timecard, order } from './demos/office.js';
import { knowledge } from './demos/knowledge.js';
import { knowledgeOwn, knowledgeOwnStatus } from './demos/own.js';
import { report } from './demos/report.js';
import { innReply, innFaq, innReview, FREE_MAX, FREE_PER_DAY, REVIEW_FREE_MAX } from './demos/inn.js';
import { siteChat, CHAT_MAX } from './demos/sitechat.js';
import { lineWebhook } from './demos/line.js';

const MB = 1024 * 1024;

const PRIVATE = {
  '/api/verify': { max: 4096, run: async () => ({ ok: true }) },
  '/api/receipt': { max: 4 * MB, run: (env, body) => receipt(env, body) },
  '/api/timecard': { max: 4 * MB, run: (env, body) => timecard(env, body) },
  '/api/order': { max: 4 * MB, run: (env, body) => order(env, body) },
  '/api/knowledge': { max: 8192, run: (env, body) => knowledge(env, body) },
  '/api/knowledge-own': { max: 256 * 1024, run: (env, body) => knowledgeOwn(env, body) },
  '/api/report': { max: 8192, run: (env, body) => report(env, body) },
  '/api/knowledge-own-status': { max: 1024, run: (env) => knowledgeOwnStatus(env) },
};
const PUBLIC = {
  '/api/inn-reply': { max: 16384, run: (env, body, ip) => innReply(env, body, ip) },
  '/api/inn-review': { max: 16384, run: (env, body, ip) => innReview(env, body, ip) },
  '/api/inn-faq': { max: 1024, run: (env) => innFaq(env) },
  '/api/site-chat': { max: 16384, run: (env, body, ip) => siteChat(env, body, ip), cors: true },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    // LINE の webhook：署名の確認が認証の代わり（パスワードは使わない）。本文はログに出さない
    if (path === '/line/webhook') {
      if (request.method !== 'POST') return err(405, 'POST のみ受け付けます');
      try { return json(await lineWebhook(request, env, ctx)); } catch (e) {
        if (e instanceof HttpError) return err(e.status, e.message);
        return err(500, '内部エラーが発生しました');
      }
    }
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const route = PRIVATE[path] ? { ...PRIVATE[path], private: true } : PUBLIC[path];
    const cors = route?.cors ? corsHeaders(request, env) : {};

    if (request.method === 'OPTIONS' && route?.cors) return new Response(null, { status: 204, headers: cors });
    if (path === '/api/public-config' && request.method === 'GET') {
      return json({
        ok: true,
        turnstileSiteKey: env.TURNSTILE_SITEKEY || '',
        innFreeMax: FREE_MAX, innFreePerDay: FREE_PER_DAY, innReviewMax: REVIEW_FREE_MAX, chatMax: CHAT_MAX,
      });
    }
    if (!route) return err(404, 'not found');
    if (request.method !== 'POST') return err(405, 'POST のみ受け付けます', cors);

    // 1) 回数制限（パスワードの総当たりも防ぐため、認証より先）
    const ip = clientIp(request);
    if (!(await allowPerMinute(env, ip))) return err(429, 'リクエストが多すぎます。1分ほど待ってからお試しください', cors);

    // 2) パスワード（demo側のデモだけ）
    if (route.private) {
      if (!env.DEMO_PASSCODE) return err(500, 'サーバーの設定が未完了です（DEMO_PASSCODE）');
      if (!(await checkPass(request, env))) return err(401, 'パスワードが違います');
    }

    try {
      const body = await readJson(request, route.max);
      const data = await route.run(env, body, ip);
      return path === '/api/verify' ? json({ ok: true }) : json({ ok: true, data }, 200, cors);
    } catch (e) {
      if (e instanceof HttpError) return err(e.status, e.message, cors);
      if (e instanceof AIError) return err(502, e.message, cors);
      if (e instanceof Error && e.message.startsWith('schema:')) {
        return err(502, 'AIの答えの形が崩れました。もう一度お試しください', cors);
      }
      return err(500, '内部エラーが発生しました', cors);
    }
  },
};
