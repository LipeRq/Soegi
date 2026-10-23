import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnDocs, finalizeOwnAnswer, guessLang, OWN_MAX_CHARS } from '../src/core/own.js';
import { knowledgeOwn, knowledgeOwnStatus, ownAvailable } from '../src/demos/own.js';
import { askWithDocuments, AIError } from '../src/ai.js';
import { mockDocAnswer } from '../src/mock.js';
import worker from '../src/worker.js';

const DOCS = [
  { name: '就業規則（抜粋）', text: '有給休暇を使うときは、休みたい日の3日前までに休暇届を班長に出します。\n遅刻するときは、始業の30分前までに班長へ電話します。' },
  { name: '見積書メモ', text: 'ラ・フランスジャム 150g｜単価 420円｜数量 600個。' },
];
const MOCK = { AI_PROVIDER: 'mock' };

test('資料の検証：個数・文字数の上限は切らずに断る。空・型違いは断る', () => {
  assert.equal(normalizeOwnDocs(DOCS).length, 2);
  assert.throws(() => normalizeOwnDocs([]), /資料を入れてください/);
  assert.throws(() => normalizeOwnDocs([...DOCS, ...DOCS]), /3つまで/);
  assert.throws(() => normalizeOwnDocs([{ name: 'a', text: '  ' }]), /文字がありません/);
  assert.throws(() => normalizeOwnDocs([{ name: 'a' }]), /読めませんでした/);
  const big = [{ name: '長い資料', text: 'あ'.repeat(OWN_MAX_CHARS) }, { name: '短い資料', text: 'い'.repeat(10) }];
  assert.throws(() => normalizeOwnDocs(big), (e) => e.status === 400 && /50,010文字/.test(e.message) && /「長い資料」50,000文字/.test(e.message) && /「短い資料」10文字/.test(e.message));
  assert.equal(normalizeOwnDocs([{ name: 'a'.repeat(300), text: 'x\u0000y' }])[0].text, 'xy');
  assert.equal(normalizeOwnDocs([{ name: 'a'.repeat(300), text: 'x' }])[0].name.length, 100);
});

test('引用の照合：資料にある文だけを残す。位置が違っても文が合えば直す。作った文は捨てる', () => {
  const q = '有給休暇を使うには？';
  const quote = '有給休暇を使うときは、休みたい日の3日前までに休暇届を班長に出します。';
  const ok = finalizeOwnAnswer(DOCS, {
    text: '3日前までに休暇届を班長に出します。',
    citations: [
      { document_index: 0, cited_text: quote, start_char_index: 0, end_char_index: quote.length },
      { document_index: 0, cited_text: quote, start_char_index: 5, end_char_index: 9 }, // 位置が違う → 文で探し直す（同じ引用は1つに）
      { document_index: 0, cited_text: '作った文です。資料にはありません。', start_char_index: 0, end_char_index: 10 },
      { document_index: 9, cited_text: quote, start_char_index: 0, end_char_index: 5 }, // 資料が無い
    ],
  }, q);
  assert.equal(ok.found, true);
  assert.deepEqual(ok.citations, [{ docIndex: 0, docName: '就業規則（抜粋）', quote, start: 0, end: quote.length }]);
  assert.match(ok.notes[0], /確かめられなかった根拠を2件/);
  // 全角半角・空白の違いだけなら資料の中にあるとみなす（位置は -1）
  const fz = finalizeOwnAnswer(DOCS, { text: '答え', citations: [{ document_index: 1, cited_text: 'ラ・フランスジャム 150g ｜ 単価 420円', start_char_index: 0, end_char_index: 3 }] }, '単価は？');
  assert.equal(fz.found, true);
  assert.equal(fz.citations[0].start, -1);
});

test('引用が1つも確かめられなければ「見当たりません」に置き換える（質問の言語で）', () => {
  const none = finalizeOwnAnswer(DOCS, { text: 'たぶん3日前です。', citations: [] }, '有給は？');
  assert.equal(none.found, false);
  assert.equal(none.answer, '資料には見当たりません。担当者に確認してください。');
  assert.deepEqual(none.citations, []);
  assert.deepEqual(none.notes, []); // 引用が1つも付かなかった答えに、「根拠を確かめられなかった」とは言わない
  const fake = finalizeOwnAnswer(DOCS, { text: '答え', citations: [{ document_index: 0, cited_text: '資料に無い文章がここにあります', start_char_index: 0, end_char_index: 5 }] }, '有給は？');
  assert.equal(fake.found, false);
  assert.match(fake.notes[0], /確かめられなかったため、答えを出していません/);
  const vi = finalizeOwnAnswer(DOCS, { text: '', citations: [] }, 'Tôi muốn xin nghỉ phép?');
  assert.equal(vi.language, 'vi');
  assert.match(vi.answer, /Không tìm thấy/);
  assert.match(vi.easyJa, /しりょう/);
  const empty = finalizeOwnAnswer(DOCS, { text: '', citations: [] }, 'x');
  assert.deepEqual(empty.notes, []);
});

test('安全・労務の判定：決まった語で、答えと一緒に必ず出す', () => {
  const a = finalizeOwnAnswer(DOCS, { text: 'x', citations: [] }, '手を切った。どうする？');
  assert.equal(a.requireConfirm, true);
  assert.match(a.confirmText, /必ずリーダーに確認/);
  const b = finalizeOwnAnswer(DOCS, { text: 'x', citations: [] }, 'ビザの更新は？');
  assert.equal(b.laborNotice, true);
  assert.equal(finalizeOwnAnswer(DOCS, { text: 'x', citations: [] }, '単価は？').requireConfirm, false);
});

test('質問の言語の見分け', () => {
  assert.equal(guessLang('有給はどう取る？'), 'ja');
  assert.equal(guessLang('有給休暇'), 'ja');
  assert.equal(guessLang('휴가는 어떻게?'), 'ko');
  assert.equal(guessLang('How do I take leave?'), 'en');
  assert.equal(guessLang('Tôi muốn nghỉ phép'), 'vi');
});

test('見本（mock）：近い文を引用して答える。無関係な質問は引用なし', async () => {
  const a = await knowledgeOwn(MOCK, { docs: DOCS, question: '有給休暇を使うときはいつまでに休暇届を出しますか？' });
  assert.equal(a.found, true);
  assert.equal(a.citations[0].docName, '就業規則（抜粋）');
  assert.match(a.citations[0].quote, /3日前までに休暇届/);
  const b = await knowledgeOwn(MOCK, { docs: DOCS, question: '来月の社員旅行はどこですか？' });
  assert.equal(b.found, false);
  assert.equal(mockDocAnswer(DOCS, 'zzzz').citations.length, 0);
});

test('使えるかどうか：キーが無く mock でもなければ使えない（札を出さない・実行は503）', async () => {
  assert.equal(ownAvailable({}), false);
  assert.equal(ownAvailable({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'x' }), false);
  assert.equal(ownAvailable({ ANTHROPIC_API_KEY: 'k' }), true);
  assert.equal(ownAvailable(MOCK), true);
  assert.deepEqual(await knowledgeOwnStatus({}), { available: false, maxDocs: 3, maxChars: 50000 });
  await assert.rejects(knowledgeOwn({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'x' }, { docs: DOCS, question: 'q' }), (e) => e.status === 503);
});

test('質問の検証', async () => {
  await assert.rejects(knowledgeOwn(MOCK, { docs: DOCS, question: '' }), (e) => e.status === 400);
  await assert.rejects(knowledgeOwn(MOCK, { docs: DOCS, question: 'あ'.repeat(501) }), (e) => e.status === 400);
  await assert.rejects(knowledgeOwn(MOCK, { docs: 'x', question: 'q' }), (e) => e.status === 400);
});

test('Claude への送り方：文書ブロック（引用あり）・最後の資料にキャッシュ・DeepSeek には送らない', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: '3日前までです。', citations: [{ type: 'char_location', cited_text: DOCS[0].text.slice(0, 20), document_index: 0, document_title: DOCS[0].name, start_char_index: 0, end_char_index: 20 }] },
        { type: 'text', text: '（以上）' },
      ],
      usage: { input_tokens: 10, cache_read_input_tokens: 500, cache_creation_input_tokens: 0, output_tokens: 20 },
    }), { status: 200 });
  };
  try {
    const out = await askWithDocuments({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd', ANTHROPIC_API_KEY: 'k' }, { system: 'SYS', docs: DOCS, question: '有給は？' });
    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://api.anthropic.com/v1/messages'); // DeepSeek には送らない
    assert.equal(init.headers['x-api-key'], 'k');
    assert.equal(body.model, 'claude-sonnet-5-5');
    assert.equal(body.system, 'SYS');
    const c = body.messages[0].content;
    assert.deepEqual(c.map((b) => b.type), ['document', 'document', 'text']);
    assert.deepEqual(c[0].source, { type: 'text', media_type: 'text/plain', data: DOCS[0].text });
    assert.deepEqual(c[0].citations, { enabled: true });
    assert.equal(c[0].title, DOCS[0].name);
    assert.equal(c[0].cache_control, undefined);
    assert.deepEqual(c[1].cache_control, { type: 'ephemeral' }); // 最後の資料だけ
    assert.equal(c[2].text, '有給は？');
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.equal(out.text, '3日前までです。（以上）');
    assert.equal(out.citations.length, 1);
    assert.deepEqual(out.usage, { input: 10, cacheRead: 500, cacheWrite: 0, output: 20 });
    // CLAUDE_MODEL で変えられる
    await askWithDocuments({ ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-opus-5-5' }, { system: 'S', docs: DOCS, question: 'q' });
    assert.equal(calls[1].body.model, 'claude-opus-5-5');
    // キーが無ければ断る
    await assert.rejects(askWithDocuments({}, { system: 'S', docs: DOCS, question: 'q' }), AIError);
    // 断られた・途中で切れた
    globalThis.fetch = async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] }), { status: 200 });
    await assert.rejects(askWithDocuments({ ANTHROPIC_API_KEY: 'k' }, { system: 'S', docs: DOCS, question: 'q' }), /答えられませんでした/);
    globalThis.fetch = async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'x' }] }), { status: 200 });
    await assert.rejects(askWithDocuments({ ANTHROPIC_API_KEY: 'k' }, { system: 'S', docs: DOCS, question: 'q' }), /途中で切れました/);
  } finally { globalThis.fetch = realFetch; }
});

test('経路：パスワードが必要。状態の API は有無だけを返す', async () => {
  const env = { ...MOCK, DEMO_PASSCODE: 'ためし' };
  const post = (path, body, pass) => worker.fetch(new Request(`https://x.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-demo-pass': encodeURIComponent(pass) } : {}) }, body: JSON.stringify(body) }), env);
  assert.equal((await post('/api/knowledge-own', { docs: DOCS, question: '有給は？' })).status, 401);
  assert.equal((await post('/api/knowledge-own-status', {})).status, 401);
  const st = await (await post('/api/knowledge-own-status', {}, 'ためし')).json();
  assert.deepEqual(st, { ok: true, data: { available: true, maxDocs: 3, maxChars: 50000 } });
  const ans = await (await post('/api/knowledge-own', { docs: DOCS, question: '有給休暇を使うときはいつまでに休暇届を出しますか？' }, 'ためし')).json();
  assert.equal(ans.ok, true);
  assert.equal(ans.data.found, true);
  const big = await post('/api/knowledge-own', { docs: [{ name: 'a', text: 'あ'.repeat(60000) }], question: 'q' }, 'ためし');
  assert.equal(big.status, 400);
});
