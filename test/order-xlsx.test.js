import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { checkOrder } from '../public/js/order-check.js';
import { orderRows, buildOrderWorkbook, orderCsv, orderCsvBlob, safeText, ORDER_COLUMNS } from '../public/js/order-xlsx.js';

const master = JSON.parse(readFileSync(new URL('../public/data/products.json', import.meta.url), 'utf8'));
const today = '2027-01-12';
const line = (over) => ({ name: 'ラ・フランスジャム', spec: '150g', qty: 24, unit: '個', unitPrice: null, amount: null, conf: {}, ...over });
const orders = [
  {
    filename: 'order-yamabiko.jpg', customer: 'やまびこスーパー（仮） 仕入部 御中', orderDate: '2027年1月12日', deliveryDate: '2027年1月19日', conf: {},
    lines: [line(), line({ name: 'さくらんぼジャム', spec: '150g', qty: 2, unit: 'ケース' }), line({ name: '山ぶどうジャム', qty: 12 }), line({ name: 'もも ジャム', spec: '', qty: 6 })],
  },
  {
    filename: 'order-gassan.jpg', customer: '月山ストア（仮）', orderDate: '2027/01/13', deliveryDate: '', conf: {},
    lines: [line({ name: 'りんごジュース', spec: '1L', qty: 12, unit: '本', unitPrice: 650, amount: 7500 })],
  },
];
const build = () => { const checks = orders.map((o) => checkOrder(o, master, today)); return orderRows(orders, checks, master); };

async function roundTrip(wb) {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await wb.xlsx.writeBuffer());
  return out;
}

test('出力の行：決まった商品だけコードを入れ、ケースは個数に直す', () => {
  const rows = build();
  assert.equal(rows.length, 5);
  const [a, b, c, d, e] = rows;
  assert.equal(a.orderNo, 'O-01');
  assert.equal(a.customerCode, 'C-01');
  assert.equal(a.orderDate, '2027-01-12');
  assert.equal(a.productCode, 'J-101');
  assert.equal(a.price, 430); assert.equal(a.priceFrom, 'マスタ'); assert.equal(a.amount, 24 * 430);
  assert.equal(a.level, null);
  assert.equal(b.productCode, 'J-102');
  assert.equal(b.pieces, 48); // 2ケース × 24個
  assert.equal(b.level, 'yellow');
  assert.equal(c.productCode, ''); // 未登録
  assert.equal(c.name, '山ぶどうジャム');
  assert.match(c.review, /未登録/);
  // 似ているだけの候補は、コード・マスタの単価を入れない（人が選ぶまで）
  assert.equal(d.productCode, '');
  assert.equal(d.name, 'もも ジャム');
  assert.equal(d.price, null);
  assert.equal(d.amount, null);
  assert.match(d.review, /表記ゆれの候補/);
  // 納品日が空・金額が合わない → 赤
  assert.equal(e.orderNo, 'O-02');
  assert.equal(e.level, 'red');
  assert.equal(e.fieldLevels.deliveryDate, 'red');
  assert.equal(e.fieldLevels.amount, 'red');
  assert.equal(e.priceFrom, '注文書');
});

test('人が候補を選ぶと、コードと単価が入る', () => {
  const o = structuredClone(orders);
  Object.assign(o[0].lines[3], { productCode: 'J-105', confirmed: true });
  const rows = orderRows(o, o.map((x) => checkOrder(x, master, today)), master);
  assert.equal(rows[3].productCode, 'J-105');
  assert.ok(rows[3].price > 0);
  assert.doesNotMatch(rows[3].review, /表記ゆれ/);
});

test('Excel：受注一覧・取引先別・納品日別・要確認', async () => {
  const rows = build();
  const wb = await roundTrip(buildOrderWorkbook(ExcelJS, rows));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['受注一覧', '取引先別', '納品日別', '要確認']);
  const ws = wb.getWorksheet('受注一覧');
  assert.deepEqual(ws.getRow(1).values.slice(1), ORDER_COLUMNS.map(([h]) => h));
  assert.equal(ws.rowCount, rows.length + 1);
  assert.equal(ws.getCell('F2').value, 'J-101');
  assert.ok(ws.getCell('D2').value instanceof Date);
  assert.equal(ws.getCell('E6').value, ''); // 納品日が空
  assert.equal(ws.getCell('E6').fill?.fgColor?.argb, 'FFF6C9C4'); // 赤
  assert.equal(ws.getCell('K3').value, 48);
  const cust = wb.getWorksheet('取引先別');
  assert.equal(cust.getCell('A2').value, 'やまびこスーパー（仮）');
  assert.match(cust.getCell('B2').value.formula, /^COUNTIF\('受注一覧'!\$C\$2:\$C\$6,A2\)$/);
  assert.equal(cust.getCell('B2').value.result, 4);
  assert.match(cust.getCell('C2').value.formula, /^SUMIF\(/);
  const day = wb.getWorksheet('納品日別');
  const labels = []; day.eachRow((r, n) => { if (n > 1) labels.push(r.getCell(1).value); });
  assert.ok(labels.includes('（納品日なし）'));
  const rev = wb.getWorksheet('要確認');
  assert.equal(rev.getCell('A2').value, 'O-01');
  let text = ''; rev.eachRow((r) => { text += `${r.getCell(1).value}\n`; });
  assert.match(text, /AIは注文書を読むだけ/);
});

test('CSV：見出し・CRLF・引用符・式にならない', () => {
  const rows = build();
  rows[0].customer = '=HYPERLINK("http://example.invalid")';
  rows[1].name = 'ジャム, 大';
  const csv = orderCsv(rows);
  const lines = csv.split('\r\n');
  assert.equal(lines[0].split(',')[0], '受注No');
  assert.equal(lines.at(-1), ''); // 最後も改行
  assert.ok(lines[1].includes(`"'=HYPERLINK(""http://example.invalid"")"`));
  assert.ok(lines[2].includes('"ジャム, 大"'));
  assert.ok(lines[1].includes('2027/01/12'));
  assert.equal(safeText('-1'), "'-1");
  assert.equal(safeText('@a'), "'@a");
  assert.equal(safeText('a=b'), 'a=b');
});

test('CSV：UTF-8 は BOM 付き、Shift_JIS は変換できない文字を知らせる', async () => {
  const rows = build();
  const u = orderCsvBlob(rows, 'utf8');
  const ub = new Uint8Array(await u.blob.arrayBuffer());
  assert.deepEqual([...ub.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const s = orderCsvBlob(rows, 'sjis');
  const sb = new Uint8Array(await s.blob.arrayBuffer());
  assert.equal(new TextDecoder('shift_jis').decode(sb), orderCsv(rows));
  assert.deepEqual(s.unmappable, []);
  rows[0].name = '🍐ジャム';
  assert.ok(orderCsvBlob(rows, 'sjis').unmappable.length > 0);
});
