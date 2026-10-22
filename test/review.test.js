import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finalizeInnReview, findNames, MUST_CHECK_TEXT } from '../src/core/review.js';
import { validateInnReview } from '../src/schemas.js';
import { innReview } from '../src/demos/inn.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'));
const inn = load('yukiakari.json');
const examples = load('review-examples.json');
const MOCK = { AI_PROVIDER: 'mock' };
const v = (over = {}) => validateInnReview({
  language: 'ja', review_ja: '', reply: 'ご意見をありがとうございます。', reply_ja: 'ご意見をありがとうございます。', points: [], needs_check: [], used_info_ids: [], ...over,
});
const fin = (text, stars, over) => finalizeInnReview(inn, v({ review_ja: text, ...over }), text, stars);
const points = (r) => r.needsCheck.map((n) => n.point);

test('星1〜2は「必ず責任者が確認」（先頭に固定の文）。星3以上は出さない', () => {
  for (const s of [1, 2]) {
    const r = fin('部屋が寒かった', s);
    assert.equal(r.mustCheck, true);
    assert.equal(r.mustCheckText, MUST_CHECK_TEXT);
    assert.equal(r.needsCheck[0].point, '責任者による確認');
    assert.equal(r.needsCheck[0].source, 'rule');
  }
  for (const s of [3, 4, 5]) assert.equal(fin('部屋が寒かった', s).mustCheck, false);
});

test('返金・補償の求め：日・英・中・韓の決まった語で「返金・補償は宿が決める」', () => {
  for (const t of ['宿泊料を返金してほしい', 'I want a refund.', 'Please compensate us.', '請退款給我們', '환불해 주세요', '補償してください']) {
    assert.ok(points(fin(t, 3)).includes('返金・補償は宿が決める'), t);
  }
  assert.ok(!points(fin('とても良い宿でした', 5)).includes('返金・補償は宿が決める'));
});

test('人名らしいもの：さん・様・Mr.・Ms.・小姐・씨・님 →「返信に名前を書かない」。「お客様」は名前にしない', () => {
  assert.deepEqual(findNames('田中さんが親切でした'), ['田中']);
  assert.deepEqual(findNames('Ms. Tanaka was kind. Mr Smith too.'), ['Tanaka', 'Smith']);
  assert.deepEqual(findNames('王小姐很親切'), ['王']);
  assert.deepEqual(findNames('김철수 씨가 친절했어요. 박영희님도요'), ['김철수', '박영희']);
  assert.deepEqual(findNames('お客様のご意見。皆様ありがとう。ご家族様'), []);
  const r = fin('', 5, { review_ja: '田中さんの説明が丁寧でした' });
  assert.ok(points(r).includes('返信に名前を書かない'));
  assert.match(r.needsCheck.find((n) => n.point === '返信に名前を書かない').reason, /田中/);
});

test('レビューで直したこと：名前の切り出し・呼びかけの除外・英字の名前・大文字小文字・単語の途中', () => {
  assert.deepEqual(findNames('フロントの田中さんに感謝。親切な佐藤さんも'), ['田中', '佐藤']);
  assert.deepEqual(findNames('スタッフの皆様ありがとう。神様、店長さん、運転手さん、宿泊者様、担当者様、奥様'), []);
  assert.deepEqual(findNames('タナカさんが親切'), ['タナカ']);
  assert.deepEqual(findNames('Mr.Smith, MR. SMITH, Mr. O\'Brien, Mr. Müller, Mr. José, Sato-san'), ['Smith', 'SMITH', "O'Brien", 'Müller', 'José', 'Sato']);
  assert.deepEqual(findNames('날씨가 좋았어요. 선생님 감사합니다. 사장님. 손님. 마음씨 좋은 솜씨'), []);
  assert.deepEqual(findNames('這位先生很親切。櫃檯小姐很親切。老先生'), []);
  assert.deepEqual(findNames('感謝王小姐的協助'), ['謝王']);
  // 返信に入っているか：大文字小文字を区別しない。単語の途中は数えない。中国語は「王小姐」も
  const w = (review, reply) => fin('', 5, { review_ja: review, reply, reply_ja: 'ありがとうございます。' }).warnings.filter((x) => /人名/.test(x)).length;
  assert.equal(w('Ms. Tanaka was kind', 'Dear TANAKA, thanks'), 1);
  assert.equal(w('Mr. Li was kind', 'We are little sorry, Lighting'), 0);
  assert.equal(w('Ms. An was kind', 'Another thank you'), 0);
  assert.equal(w('感謝王小姐的協助', '感謝您，王小姐會很開心'), 1);
});

test('レビューで直したこと：返金・補償の抜けと誤検出、返信側の見張り、反論・料金の語', () => {
  for (const t of ['宿泊代を返してください', '全額返してほしい', '請退錢', '请退钱', '要求赔偿', '돈을 돌려주세요', 'Ｒｅｆｕｎｄ please', 'I want my money returned', 'Please give us a free night']) {
    assert.ok(points(fin(t, 3)).includes('返金・補償は宿が決める'), t);
  }
  for (const t of ['宿泊料が安くて返事も早い', '宿泊料もお得で無料の送迎もありがたい']) assert.ok(!points(fin(t, 5)).includes('返金・補償は宿が決める'), t);
  assert.ok(fin('部屋が寒かった', 3, { reply_ja: '宿泊料を全額返金いたします。' }).warnings.some((x) => /返金・補償に関わる言葉/.test(x)));
  for (const t of ['そのようなことはございません。', '事実とは異なります。', '当館に非はありません。', '規約により対応できません。', 'お客様の過失です。']) assert.ok(fin('x', 3, { reply_ja: t }).warnings.some((x) => /反論・言い訳・断定/.test(x)), t);
  for (const t of ['誤解を招いてしまい申し訳ございません。', '当館では、至らない点があり、申し訳ございません。', 'やむを得ず対応が遅れましたことをお詫びします']) assert.ok(!fin('x', 3, { reply_ja: t }).warnings.some((x) => /反論・言い訳・断定/.test(x)), t);
  for (const t of ['1万円です', '500元', 'TWD 500', 'booking.com で予約', 'info@yukiakari.jp', '€50']) assert.ok(fin('x', 3, { reply_ja: t }).warnings.some((x) => /URLや料金/.test(x)), t);
  assert.deepEqual(fin('x', 3, { reply_ja: '12月1日からのご宿泊をお待ちしております。' }).warnings, []);
});

test('星は整数の 1〜5 の数だけ（文字列・真偽値・配列は受けない）', async () => {
  for (const stars of ['3', true, [3], 0x3 + 0.5, 6]) await assert.rejects(innReview(MOCK, { text: 'x', stars }, '1.2.3.4'), (e) => e.status === 400, String(stars));
});

test('口コミの人名が下書きにも入っていれば警告する', () => {
  const r = fin('', 5, { review_ja: 'Ms. Tanaka explained so well', reply: 'Thank you, Tanaka will be glad.', reply_ja: 'ありがとうございます。' });
  assert.ok(r.warnings.some((w) => /Tanaka/.test(w) && /返信から名前を消して/.test(w)));
  assert.equal(fin('', 5, { review_ja: 'Ms. Tanaka explained so well' }).warnings.length, 0);
});

test('下書きの見直し：反論・言い訳・断定、URL・料金', () => {
  for (const t of ['しかし当館では、そのようなことはありません。', '規定では対応できません。', 'そのような事実はありません。', 'お客様の誤解です。', '仕方がありません。']) {
    assert.ok(fin('x', 3, { reply_ja: t }).warnings.some((w) => /反論・言い訳・断定/.test(w)), t);
  }
  assert.ok(fin('x', 3, { reply: 'See https://example.com' }).warnings.some((w) => /URLや料金/.test(w)));
  assert.ok(fin('x', 3, { reply_ja: '宿泊料金は8,000円です' }).warnings.some((w) => /URLや料金/.test(w)));
  assert.deepEqual(fin('x', 3, { reply_ja: 'ご意見をありがとうございます。状況を確認します。' }).warnings, []);
});

test('AIの挙げた要確認は足す。同じ点は重ねない。宿の情報に無い id は外す', () => {
  const r = fin('お風呂がぬるい', 2, { needs_check: [{ point: '大浴場の温度', reason: '事実か' }, { point: '責任者による確認', reason: 'x' }], used_info_ids: ['bath', 'nope'] });
  assert.equal(points(r).filter((p) => p === '責任者による確認').length, 1);
  assert.ok(points(r).includes('大浴場の温度'));
  assert.deepEqual(r.usedInfo.map((u) => u.id), ['bath']);
  assert.ok(r.warnings.some((w) => /宿の情報に無い項目/.test(w)));
});

test('検証：返信が空なら失敗。指摘の種類が不正なら不満にする。長さを切る', () => {
  assert.throws(() => validateInnReview({ language: 'ja', review_ja: 'x', reply: '', reply_ja: 'y', points: [], needs_check: [], used_info_ids: [] }), /schema/);
  const out = validateInnReview({ language: 'ja', review_ja: 'x', reply: 'a', reply_ja: 'b', points: [{ kind: 'weird', text: 't' }, { kind: 'praise', text: '' }] });
  assert.deepEqual(out.points, [{ kind: 'complaint', text: 't' }]);
});

test('例文3つ：星2に「必ず責任者が確認」、英語の例に「返信に名前を書かない」、キャッシュで同じ結果', async () => {
  assert.deepEqual(examples.map((e) => e.stars), [2, 5, 3]);
  for (const ex of examples) {
    const a = await innReview(MOCK, { exampleId: ex.id }, '1.2.3.4');
    const b = await innReview(MOCK, { exampleId: ex.id }, '1.2.3.4');
    assert.equal(b.cached, true);
    assert.equal(a.reply, b.reply);
    assert.equal(a.stars, ex.stars);
    assert.ok(a.reply && a.replyJa && a.reviewJa && a.points.length, ex.id);
  }
  const zh = await innReview(MOCK, { exampleId: 'zh-bath' }, '1.2.3.4');
  assert.equal(zh.mustCheck, true);
  assert.equal(zh.mustCheckText, MUST_CHECK_TEXT);
  assert.equal(zh.needsCheck[0].point, '責任者による確認');
  assert.deepEqual(zh.warnings, []);
  const en = await innReview(MOCK, { exampleId: 'en-juhyo' }, '1.2.3.4');
  assert.equal(en.mustCheck, false);
  assert.ok(en.needsCheck.some((n) => n.point === '返信に名前を書かない' && n.source === 'rule'));
  assert.deepEqual(en.warnings, []); // モックの下書きには、口コミの人名（Tanaka）が入っていない
  const ja = await innReview(MOCK, { exampleId: 'ja-dinner' }, '1.2.3.4');
  assert.deepEqual(ja.warnings, []);
  assert.ok(ja.needsCheck.some((n) => /夕食/.test(n.point)));
});

test('自由入力：星の数・文字数・Turnstile', async () => {
  await assert.rejects(innReview(MOCK, { text: 'x', stars: 0 }, '1.2.3.4'), (e) => e.status === 400);
  await assert.rejects(innReview(MOCK, { text: 'x', stars: 2.5 }, '1.2.3.4'), (e) => e.status === 400);
  await assert.rejects(innReview(MOCK, { text: '', stars: 3 }, '1.2.3.4'), (e) => e.status === 400);
  await assert.rejects(innReview(MOCK, { text: 'a'.repeat(1001), stars: 3 }, '1.2.3.4'), (e) => e.status === 400);
  await assert.rejects(innReview(MOCK, { text: 'Nice', stars: 3 }, '1.2.3.4'), (e) => e.status === 503);
  await assert.rejects(innReview(MOCK, { exampleId: 'nope' }, '1.2.3.4'), (e) => e.status === 404);
});
