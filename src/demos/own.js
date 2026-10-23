// デモA：「御社の資料で試す」。Claude 固定（AI_PROVIDER が deepseek でも DeepSeek には送らない）。
// 毎回、資料の文字と質問が送られてくる。サーバーは何も保存しない・持たない。
import { askWithDocuments } from '../ai.js';
import { HttpError, UNTRUSTED_NOTE, jstToday } from '../http.js';
import { normalizeOwnDocs, normalizeOwnQuestion, finalizeOwnAnswer, OWN_MAX_DOCS, OWN_MAX_CHARS } from '../core/own.js';

/** 使えるのは、Claude のキーがあるとき（画面の見本確認用の mock のときも使える） */
export const ownAvailable = (env) => (env.AI_PROVIDER || '').toLowerCase() === 'mock' || Boolean(String(env.ANTHROPIC_API_KEY ?? '').trim());

export async function knowledgeOwnStatus(env) {
  return { available: ownAvailable(env), maxDocs: OWN_MAX_DOCS, maxChars: OWN_MAX_CHARS };
}

const SYSTEM = [
  'あなたは、利用者が持ち込んだ社内資料の案内係です。質問に、渡された資料だけを使って答えます。',
  UNTRUSTED_NOTE,
  '決まりごと：',
  '- 資料に書いてあることだけで答える。推測や一般論で補わない。資料に答えが無ければ、「資料には見当たりません」と短く答える（引用は付けない）。',
  '- 質問と同じ言語で答える。手順は番号付きで、資料の順番どおりに。数字（単価・時刻・日数など）は資料のとおりに書く。',
  '- 答えの根拠は、必ず資料からの引用で示す。',
  '- 給料・残業代の計算、在留資格（ビザ）など労務・法律の判断はしない。資料に書いてあることを案内するまでにする。',
].join('\n');

export async function knowledgeOwn(env, body) {
  if (!ownAvailable(env)) throw new HttpError(503, '「御社の資料で試す」は準備中です');
  const docs = normalizeOwnDocs(body?.docs);
  const question = normalizeOwnQuestion(body?.question);
  const ai = await askWithDocuments(env, {
    system: `${SYSTEM}\n今日の日付：${jstToday()}`,
    docs, question, maxTokens: 2000,
  });
  return finalizeOwnAnswer(docs, ai, question);
}
