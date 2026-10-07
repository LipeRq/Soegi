// AIの呼び出しはここ1か所に集約する。AI_PROVIDER で差し替える。
//   deepseek … デモ用
//   claude   … 本番（お客さんのデータを扱う導入では必ず claude）
//   mock     … AIを呼ばず固定の架空データを返す（画面の確認・リハーサル用）
// ログには本文（画像・読み取り結果）を出さない。

const TIMEOUT_MS = 55_000;

export class AIError extends Error {}

/**
 * 決まった形のJSONを1つ返させる。
 * @param {object} env
 * @param {{tool:{name,description,schema}, system:string, userText:string, imageBase64?:string}} req
 * @returns {Promise<object>} AIが返した生のJSON（検証は呼び出し側）
 */
export async function extractStructured(env, req) {
  const provider = (env.AI_PROVIDER || 'deepseek').toLowerCase();
  if (provider === 'claude') return callClaude(env, req);
  if (provider === 'deepseek') return callDeepSeek(env, req);
  if (provider === 'mock') return callMock(req);
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

async function callDeepSeek(env, { tool, system, userText, imageBase64 }) {
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
      max_tokens: 2000,
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

async function callClaude(env, { tool, system, userText, imageBase64 }) {
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
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content }],
      tools: [{ name: tool.name, description: tool.description, input_schema: tool.schema }],
      tool_choice: { type: 'tool', name: tool.name },
    },
  );
  const block = data?.content?.find((b) => b.type === 'tool_use');
  if (!block?.input) throw new AIError('AIの応答に結果がありませんでした');
  return block.input;
}

// ---- Mock（架空データ） ------------------------------------------------------

const MOCK_STORES = [
  { payee: 'さくら文具店', summary: 'コピー用紙・ボールペン', total: 1980, a10: 1980, a8: null, tax: 180, acc: '事務用品費', inv: 'T1234567890123' },
  { payee: 'みどり食堂', summary: '日替わり定食 2名', total: 1760, a10: null, a8: 1760, tax: 130, acc: '会議費', inv: 'T2345678901234' },
  { payee: 'あおぞらガソリンスタンド', summary: 'レギュラー給油', total: 6200, a10: 6200, a8: null, tax: 564, acc: '車両費（燃料）', inv: '' },
  { payee: '山の駅 売店', summary: '飲料・菓子', total: 1200, a10: 400, a8: 700, tax: 91, acc: '福利厚生費', inv: 'T3456789012345' },
];
let mockCounter = 0;

function callMock({ tool }) {
  const i = mockCounter++ % MOCK_STORES.length;
  if (tool.name === 'submit_receipt') {
    const s = MOCK_STORES[i];
    const d = new Date(Date.now() - (i + 1) * 3 * 86400000).toISOString().slice(0, 10);
    return {
      is_receipt: true, date: d, payee: s.payee, total: s.total,
      amount_10: s.a10, amount_8: s.a8, tax_amount: s.tax, invoice_no: s.inv,
      payment_method: '現金', summary: s.summary, account: s.acc,
      account_reason: '（モック）品目から推定した候補',
      confidence: { date: '高', payee: '高', total: '高', tax: i === 3 ? '低' : '中', invoice_no: s.inv ? '中' : '低', account: '中' },
    };
  }
  return {
    employee_name: '（モック）青木 一郎',
    entries: [
      { date: '1', start: '09:00', end: '18:00', break_min: 60 },
      { date: '2', start: '09:00', end: '20:30', break_min: null },
    ],
  };
}
