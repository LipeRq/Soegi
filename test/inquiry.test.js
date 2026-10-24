import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInquiry, inquiryBody, rawMail, inquiry, INQUIRY_PER_DAY } from '../src/demos/inquiry.js';
import worker from '../src/worker.js';

const day = (n) => new Date(Date.now() + 9 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const OK = { name: '山田 太郎', company: '山田工務店', phone: '090-1234-5678', email: 'taro@example.com', method: 'visit', slots: [{ date: day(3), time: 'am' }, { date: day(5), time: 'pm' }], note: '見積書づくりに毎日1時間かかっています', agree: true };

function fakeEnv(extra = {}) {
  const sent = [];
  class EM { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }
  return { sent, env: { MAIL: { send: async (m) => { sent.push(m); } }, INQUIRY_TO: 'owner@example.com', __EmailMessage: EM, ...extra } };
}
const decodeBody = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf-8');

test('入力の検証：必須・形・日付の範囲・同意', () => {
  const d = validateInquiry(OK);
  assert.equal(d.name, '山田 太郎'); assert.equal(d.slots.length, 2); assert.equal(d.method, 'visit');
  for (const bad of [{ ...OK, name: '' }, { ...OK, phone: '', email: '' }, { ...OK, phone: 'abc' }, { ...OK, email: 'a@b' }, { ...OK, agree: false },
    { ...OK, slots: [{ date: day(0), time: 'am' }] }, { ...OK, slots: [{ date: day(60), time: 'am' }] }, { ...OK, slots: [{ date: '2026-13-45', time: 'am' }] }]) {
    assert.throws(() => validateInquiry(bad), (e) => e.status === 400, JSON.stringify(bad).slice(0, 60));
  }
  // 日程は任意。方法・時間帯の不正な値は既定に直す。4つ目以降は捨てる
  const d2 = validateInquiry({ ...OK, slots: [], method: 'x' });
  assert.deepEqual(d2.slots, []); assert.equal(d2.method, 'online');
  assert.equal(validateInquiry({ ...OK, slots: [{ date: day(2), time: 'zz' }, {}, { date: day(3) }, { date: day(4) }] }).slots.length, 2);
  // 電話だけ・メールだけ、どちらでもよい
  assert.ok(validateInquiry({ ...OK, email: '' })); assert.ok(validateInquiry({ ...OK, phone: '' }));
  // 隠し欄に何か入っていたらロボット
  assert.equal(validateInquiry({ ...OK, website: 'http://spam' }), null);
});

test('メール：本文に希望日時が曜日つきで入り、ヘッダーに改行を混ぜられない', () => {
  const body = inquiryBody(validateInquiry(OK));
  assert.match(body, /お名前：山田 太郎/); assert.match(body, /第1希望　\d{4}\/\d{2}\/\d{2}（[日月火水木金土]） 午前（9〜12時）/); assert.match(body, /第2希望.*夕方/);
  assert.match(inquiryBody(validateInquiry({ ...OK, slots: [] })), /こちらからご連絡して決めます/);
  const evil = validateInquiry({ ...OK, name: '山田\r\nBcc: x@evil.example', company: 'A\nSubject: hacked' });
  assert.ok(!/[\r\n]/.test(evil.name) && !/[\r\n]/.test(evil.company));
  const raw = rawMail({ from: 'inquiry@withsoegi.jp', to: 'owner@example.com', replyTo: 'taro@example.com', subject: '件名', text: inquiryBody(evil) });
  const head = raw.split('\r\n\r\n')[0];
  assert.ok(!/^Bcc:/mi.test(head) && !/^Subject: hacked/mi.test(head));
  assert.match(head, /^Reply-To: taro@example\.com$/m); assert.match(head, /^Content-Transfer-Encoding: base64$/m);
  assert.match(decodeBody(raw), /お名前：山田 Bcc: x@evil\.example/);
});

test('送信：メールを1通送る。送り先が未設定・送信失敗・1日の上限・ロボットの扱い', async () => {
  const { env, sent } = fakeEnv();
  assert.deepEqual(await inquiry(env, OK, '1.1.1.1'), { sent: true });
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'owner@example.com'); assert.equal(sent[0].from, 'inquiry@withsoegi.jp');
  assert.match(decodeBody(sent[0].raw), /山田工務店/);
  // 送り先が無い・メールの仕組みが無い → 電話に案内
  await assert.rejects(inquiry({ ...env, INQUIRY_TO: '' }, OK, '1.1.1.2'), (e) => e.status === 503 && /080-9018-2777/.test(e.message));
  await assert.rejects(inquiry({ INQUIRY_TO: 'o@e.com' }, OK, '1.1.1.2'), (e) => e.status === 503);
  // 送信失敗 → 502（成功とは言わない）
  const bad = { ...env, MAIL: { send: async () => { throw new Error('boom'); } } };
  await assert.rejects(inquiry(bad, OK, '1.1.1.3'), (e) => e.status === 502 && /お電話/.test(e.message));
  // ロボット：送らずに成功のふり
  const n = sent.length;
  assert.deepEqual(await inquiry(env, { ...OK, website: 'x' }, '1.1.1.4'), { sent: true }); assert.equal(sent.length, n);
  // 1日の上限
  for (let i = 0; i < INQUIRY_PER_DAY; i += 1) await inquiry(env, OK, '9.9.9.9');
  await assert.rejects(inquiry(env, OK, '9.9.9.9'), (e) => e.status === 429);
});

test('API：withsoegi.jp からだけ呼べる（CORS）。パスワードは要らない。入力が大きすぎれば断る', async () => {
  const { env, sent } = fakeEnv();
  const post = (body, origin = 'https://withsoegi.jp') => worker.fetch(new Request('https://demo.withsoegi.jp/api/inquiry', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }), env);
  const pre = await worker.fetch(new Request('https://demo.withsoegi.jp/api/inquiry', { method: 'OPTIONS', headers: { origin: 'https://withsoegi.jp' } }), env);
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://withsoegi.jp');
  const r = await post(OK);
  assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), 'https://withsoegi.jp'); assert.equal((await r.json()).data.sent, true); assert.equal(sent.length, 1);
  const other = await post(OK, 'https://evil.example');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  assert.equal((await post({ ...OK, note: 'あ'.repeat(9000) })).status, 413);
});
