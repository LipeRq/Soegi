// デモB：宿の多言語対応。用意した例文とよくある質問はキャッシュし、同じ例は毎回同じ結果を返す（AIを呼ばない）。
// 自由入力は Turnstile ＋ 同じIPから1日5回まで、500文字まで。
import { extractStructured } from '../ai.js';
import { INN_REPLY_TOOL, INN_FAQ_TOOL, INN_REVIEW_TOOL, validateInnReply, validateInnFaq, validateInnReview } from '../schemas.js';
import { HttpError, withRetry, UNTRUSTED_NOTE } from '../http.js';
import { buildInnContext, finalizeInnReply, finalizeInnFaq } from '../core/inn.js';
import { finalizeInnReview, REVIEW_MAX } from '../core/review.js';
import { getCached, putCached } from '../cache.js';
import { verifyTurnstile, allowPerDay } from '../guard.js';
import inn from '../../public/data/yukiakari.json' with { type: 'json' };
import examples from '../../public/data/inn-examples.json' with { type: 'json' };
import reviewExamples from '../../public/data/review-examples.json' with { type: 'json' };

export const FREE_MAX = 500;
export const FREE_PER_DAY = 5;
export const REVIEW_FREE_MAX = REVIEW_MAX; // 口コミ返信の自由入力（問い合わせとは別に、1日5回まで）
const PROMPT_VERSION = 'v1';

const SYSTEM = [
  `あなたは「${inn.name}」のスタッフの代わりに、外国語の問い合わせへの返信の下書きを作ります。送る前に必ずスタッフが確認します。`,
  UNTRUSTED_NOTE,
  '決まりごと：',
  '- 宿の情報に書いてあることだけを書く。書いていないこと（空室、料金、日程が決まっていない催し、宿の情報に無いサービス）は書かず、「担当者から改めてご連絡します」と同じ意味の文を問い合わせの言語で書く。',
  '- アレルギーは安全を約束しない。「事前の連絡で相談」「完全な除去は約束できない」を必ず伝える。',
  '- 問い合わせと同じ言語で、丁寧に書く。繁体字中国語の問い合わせには繁体字で書く（簡体字を使わない）。最後に宿の名前で署名する。',
  '- reply_ja には、返信の下書きを日本語に訳したものを書く（スタッフが中身を確かめるため）。',
  '- needs_check には、送る前にスタッフが確かめるべき点を挙げる（宿の情報に無いこと、宿だけで決められないこと）。',
  '- used_info_ids には、返信に使った宿の情報の id（[ ] の中）を入れる。',
  '',
  '# 宿の情報',
  buildInnContext(inn),
].join('\n');

async function draft(env, inquiry) {
  const v = await withRetry(async () => validateInnReply(await extractStructured(env, {
    tool: INN_REPLY_TOOL, system: SYSTEM, userText: `問い合わせ：\n${inquiry}`, maxTokens: 2500,
  })));
  return finalizeInnReply(inn, v, inquiry);
}

const cacheKey = (env, kind, id) => `inn:${PROMPT_VERSION}:${env.AI_PROVIDER || 'deepseek'}:${kind}:${id}`;

export async function innReply(env, body, ip) {
  // 1) 用意した例文：キャッシュがあればAIを呼ばない
  if (typeof body?.exampleId === 'string') {
    const ex = examples.find((e) => e.id === body.exampleId);
    if (!ex) throw new HttpError(404, '例文が見つかりません');
    const key = cacheKey(env, 'ex', ex.id);
    const hit = await getCached(key);
    if (hit) return { ...hit, cached: true };
    const out = await draft(env, ex.text);
    await putCached(key, out);
    return { ...out, cached: false };
  }

  // 2) 自由入力：ロボット対策と1日の回数（入力内容はキャッシュしない・保存しない）
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, '問い合わせの文を入力してください');
  if (text.length > FREE_MAX) throw new HttpError(400, `${FREE_MAX}文字までにしてください`);
  const ts = await verifyTurnstile(env, body.turnstileToken, ip);
  if (!ts.ok) {
    throw new HttpError(ts.reason === 'not-configured' ? 503 : 403,
      ts.reason === 'not-configured' ? '自由入力は準備中です。用意した例文でお試しください' : 'ロボットでないことの確認ができませんでした。もう一度お試しください');
  }
  const day = await allowPerDay(env, 'inn', ip, FREE_PER_DAY);
  if (!day.ok) throw new HttpError(429, `自由入力は1日${FREE_PER_DAY}回までです。用意した例文は何度でもお試しいただけます`);
  return { ...(await draft(env, text)), remaining: day.remaining };
}

export async function innFaq(env) {
  const key = cacheKey(env, 'faq', 'all');
  const hit = await getCached(key);
  if (hit) return { ...hit, cached: true };
  const v = await withRetry(async () => validateInnFaq(await extractStructured(env, {
    tool: INN_FAQ_TOOL,
    system: [
      `あなたは「${inn.name}」のサイトに載せる「よくある質問」を作ります。`,
      '決まりごと：',
      '- 宿の情報に書いてあることだけで答える。料金・空室など書いていないことは問いにしない。',
      '- 8問前後。外国人のお客さまがよく聞くこと（行き方、送迎、食事、アレルギー、温泉、支払い、キャンセル、樹氷）を中心に。',
      '- 日本語（ja）、繁体字中国語（zh。簡体字を使わない）、英語（en）、韓国語（ko）で、同じ内容を書く。',
      '- アレルギーは安全を約束しない。info_ids には使った宿の情報の id を入れる。',
      '',
      '# 宿の情報',
      buildInnContext(inn),
    ].join('\n'),
    userText: 'よくある質問を作って submit_inn_faq で提出してください。',
    maxTokens: 6000,
  })));
  const out = finalizeInnFaq(inn, v);
  await putCached(key, out);
  return { ...out, cached: false };
}

// ---- 口コミ返信 ---------------------------------------------------------------------------

const REVIEW_SYSTEM = [
  `あなたは「${inn.name}」のスタッフの代わりに、お客さまの口コミへの返信の下書きを作ります。送る前に必ず責任者が確認します。`,
  UNTRUSTED_NOTE,
  '決まりごと：',
  '- 口コミと同じ言語で、丁寧に書く。繁体字中国語の口コミには繁体字で書く（簡体字を使わない）。最後に宿の名前で署名する。',
  '- 反論しない。言い訳をしない。「しかし当館では」「規定では」のような言い方をしない。事実と違うと思っても、断定して否定しない。',
  '- 不満には、まず気持ちを受け止めて詫びる。どこまで事実を認めるか、返金や補償をするかは、宿が決めることなので、下書きでは断定も約束もしない（「状況を確認します」「担当者から改めてご連絡します」の意味の文にする）。',
  '- お客さま・スタッフの名前を書かない（口コミに名前があっても、返信には書かない）。',
  '- 宿の情報に書いてあることだけを書く。書いていない事実（改善の約束、日程、料金）を作らない。URLと料金を入れない。宣伝をしすぎない。',
  '- 星の数が高い口コミには、感謝と、また会える楽しみを短く書く。',
  '- review_ja は口コミの日本語訳。reply_ja は返信の下書きの日本語訳（スタッフが中身を確かめるため）。',
  '- points には、口コミの指摘を1つずつ、ほめ（praise）・不満（complaint）・要望（request）に分けて日本語で書く。',
  '- needs_check には、送る前に確かめる点（事実の確認が要る指摘、宿だけで決められないこと）を挙げる。',
  '- used_info_ids には、返信に使った宿の情報の id（[ ] の中）を入れる。',
  '',
  '# 宿の情報',
  buildInnContext(inn),
].join('\n');

async function draftReview(env, text, stars) {
  const v = await withRetry(async () => validateInnReview(await extractStructured(env, {
    tool: INN_REVIEW_TOOL, system: REVIEW_SYSTEM, userText: `星の数：${stars}（5が最高）\n口コミ：\n${text}`, maxTokens: 3000,
  })));
  return finalizeInnReview(inn, v, text, stars);
}

const parseStars = (x) => {
  const n = Number(x);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new HttpError(400, '星の数（1〜5）を選んでください');
  return n;
};

export async function innReview(env, body, ip) {
  // 1) 用意した例文：キャッシュがあればAIを呼ばない
  if (typeof body?.exampleId === 'string') {
    const ex = reviewExamples.find((e) => e.id === body.exampleId);
    if (!ex) throw new HttpError(404, '例文が見つかりません');
    const key = cacheKey(env, 'review', ex.id);
    const hit = await getCached(key);
    if (hit) return { ...hit, cached: true };
    const out = await draftReview(env, ex.text, ex.stars);
    await putCached(key, out);
    return { ...out, cached: false };
  }

  // 2) 自由入力：ロボット対策と1日の回数（問い合わせとは別に数える。入力内容はキャッシュしない・保存しない）
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, '口コミの文を入力してください');
  if (text.length > REVIEW_FREE_MAX) throw new HttpError(400, `${REVIEW_FREE_MAX}文字までにしてください`);
  const stars = parseStars(body.stars);
  const ts = await verifyTurnstile(env, body.turnstileToken, ip);
  if (!ts.ok) {
    throw new HttpError(ts.reason === 'not-configured' ? 503 : 403,
      ts.reason === 'not-configured' ? '自由入力は準備中です。用意した例文でお試しください' : 'ロボットでないことの確認ができませんでした。もう一度お試しください');
  }
  const day = await allowPerDay(env, 'inn-review', ip, FREE_PER_DAY);
  if (!day.ok) throw new HttpError(429, `自由入力は1日${FREE_PER_DAY}回までです。用意した例文は何度でもお試しいただけます`);
  return { ...(await draftReview(env, text, stars)), remaining: day.remaining };
}
