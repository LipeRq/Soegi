// AIの呼び出しはここ1か所に集約する。AI_PROVIDER で差し替える。
//   deepseek … デモ用
//   claude   … 本番（お客さんのデータを扱う導入では必ず claude）
//   mock     … AIを呼ばず固定の架空データを返す（画面の確認・リハーサル用）
// ログには本文（画像・読み取り結果）を出さない。

import { mockResponse } from './mock.js';

const TIMEOUT_MS = 55_000;

export class AIError extends Error {}

/**
 * 決まった形のJSONを1つ返させる。
 * @param {object} env
 * @param {{tool:{name,description,schema}, system:string, userText:string, imageBase64?:string, maxTokens?:number}} req
 *   system は毎回同じ内容（資料など）を前に置く。DeepSeek は前方一致で自動キャッシュされ、Claude は cache_control で明示する
 * @returns {Promise<object>} AIが返した生のJSON（検証は呼び出し側）
 */
export async function extractStructured(env, req) {
  const provider = (env.AI_PROVIDER || 'deepseek').toLowerCase();
  if (provider === 'claude') return callClaude(env, req);
  if (provider === 'deepseek') return callDeepSeek(env, req);
  if (provider === 'mock') return mockResponse(req);
  throw new AIError('AI_PROVIDER が不正です');
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AIError('AIサービスに接続できませんでした');
  }
  if (!res.ok) {
    // 応答本文は記録・返却しない
    throw new AIError(`AIサービスがエラーを返しました（${res.status}）`);
  }
  try {
    return await res.json();
  } catch {
    throw new AIError('AIサービスの応答を解釈できませんでした');
  }
}

// ---- DeepSeek（OpenAI互換） ------------------------------------------------

async function callDeepSeek(env, { tool, system, userText, imageBase64, maxTokens = 2000 }) {
  if (!env.DEEPSEEK_API_KEY) throw new AIError('DEEPSEEK_API_KEY が未設定です');
  const model = imageBase64
    ? (env.DEEPSEEK_VISION_MODEL || 'deepseek-v4-flash-vision-exp')
    : (env.DEEPSEEK_TEXT_MODEL || 'deepseek-v4-flash');
  const content = [{ type: 'text', text: userText }];
  if (imageBase64) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } });
  }
  const data = await postJson(
    `${env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`,
    { authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    {
      model,
      temperature: 0,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.schema } }],
      tool_choice: { type: 'function', function: { name: tool.name } },
    },
  );
  const msg = data?.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (typeof args === 'string') return parseJson(args);
  // ツール呼び出しにならなかった場合は本文のJSONを拾う
  if (typeof msg?.content === 'string') return parseJson(msg.content);
  throw new AIError('AIの応答に結果がありませんでした');
}

function parseJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{'); const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { /* fallthrough */ }
    }
    throw new AIError('AIの応答がJSONではありませんでした');
  }
}

// ---- Claude ------------------------------------------------------------------

async function callClaude(env, { tool, system, userText, imageBase64, maxTokens = 2000 }) {
  if (!env.ANTHROPIC_API_KEY) throw new AIError('ANTHROPIC_API_KEY が未設定です');
  const content = [];
  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } });
  }
  content.push({ type: 'text', text: userText });
  const data = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    {
      model: env.CLAUDE_MODEL,
      max_tokens: maxTokens,
      // 資料など毎回同じ部分はプロンプトキャッシュに載せる（短いものはキャッシュされないだけで害はない）
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
      tool_choice: { type: 'tool', name: tool.name },
    },
  );
  const block = data?.content?.find((b) => b.type === 'tool_use');
  if (!block?.input) throw new AIError('AIの応答に結果がありませんでした');
  return block.input;
}
