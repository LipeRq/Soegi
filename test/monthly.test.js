import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toNumber, addMonths, readSales, latestClosedMonth, calcMonthly, yenShort, pct, share, monthsOf } from '../public/js/monthly-calc.js';
import { buildFacts, fixedLines, renderComment, mergeLines } from '../public/js/monthly-comment.js';
import { decodeCsvBytes, parseCsv } from '../public/js/csv.js';
import { validateMonthlyComment } from '../src/schemas.js';
import { monthlyComment } from '../src/demos/monthly.js';
import worker from '../src/worker.js';

const MOCK = { AI_PROVIDER: 'mock' };
const MAP = { date: 0, customer: 1, product: 2, qty: 3, amount: 4 };
const rec = (date, customer, product, qty, amount) => ({ date, ym: date.slice(0, 7), customer, product, qty, amount });

test('数の読み取り：円・カンマ・全角・△▲・かっこ・読めないもの', () => {
  assert.equal(toNumber('1,200'), 1200);
  assert.equal(toNumber('¥1,200円'), 1200);
  assert.equal(toNumber('１２００'), 1200);
  assert.equal(toNumber('△500'), -500);
  assert.equal(toNumber('▲500'), -500);
  assert.equal(toNumber('(500)'), -500);
  assert.equal(toNumber('-500'), -500);
  assert.equal(toNumber('12.5'), 12.5);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('1e3'), null);
  assert.equal(toNumber(7), 7);
});

test('月の計算・読み込み：読めない行は理由つきで外す', () => {
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-09', -12), '2025-09');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  const rows = [['日付', '顧客', '商品', '数量', '金額'], ['2026/9/1', 'A社', 'ジャム', '10', '¥5,000'], ['', '', '', '', ''], ['明日', 'A社', 'ジャム', '1', '100'], ['2026-09-02', 'B社', '', '', '1,000'], ['2026-09-03', 'A社', 'ジャム', '1', 'いくら']];
  const { records, errors } = readSales(rows, MAP);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1], { date: '2026-09-02', ym: '2026-09', customer: 'B社', product: '（商品なし）', qty: null, amount: 1000 });
  assert.deepEqual(errors.map((e) => [e.row, e.message.slice(0, 8)]), [[4, '日付を読めません'], [6, '金額を読めません']]);
});

test('締まった月：今月より前で、データのある最新の月', () => {
  const r = [rec('2026-08-31', 'a', 'p', 1, 1), rec('2026-09-15', 'a', 'p', 1, 1), rec('2026-10-02', 'a', 'p', 1, 1)];
  assert.equal(latestClosedMonth(r, '2026-10-23'), '2026-09');
  assert.equal(latestClosedMonth(r, '2026-11-01'), '2026-10');
  assert.equal(latestClosedMonth(r, '2026-08-10'), null);
  assert.deepEqual(monthsOf(r), ['2026-10', '2026-09', '2026-08']);
});

test('合計・前月比・前年同月比・構成比・伸びた落ちた・件数・平均単価（手で計算した小さな例）', () => {
  const r = [
    rec('2025-09-10', 'A社', '商品X', 10, 1000), rec('2025-09-11', 'B社', '商品Y', 10, 3000),
    rec('2026-08-10', 'A社', '商品X', 10, 2000),
    rec('2026-09-05', 'A社', '商品X', 10, 4000), rec('2026-09-06', 'C社', '商品Z', 5, 1000), rec('2026-09-07', 'A社', '商品X', 10, 1000),
  ];
  const c = calcMonthly(r, '2026-09');
  assert.equal(c.total, 6000);
  assert.equal(c.count, 3);
  assert.equal(c.qty, 25);
  assert.equal(c.avgUnit, 240); // 6000 ÷ 25
  assert.deepEqual([c.prev.total, c.prev.diff, c.prev.pct], [2000, 4000, 2]);
  assert.deepEqual([c.yoy.total, c.yoy.diff, c.yoy.pct], [4000, 2000, 0.5]);
  assert.deepEqual(c.customers.top.map((x) => [x.name, x.amount, x.share]), [['A社', 5000, 5000 / 6000], ['C社', 1000, 1000 / 6000]]);
  assert.equal(c.customers.rest, 0);
  // 伸びた・落ちた（前年同月との差）：A社 +4000、C社 +1000（新規）、B社 −3000（取引なし）
  assert.deepEqual(c.customerMovers.risers.map((x) => [x.name, x.diff, x.isNew]), [['A社', 4000, false], ['C社', 1000, true]]);
  assert.deepEqual(c.customerMovers.fallers.map((x) => [x.name, x.diff, x.isLost]), [['B社', -3000, true]]);
  assert.equal(c.customerMovers.risers[0].pct, 4); // 1000 → 5000
  assert.equal(c.customerMovers.risers[1].pct, null); // 前年が0
  // 直近12か月：データの無い月は null（0にしない）。前年と並べる
  assert.equal(c.series12.length, 12);
  assert.deepEqual(c.series12.at(-1), { ym: '2026-09', thisYear: 6000, prevYear: 4000 });
  assert.deepEqual(c.series12.at(-2), { ym: '2026-08', thisYear: 2000, prevYear: null });
  assert.equal(c.series12[0].thisYear, null);
});

test('前年が無い月：前年同月比・伸びた落ちたは出さない（0 や 100% にしない）。前月が無い月も', () => {
  const r = [rec('2026-09-05', 'A社', 'X', 10, 4000)];
  const c = calcMonthly(r, '2026-09');
  assert.equal(c.yoy, null); assert.equal(c.prev, null);
  assert.equal(c.customerMovers, null);
  assert.equal(calcMonthly(r, '2026-08'), null);
  assert.equal(pct(null), '—');
  // 前月の合計が0以下のときは、割合を出さない
  const z = calcMonthly([rec('2026-08-05', 'A社', 'X', 1, 0), rec('2026-09-05', 'A社', 'X', 1, 100)], '2026-09');
  assert.equal(z.prev.pct, null);
});

test('上位5つと「その他」。数量が無い行は平均単価に入れない。返品（負）も合計に入る', () => {
  const r = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n, i) => rec('2026-09-01', `${n}社`, 'P', i === 0 ? null : 1, (7 - i) * 100));
  r.push(rec('2026-09-02', 'a社', 'P', 1, -50));
  const c = calcMonthly(r, '2026-09');
  assert.equal(c.total, 2750);
  assert.deepEqual(c.customers.top.map((x) => x.name), ['a社', 'b社', 'c社', 'd社', 'e社']);
  assert.equal(c.customers.top[0].amount, 650);
  assert.equal(c.customers.rest, 300); assert.equal(c.customers.restCount, 2);
  assert.equal(c.qty, 7); // 数量のある行だけ
  assert.equal(c.avgUnit, (2750 - 700) / 7);
});

test('表示：万円・％・構成比', () => {
  assert.equal(yenShort(1234567), '123.5万円');
  assert.equal(yenShort(30000), '3万円');
  assert.equal(yenShort(9800), '9,800円');
  assert.equal(yenShort(250_000_000), '2.5億円');
  assert.equal(pct(0.1234), '＋12.3%');
  assert.equal(pct(-0.05), '－5.0%');
  assert.equal(share(0.4567), '45.7%');
});

// ---- 見本のCSV：わざと入れた動きが、数字に出る ----------------------------------------------------

const SALES = parseCsv(decodeCsvBytes(readFileSync('public/samples/monthly/sales-sample.csv')));
const sales = () => readSales(SALES, { date: 0, customer: 1, product: 2, qty: 3, amount: 4 });

test('見本の売上CSV：読めて、24か月あり、既定は最新の締まった月（2026年9月）', () => {
  const { records, errors } = sales();
  assert.deepEqual(errors, []);
  assert.ok(records.length > 1000);
  assert.equal(monthsOf(records).length, 24);
  assert.equal(latestClosedMonth(records, '2026-10-23'), '2026-09');
});

test('見本の売上CSV：落ちた取引先・伸びた取引先・伸びた商品・落ちた商品が、2026年9月の数字に出る', () => {
  const c = calcMonthly(sales().records, '2026-09');
  assert.ok(c.yoy && c.prev);
  assert.equal(c.customerMovers.fallers[0].name, '月山ストア(仮)');
  assert.equal(c.customerMovers.fallers[0].isLost, true); // 2026年4月からは注文なし
  assert.equal(c.customerMovers.risers[0].name, '温泉旅館みずき(仮)');
  assert.ok(c.customerMovers.risers[0].pct > 1); // 前年同月（取引が始まったばかり）の2倍以上
  assert.equal(c.customers.top.length, 4); // この月に売上のあった顧客
  const shares = c.customers.top.reduce((t, x) => t + x.share, 0) + c.customers.restShare;
  assert.ok(Math.abs(shares - 1) < 1e-9);
  // 12月は、ギフトが山になる（季節の波）
  const dec = calcMonthly(sales().records, '2025-12');
  assert.match(dec.products.top[0].name, /ギフトセット/);
  assert.ok(dec.total > calcMonthly(sales().records, '2025-02').total);
  // 伸びた商品（2026年3月：ドライフルーツミックスが前年の約3.5倍で最も伸びた）
  const m = calcMonthly(sales().records, '2026-03');
  assert.equal(m.productMovers.risers[0].name, 'ドライフルーツミックス 80g');
  assert.ok(m.productMovers.risers[0].pct > 2);
});

// ---- コメント：AIの文に数字を書かせない -------------------------------------------------------------

test('事実の一覧：値のある事実だけ。番号は f1 から', () => {
  const c = calcMonthly(sales().records, '2026-09');
  const facts = buildFacts(c);
  assert.equal(facts[0].id, 'f1');
  assert.deepEqual(facts.slice(0, 2).map((f) => f.label), ['対象の月', '売上合計']);
  assert.ok(facts.some((f) => f.label === '前年同月比'));
  const lone = buildFacts(calcMonthly([rec('2026-09-05', 'A社', 'X', 10, 4000)], '2026-09'));
  assert.ok(!lone.some((f) => f.label === '前年同月比' || f.label === '前月比' || /伸びた|落ちた/.test(f.label)));
  assert.equal(new Set(facts.map((f) => f.id)).size, facts.length);
});

test('コメントの検査：番号を値に埋める。数字が残る・存在しない番号・原因の言い切り・空は捨てる', () => {
  const facts = [{ id: 'f1', label: '対象の月', value: '2026年9月' }, { id: 'f2', label: '前年同月比', value: '＋12.3%' }];
  const ok = renderComment(['{f1}の売上は前年同月比で{f2}でした。', '季節の動きの可能性があります。'], facts);
  assert.deepEqual(ok.lines, ['2026年9月の売上は前年同月比で＋12.3%でした。', '季節の動きの可能性があります。']);
  assert.deepEqual(ok.dropped, []);
  const bad = renderComment(['売上は12%増えました。', '売上は１２％増えました。', '{f9}でした。', '雨が原因です。', '', 'のためです', '{f1}の{f2}'], facts);
  assert.deepEqual(bad.lines.slice(0, 3), [null, null, null]);
  assert.deepEqual(bad.dropped.map((d) => d.reason), ['数字が残っている', '数字が残っている', '事実に無い番号']);
  assert.equal(renderComment('x', facts).lines.length, 0);
  // 番号を値に埋めたあとの数字は、検査しない（値はプログラムのもの）
  assert.equal(renderComment(['{f2}'], facts).lines[0], '＋12.3%');
  // 3行にそろえる：AIの行が使えなければ、同じ位置の決まった文
  assert.deepEqual(mergeLines(['AI一', null, 'AI三'], ['固一', '固二', '固三']), [{ text: 'AI一', source: 'ai' }, { text: '固二', source: 'fixed' }, { text: 'AI三', source: 'ai' }]);
  assert.deepEqual(mergeLines([], ['固一', '固二']), [{ text: '固一', source: 'fixed' }, { text: '固二', source: 'fixed' }]);
});

test('決まった文：数字はプログラムが埋める。前年が無いときは、言える範囲だけ', () => {
  const c = calcMonthly(sales().records, '2026-09');
  const lines = fixedLines(c);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^2026年9月の売上は.+万円で、前年同月より(増え|減り)ました（[＋－]\d+\.\d%）。$/);
  assert.ok(lines[2].includes('月山ストア(仮)') && lines[2].includes('温泉旅館みずき(仮)'));
  const lone = fixedLines(calcMonthly([rec('2026-09-05', 'A社', 'X', 10, 4000)], '2026-09'));
  assert.match(lone[0], /比べる月のデータがありません/);
  assert.match(lone[2], /伸びた・落ちた所は出せません/);
});

test('サーバー：AIのコメントは数字を埋めてから返す（mock）。事実の入力を検証する。パスワード必須', async () => {
  const c = calcMonthly(sales().records, '2026-09');
  const facts = buildFacts(c);
  const out = await monthlyComment(MOCK, { facts });
  assert.equal(out.lines.length, 3);
  assert.deepEqual(out.dropped, []);
  assert.ok(out.lines.every((l) => l && !/\{f\d+\}/.test(l)));
  assert.match(out.lines[0], /2026年9月の売上は前年同月比で[＋－]\d+\.\d%でした/);
  await assert.rejects(monthlyComment(MOCK, { facts: [] }), (e) => e.status === 400);
  await assert.rejects(monthlyComment(MOCK, { facts: [{ id: 'x1', label: 'a', value: 'b' }] }), (e) => e.status === 400);
  await assert.rejects(monthlyComment(MOCK, { facts: [{ id: 'f1', label: 'a', value: 'b' }, { id: 'f1', label: 'a', value: 'b' }] }), (e) => e.status === 400);
  await assert.rejects(monthlyComment(MOCK, { facts: Array.from({ length: 31 }, (_, i) => ({ id: `f${i}`, label: 'a', value: 'b' })) }), (e) => e.status === 400);
  assert.throws(() => validateMonthlyComment('x'), /schema/);
  const env = { ...MOCK, DEMO_PASSCODE: 'ためし' };
  const post = (pass) => worker.fetch(new Request('https://x.test/api/monthly-comment', { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-demo-pass': encodeURIComponent(pass) } : {}) }, body: JSON.stringify({ facts }) }), env);
  assert.equal((await post('')).status, 401);
  assert.equal((await post('ためし')).status, 200);
});
