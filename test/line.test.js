import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/worker.js';
import { respond } from '../src/demos/line.js';
import {
  verifyLineSignature, readEvents, parseCommand, siteAnswerMessages, innDraftMessages, textMessage, withQuickReply, greeting, TEXT_MAX,
} from '../src/core/line.js';

const SECRET = 'test-channel-secret';
const sign = (body, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');
const ENV = { AI_PROVIDER: 'mock', LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'tok-123' };
const userEvent = (text, userId = 'U1', extra = {}) => ({ type: 'message', replyToken: `rt-${userId}-${text.length}`, source: { type: 'user', userId }, message: { type: 'text', id: '1', text }, ...extra });

test('署名の確認：正しい・違うシークレット・本文を1文字変えた・ヘッダーなし', async () => {
  const body = JSON.stringify({ events: [userEvent('こんにちは')] });
  assert.equal(await verifyLineSignature(SECRET, body, sign(body)), true);
  assert.equal(await verifyLineSignature(SECRET, body, sign(body, 'other')), false);
  assert.equal(await verifyLineSignature(SECRET, `${body} `, sign(body)), false);
  assert.equal(await verifyLineSignature(SECRET, body.replace('こんにちは', 'こんにちわ'), sign(body)), false);
  assert.equal(await verifyLineSignature(SECRET, body, ''), false);
  assert.equal(await verifyLineSignature(SECRET, body, null), false);
  assert.equal(await verifyLineSignature('', body, sign(body, '')), false);
  assert.equal(await verifyLineSignature(SECRET, body, `${sign(body)}x`), false);
  // 日本語の本文も、バイト列のまま確かめる
  const jp = '{"events":[{"message":{"text":"送迎はありますか？😀"}}]}';
  assert.equal(await verifyLineSignature(SECRET, jp, sign(jp)), true);
});

test('イベントの読み取り：友だち追加・文字・文字以外。グループ・ルーム・トークン無しは答えない', () => {
  const body = { events: [
    { type: 'follow', replyToken: 'a', source: { type: 'user', userId: 'U1' } },
    userEvent('料金は？'),
    { type: 'message', replyToken: 'b', source: { type: 'user', userId: 'U1' }, message: { type: 'sticker' } },
    { type: 'message', replyToken: 'c', source: { type: 'group', groupId: 'G', userId: 'U2' }, message: { type: 'text', text: 'x' } },
    { type: 'message', replyToken: 'd', source: { type: 'room', roomId: 'R' }, message: { type: 'text', text: 'x' } },
    { type: 'message', source: { type: 'user', userId: 'U3' }, message: { type: 'text', text: 'x' } },
    { type: 'unfollow', replyToken: 'e', source: { type: 'user', userId: 'U1' } },
    null, 'x',
  ] };
  assert.deepEqual(readEvents(body).map((e) => e.kind), ['follow', 'text', 'other']);
  assert.deepEqual(readEvents({}), []);
  assert.deepEqual(readEvents(null), []);
});

test('切り替えの言葉', () => {
  assert.deepEqual(parseCommand('宿のデモ'), { type: 'mode', mode: 'inn' });
  assert.deepEqual(parseCommand(' ソエギの案内 '), { type: 'mode', mode: 'site' });
  assert.deepEqual(parseCommand('ｈｅｌｐ'), { type: 'help' });
  assert.equal(parseCommand('宿の送迎はありますか'), null);
  assert.equal(parseCommand('料金はいくら？'), null);
});

test('返信の組み立て：札は最後のメッセージに。長い文は切る。# のリンクは出さない。下書きの印を必ず付ける', () => {
  const msgs = withQuickReply([textMessage('a'), textMessage('b')]);
  assert.equal(msgs[0].quickReply, undefined);
  assert.deepEqual(msgs[1].quickReply.items.map((i) => i.action.label), ['宿のデモ', 'ソエギの案内']);
  assert.ok(msgs[1].quickReply.items.every((i) => i.action.label.length <= 20 && i.action.type === 'message'));
  assert.equal(textMessage('あ'.repeat(6000)).text.length, TEXT_MAX);
  assert.equal(withQuickReply(Array(8).fill(textMessage('x'))).length, 5);
  const site = siteAnswerMessages({ answer: '1ヶ月5万円です。', found: true, links: [{ label: '料金', href: 'https://withsoegi.jp/#price' }, { label: '内部', href: '#stay' }], consult: { label: '相談', href: '#contact' } });
  assert.match(site[0].text, /料金\nhttps:\/\/withsoegi\.jp\/#price/);
  assert.doesNotMatch(site[0].text, /#stay|内部/);
  const none = siteAnswerMessages({ answer: 'サイトには載っていません。', found: false, links: [], consult: { label: '無料相談', href: 'https://withsoegi.jp/#contact' } });
  assert.match(none[0].text, /無料相談\nhttps:\/\/withsoegi\.jp\/#contact/);
  const inn = innDraftMessages({ reply: 'Pick-up is free.', needsCheck: [{ point: 'バスの時刻' }], warnings: ['約束の表現を確かめてください。'] });
  assert.match(inn[0].text, /【デモ】これは、宿のスタッフが確認してから送る「下書き」です。/);
  assert.match(inn[0].text, /確かめる点：\n・バスの時刻/);
  assert.match(greeting('DeepSeek')[0].text, /保存しません。答えは外部のAI（DeepSeek）が作ります/);
  assert.match(greeting('DeepSeek')[0].text, /名前や電話番号は送らないでください/);
});

test('応答：あいさつ・モードの切り替えを覚える・質問に答える・文字以外・長すぎ・1日20回', async () => {
  const u = 'Uresp';
  const follow = await respond(ENV, { kind: 'follow', replyToken: 'r', userId: u });
  assert.match(follow[0].text, /ソエギのデモです/);
  assert.equal(follow.at(-1).quickReply.items.length, 2);
  // 何も選んでいないときは「ソエギの案内」
  const a = await respond(ENV, { kind: 'text', replyToken: 'r', userId: u, text: '料金はいくら？' });
  assert.equal(a[0].type, 'text');
  assert.ok(a.at(-1).quickReply);
  // 宿のデモに切り替える → 下書き
  const set = await respond(ENV, { kind: 'text', replyToken: 'r', userId: u, text: '宿のデモ' });
  assert.match(set[0].text, /宿のデモ/);
  const b = await respond(ENV, { kind: 'text', replyToken: 'r', userId: u, text: 'Do you have a pick-up service? Yamagata Station' });
  assert.match(b[0].text, /Pick-up|pick-up/);
  assert.match(b[0].text, /下書き/);
  // 別の人は、別のモード
  const other = await respond(ENV, { kind: 'text', replyToken: 'r', userId: 'Uother', text: '料金はいくら？' });
  assert.doesNotMatch(other[0].text, /下書き/);
  assert.match((await respond(ENV, { kind: 'other', replyToken: 'r', userId: u }))[0].text, /文字でお送りください/);
  assert.match((await respond(ENV, { kind: 'text', replyToken: 'r', userId: u, text: 'あ'.repeat(301) }))[0].text, /300文字まで/);
  // 1人1日20回：切り替えと、長すぎ・文字以外は数えない。21回目で上限
  const v = 'Ulimit';
  for (let i = 0; i < 20; i += 1) assert.doesNotMatch((await respond(ENV, { kind: 'text', replyToken: 'r', userId: v, text: `質問${i}` }))[0].text, /本日の質問は20回まで/);
  assert.match((await respond(ENV, { kind: 'text', replyToken: 'r', userId: v, text: '質問21' }))[0].text, /本日の質問は20回まで/);
  assert.match((await respond(ENV, { kind: 'text', replyToken: 'r', userId: v, text: 'ソエギの案内' }))[0].text, /モードを「ソエギの案内」/);
});

test('AI が失敗したら「うまく答えられませんでした」（本文は返さない）', async () => {
  const bad = { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: '' };
  const r = await respond(bad, { kind: 'text', replyToken: 'r', userId: 'Ufail', text: '料金は？' });
  assert.match(r[0].text, /うまく答えられませんでした/);
  assert.ok(r.at(-1).quickReply);
});

test('/line/webhook：署名が違えば401、合えば200を先に返し、返信は応答メッセージだけ（トークン・Bearer）', async () => {
  const sent = []; const waits = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), init, body: JSON.parse(init.body) }); return new Response('{}', { status: 200 }); };
  const ctx = { waitUntil: (p) => waits.push(p) };
  const post = (body, sig, env = ENV) => worker.fetch(new Request('https://x.test/line/webhook', { method: 'POST', headers: { 'x-line-signature': sig, 'content-type': 'application/json' }, body }), env, ctx);
  try {
    const body = JSON.stringify({ destination: 'Uxxx', events: [userEvent('料金はいくら？', 'Uhook'), { type: 'follow', replyToken: 'rt-follow', source: { type: 'user', userId: 'Uhook2' } }, { type: 'message', replyToken: 'rt-g', source: { type: 'group', groupId: 'G' }, message: { type: 'text', text: 'x' } }] });
    assert.equal((await post(body, 'bad')).status, 401);
    assert.equal((await post(body, sign(body, 'wrong'))).status, 401);
    assert.equal((await post(`${body} `, sign(body))).status, 401);
    assert.equal(sent.length, 0); // 署名が合わないものには、何も送らない
    const ok = await post(body, sign(body));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    await Promise.all(waits);
    assert.equal(sent.length, 2); // グループは答えない
    for (const s of sent) {
      assert.equal(s.url, 'https://api.line.me/v2/bot/message/reply');
      assert.equal(s.init.headers.authorization, 'Bearer tok-123');
      assert.ok(s.body.messages.length >= 1 && s.body.messages.length <= 5);
      assert.ok(s.body.messages.every((m) => m.type === 'text' && m.text.length <= TEXT_MAX));
    }
    assert.deepEqual(sent.map((s) => s.body.replyToken).sort(), ['rt-Uhook-7', 'rt-follow']);
    // 設定が無ければ503・GET は405・本文が壊れていれば400（署名は合う）
    assert.equal((await post(body, sign(body), { AI_PROVIDER: 'mock' })).status, 503);
    assert.equal((await worker.fetch(new Request('https://x.test/line/webhook'), ENV, ctx)).status, 405);
    const broken = '{"events": [';
    assert.equal((await post(broken, sign(broken))).status, 400);
    // 確認用の空のイベント（LINE の「Verify」）も 200
    const empty = JSON.stringify({ destination: 'Uxxx', events: [] });
    assert.equal((await post(empty, sign(empty))).status, 200);
  } finally { globalThis.fetch = realFetch; }
});
