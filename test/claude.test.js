import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStructured, toOutputSchema, AIError } from '../src/ai.js';
import { RECEIPT_TOOL, TIMECARD_TOOL, REPORT_TOOL, MONTHLY_TOOL, validateReceipt } from '../src/schemas.js';

const ENV = { AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-sonnet-5-5' };
const TOOL = { name: 'submit_x', description: 'd', schema: { type: 'object', properties: { a: { type: ['integer', 'null'], minimum: 0 }, b: { type: 'string', enum: ['x', 'y'] } }, required: ['a', 'b'] } };

async function withFetch(handler, fn) {
  const calls = []; const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const c = { url, headers: init.headers, body: JSON.parse(init.body) }; calls.push(c); return handler(c, calls.length); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}
const ok = (obj, extra = {}) => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }], ...extra }), { status: 200 });

test('スキーマの変換：オブジェクトは additionalProperties:false、null つきの型は anyOf、範囲の制約は外す', () => {
  const out = toOutputSchema(TOOL.schema);
  assert.equal(out.additionalProperties, false);
  assert.deepEqual(out.properties.a, { anyOf: [{ type: 'integer' }, { type: 'null' }] });
  assert.deepEqual(out.properties.b, { type: 'string', enum: ['x', 'y'] });
  assert.deepEqual(out.required, ['a', 'b']);
  // 元は変えない
  assert.deepEqual(TOOL.schema.properties.a, { type: ['integer', 'null'], minimum: 0 });
  // 項目名が制約のキーと同じでも消さない
  assert.ok('default' in toOutputSchema({ type: 'object', properties: { default: { type: 'string' } } }).properties);
});

test('全ツールのスキーマが、構造化出力に通る形になる（配列の型・範囲の制約・開いたオブジェクトが残らない）', () => {
  const walk = (n, path) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (!n || typeof n !== 'object') return;
    assert.ok(!Array.isArray(n.type), `${path}: type が配列`);
    for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) assert.ok(!(k in n) || path.endsWith('.properties'), `${path}.${k}`);
    if (n.type === 'object') assert.equal(n.additionalProperties, false, `${path}: additionalProperties`);
    for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
  };
  for (const t of [RECEIPT_TOOL, TIMECARD_TOOL, REPORT_TOOL, MONTHLY_TOOL]) walk(toOutputSchema(t.schema), t.name);
});

test('Claude への送り方：強制のツール呼び出しは使わず構造化出力で受ける。断られたときの代わりのモデルも付ける', async () => {
  await withFetch(() => ok({ a: 1, b: 'x' }), async (calls) => {
    const out = await extractStructured(ENV, { tool: TOOL, system: 'SYS', userText: 'U', imageBase64: 'QQ==', maxTokens: 1000 });
    assert.deepEqual(out, { a: 1, b: 'x' });
    const { body, headers, url } = calls[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.equal(body.output_config.effort, 'low');
    assert.equal(body.max_tokens, 5000); // 考える分の出力枠を足す
    assert.equal(body.fallbacks, 'default');
    assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.deepEqual(body.system[0].cache_control, { type: 'ephemeral' });
    assert.deepEqual(body.messages[0].content.map((b) => b.type), ['image', 'text']);
  });
});

test('Claude：fallbacks が 400 で断られたら、fallbacks なしで1回だけやり直す。CLAUDE_FALLBACKS=off では最初から付けない', async () => {
  await withFetch((c, n) => (n === 1 ? new Response('{}', { status: 400 }) : ok({ a: null, b: 'y' })), async (calls) => {
    assert.deepEqual(await extractStructured(ENV, { tool: TOOL, system: 'S', userText: 'U' }), { a: null, b: 'y' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.fallbacks, undefined);
    assert.equal(calls[1].headers['anthropic-beta'], undefined);
  });
  await withFetch(() => ok({ a: 1, b: 'x' }), async (calls) => {
    await extractStructured({ ...ENV, CLAUDE_FALLBACKS: 'off' }, { tool: TOOL, system: 'S', userText: 'U' });
    assert.equal(calls[0].body.fallbacks, undefined);
  });
  // 400 以外（認証・過負荷）は、やり直さずそのままエラー
  await withFetch(() => new Response('{}', { status: 529 }), async (calls) => {
    await assert.rejects(extractStructured(ENV, { tool: TOOL, system: 'S', userText: 'U' }), (e) => e instanceof AIError && e.status === 529);
    assert.equal(calls.length, 1);
  });
});

test('Claude：断られた・途中で切れた・本文が無い・JSONでない、をそれぞれ分かる言い方で返す', async () => {
  const run = (resp) => withFetch(() => new Response(JSON.stringify(resp), { status: 200 }), () => extractStructured(ENV, { tool: TOOL, system: 'S', userText: 'U' }));
  await assert.rejects(run({ stop_reason: 'refusal', content: [] }), /答えられませんでした/);
  await assert.rejects(run({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a"' }] }), /途中で切れ/);
  await assert.rejects(run({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }), /結果がありません/);
  await assert.rejects(run({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'こんにちは' }] }), /JSONではありません/);
  await assert.rejects(extractStructured({ AI_PROVIDER: 'claude' }, { tool: TOOL, system: 'S', userText: 'U' }), /ANTHROPIC_API_KEY/);
});

test('Claude の返したレシートを、いまの検証でそのまま通せる', async () => {
  const r = { is_receipt: true, date: '2026-10-01', payee: 'テスト商店', total: 1100, amount_10: 1100, amount_8: null, tax_amount: 100, invoice_no: '', payment_method: '現金', summary: '文具', account: '消耗品費', account_reason: '文具のため', confidence: { date: '高', payee: '高', total: '高', tax: '中', invoice_no: '低', account: '中' } };
  await withFetch(() => ok(r), async () => {
    const out = await extractStructured(ENV, { tool: RECEIPT_TOOL, system: 'S', userText: 'U' });
    assert.equal(validateReceipt(out).total, 1100);
  });
});
