import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normText, normSpec, dice, matchProduct, matchCustomer, parseOrderDate, checkOrder, worst, levelAt } from '../public/js/order-check.js';

const master = JSON.parse(readFileSync(new URL('../public/data/products.json', import.meta.url), 'utf8'));
const P = master.products;
const today = '2026-12-01';
const line = (over) => ({ name: 'ラ・フランスジャム', spec: '150g', qty: 24, unit: '個', unitPrice: null, amount: null, conf: {}, ...over });
const order = (over) => ({ customer: 'やまびこスーパー（仮） 仕入部 御中', orderDate: '2027-01-12', deliveryDate: '2027-01-19', conf: {}, lines: [line()], ...over });

test('表記をそろえる', () => {
  assert.equal(normText('ラ・フランス ジャム'), normText('ラフランスジャム'));
  assert.equal(normText('ﾗ･ﾌﾗﾝｽｼﾞｬﾑ'), normText('ラフランスジャム'));
  assert.equal(normText('やまびこスーパー（仮）仕入部 御中'), 'やまびこスーパー');
  assert.equal(normSpec('150グラム'), '150g');
  assert.equal(normSpec('１５０ｇ'), '150g');
  assert.equal(normSpec('1キロ'), '1kg');
  assert.ok(dice('もものジャム', 'ももジャム') >= 0.6);
});

test('商品の照合：一致・表記ゆれ・似ている・規格なし・未登録', () => {
  assert.equal(matchProduct({ name: 'ラフランスジャム', spec: '150ｇ' }, P).product.code, 'J-101');
  assert.equal(matchProduct({ name: 'ラ・フランスジャム 300g', spec: '' }, P).product.code, 'J-201'); // 規格が品名に入っていても読める
  const alias = matchProduct({ name: '洋梨ジャム', spec: '150g' }, P);
  assert.equal(alias.kind, 'alias');
  assert.equal(alias.product.code, 'J-101');
  const sim = matchProduct({ name: 'もも ジャム', spec: '' }, P);
  assert.equal(sim.kind, 'similar');
  assert.equal(sim.product.code, 'J-105');
  const nospec = matchProduct({ name: 'さくらんぼジャム', spec: '' }, P);
  assert.equal(nospec.kind, 'nospec');
  assert.deepEqual(nospec.candidates.map((p) => p.code), ['J-102', 'J-202']);
  assert.equal(matchProduct({ name: '山ぶどうジャム', spec: '150g' }, P).kind, 'none');
  assert.equal(matchProduct({ name: '', spec: '' }, P).kind, 'empty');
});

test('取引先の照合', () => {
  assert.equal(matchCustomer('月山ストア（仮）御中', master.customers).customer.code, 'C-02');
  assert.equal(matchCustomer('道の駅 さくらんぼの里', master.customers).customer.code, 'C-03');
  assert.equal(matchCustomer('みずき旅館', master.customers).kind, 'similar');
  assert.equal(matchCustomer('知らない商店', master.customers).kind, 'none');
});

test('日付：年が無いときは今日に近い年', () => {
  assert.equal(parseOrderDate('2027/1/20', today), '2027-01-20');
  assert.equal(parseOrderDate('2027年1月20日', today), '2027-01-20');
  assert.equal(parseOrderDate('1/14', '2026-12-01'), '2027-01-14');
  assert.equal(parseOrderDate('11/20', '2026-12-01'), '2026-11-20');
  assert.equal(parseOrderDate('2/30', today), null);
  assert.equal(parseOrderDate('', today), null);
});

test('問題のない注文書は指摘なし', () => {
  const r = checkOrder(order(), master, today);
  assert.deepEqual(r.header.flags, []);
  assert.deepEqual(r.lines[0].flags, []);
  assert.equal(r.customer.code, 'C-01');
  assert.equal(r.lines[0].price, 430);
  assert.equal(r.lines[0].priceFrom, 'マスタ');
  assert.equal(r.lines[0].amount, 24 * 430);
});

test('納品日：空・読めない・過去・発注日より前は赤', () => {
  assert.equal(levelAt(checkOrder(order({ deliveryDate: '' }), master, today).header.flags, 'deliveryDate'), 'red');
  assert.equal(levelAt(checkOrder(order({ deliveryDate: 'きんよう' }), master, today).header.flags, 'deliveryDate'), 'red');
  assert.equal(levelAt(checkOrder(order({ deliveryDate: '2026-11-30' }), master, today).header.flags, 'deliveryDate'), 'red');
  assert.equal(levelAt(checkOrder(order({ deliveryDate: '2027-01-10' }), master, today).header.flags, 'deliveryDate'), 'red');
  assert.equal(levelAt(checkOrder(order({ deliveryDate: '2027-01-19' }), master, today).header.flags, 'deliveryDate'), null);
});

test('数量：空・0・小数・負は赤', () => {
  for (const qty of [null, 0, -3, 2.5]) assert.equal(levelAt(checkOrder(order({ lines: [line({ qty })] }), master, today).lines[0].flags, 'qty'), 'red', String(qty));
});

test('ケースの単位は黄で、個数に直した数を出す。単価はケース単位でマスタと比べる', () => {
  const r = checkOrder(order({ lines: [line({ name: 'さくらんぼジャム', qty: 2, unit: 'ケース', unitPrice: 530 * 24 })] }), master, today).lines[0];
  assert.equal(levelAt(r.flags, 'unit'), 'yellow');
  assert.equal(r.pieces, 48);
  assert.match(r.flags.find((f) => f.field === 'unit').message, /1ケース＝24個。2ケース＝48個/);
  assert.equal(levelAt(r.flags, 'unitPrice'), null);
});

test('単価がマスタと違えば黄、数量×単価≠金額なら赤（検算）', () => {
  const r = checkOrder(order({ lines: [line({ name: 'りんごジュース', spec: '1L', unit: '本', qty: 12, unitPrice: 650, amount: 7500 })] }), master, today).lines[0];
  assert.equal(levelAt(r.flags, 'amount'), 'red');
  assert.match(r.flags.find((f) => f.field === 'amount').message, /7,800円.*7,500円/);
  const p = checkOrder(order({ lines: [line({ name: 'ドライフルーツミックス', spec: '80g', unit: '袋', qty: 30, unitPrice: 650, amount: 19500 })] }), master, today).lines[0];
  assert.equal(levelAt(p.flags, 'unitPrice'), 'yellow');
  assert.equal(levelAt(p.flags, 'amount'), null);
});

test('表記ゆれ・未登録・規格なしは黄。人が選んで確定すると消える', () => {
  const alias = checkOrder(order({ lines: [line({ name: '洋梨ジャム' })] }), master, today).lines[0];
  assert.equal(levelAt(alias.flags, 'name'), 'yellow');
  assert.equal(alias.product.code, 'J-101'); // 候補は入っている
  const fixed = checkOrder(order({ lines: [line({ name: '洋梨ジャム', productCode: 'J-101', confirmed: true })] }), master, today).lines[0];
  assert.equal(levelAt(fixed.flags, 'name'), null);
  const none = checkOrder(order({ lines: [line({ name: '山ぶどうジャム' })] }), master, today).lines[0];
  assert.match(none.flags[0].message, /未登録/);
  assert.equal(none.product, null);
  const nospec = checkOrder(order({ lines: [line({ name: 'さくらんぼジャム', spec: '' })] }), master, today).lines[0];
  assert.match(nospec.flags[0].message, /規格が書かれていません（150g／300g）/);
});

test('取引先がマスタに無い・似ているは黄。同じ商品が2行は黄', () => {
  assert.equal(levelAt(checkOrder(order({ customer: '知らない商店' }), master, today).header.flags, 'customer'), 'yellow');
  const r = checkOrder(order({ lines: [line(), line({ qty: 12 })] }), master, today);
  assert.ok(r.lines.every((l) => levelAt(l.flags, 'row') === 'yellow'));
  assert.equal(worst([]), null);
});

test('確かさ「低」は黄', () => {
  const r = checkOrder(order({ conf: { customer: '低' }, lines: [line({ conf: { qty: '低' } })] }), master, today);
  assert.equal(levelAt(r.header.flags, 'customer'), 'yellow');
  assert.equal(levelAt(r.lines[0].flags, 'qty'), 'yellow');
});

test('レビューの指摘から：規格がマスタに無い・含むだけの取引先・曜日と和暦・遠い月日', () => {
  const bad = matchProduct({ name: 'ラ・フランスジャム', spec: '250g' }, P);
  assert.equal(bad.kind, 'badspec');
  assert.equal(bad.product, null);
  assert.deepEqual(bad.candidates.map((p) => p.code), ['J-101', 'J-201']);
  assert.equal(matchProduct({ name: '洋梨ジャム', spec: '' }, P).kind, 'nospec'); // 表記ゆれが2品に当たり、規格なし
  const r = checkOrder(order({ lines: [line({ spec: '250g' })] }), master, today);
  assert.match(r.lines[0].flags[0].message, /規格（250g）がマスタにありません（150g／300g）/);
  assert.equal(r.lines[0].settled, false);
  // 名前を含むだけの取引先は候補（黄）
  const c = checkOrder(order({ customer: 'やまびこスーパー西店' }), master, today);
  assert.equal(c.customer.code, '');
  assert.equal(levelAt(c.header.flags, 'customer'), 'yellow');
  assert.equal(matchCustomer('やまびこスーパー（仮）御中', master.customers).kind, 'exact');
  // 曜日・和暦・後ろの言葉
  assert.equal(parseOrderDate('1/20(水)', '2027-01-12'), '2027-01-20');
  assert.equal(parseOrderDate('2027年1月19日（火）午前着', today), '2027-01-19');
  assert.equal(parseOrderDate('令和9年1月20日', today), '2027-01-20');
  assert.equal(parseOrderDate('R9.1.20', today), '2027-01-20');
  assert.equal(parseOrderDate('1月20日 水曜日', '2027-01-12'), '2027-01-20');
  // 年の無い日付は、前後半年の中だけ（2/29 が1年先にならない）
  assert.equal(parseOrderDate('2/29', '2027-03-01'), null);
  // 発注日の確かさ「低」は黄
  const o = checkOrder(order({ conf: { order_date: '低' } }), master, today);
  assert.equal(levelAt(o.header.flags, 'orderDate'), 'yellow');
});

test('レビューの指摘から：単位と個数・金額の計算・重複', () => {
  // 決まった商品でケース以外の違う単位 → 個数に直さず、マスタの単価も使わない
  const doz = checkOrder(order({ lines: [line({ qty: 2, unit: 'ダース' })] }), master, today).lines[0];
  assert.equal(doz.pieces, null);
  assert.equal(doz.price, null);
  assert.equal(doz.amount, null);
  assert.equal(levelAt(doz.flags, 'unit'), 'yellow');
  // 商品が決まらない（未登録）でケース → 入数が分からない
  const unk = checkOrder(order({ lines: [line({ name: '山ぶどうジャム', qty: 2, unit: 'ケース' })] }), master, today).lines[0];
  assert.equal(unk.pieces, null);
  assert.match(unk.flags.map((f) => f.message).join(), /ケースの入数が分かりません/);
  // 負・小数の数量では金額を作らない
  for (const qty of [-3, 2.5]) {
    const x = checkOrder(order({ lines: [line({ qty })] }), master, today).lines[0];
    assert.equal(x.amount, null, String(qty));
    assert.equal(levelAt(x.flags, 'qty'), 'red');
  }
  // 金額だけ書かれていて単価が無い → マスタの単価で計算した額と比べる（黄）
  const am = checkOrder(order({ lines: [line({ qty: 24, amount: 9999 })] }), master, today).lines[0];
  assert.equal(levelAt(am.flags, 'amount'), 'yellow');
  assert.equal(checkOrder(order({ lines: [line({ qty: 24, amount: 24 * 430 })] }), master, today).lines[0].flags.length, 0);
  // 重複は、決まった商品どうしだけ
  const dup = checkOrder(order({ lines: [line({ name: 'もも ジャム', spec: '' }), line({ name: 'ももジャム', spec: '' })] }), master, today);
  assert.ok(dup.lines.every((x) => !x.flags.some((f) => f.field === 'row')));
  const dup2 = checkOrder(order({ lines: [line(), line()] }), master, today);
  assert.ok(dup2.lines.every((x) => x.flags.some((f) => f.field === 'row')));
  // 品名が空の行
  assert.match(checkOrder(order({ lines: [line({ name: '', spec: '' })] }), master, today).lines[0].flags[0].message, /品名が空です/);
});
