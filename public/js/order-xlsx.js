// 受注データの出力：Excel（受注一覧・取引先別・納品日別・要確認）と CSV（UTF-8／Shift_JIS）。
// 中身は order-check.js の照合結果から作る（AIの答えをそのまま出さない）。
import { COLORS, fill, styleHeader, toExcelDate, DISCLAIMER } from './xlsx-common.js';
import { worst } from './order-check.js';
import { encodeSjis } from './sjis.js';

const LEVEL_FILL = { red: COLORS.red, yellow: COLORS.yellow };

export const ORDER_COLUMNS = [
  ['受注No', 9], ['取引先コード', 11], ['取引先', 22], ['発注日', 12], ['納品日', 12], ['商品コード', 10], ['品名', 26], ['規格', 9],
  ['数量', 8], ['単位', 7], ['個数（バラ）', 11], ['単価', 10], ['単価の出どころ', 12], ['金額', 12], ['注文書の品名（読んだまま）', 26], ['要確認', 44], ['注文書の画像', 22],
];

/**
 * 画面の注文書と照合結果から、出力する行を作る。
 * @param orders 画面の注文書（order.js の形）
 * @param checks checkOrder の結果（orders と同じ並び）
 */
export function orderRows(orders, checks, master) {
  const custByCode = new Map(master.customers.map((c) => [c.code, c]));
  const out = [];
  orders.forEach((o, i) => {
    const c = checks[i];
    const cust = custByCode.get(c.customer.code);
    const headerMsg = c.header.flags.map((f) => f.message);
    const orderNo = `O-${String(i + 1).padStart(2, '0')}`;
    // 明細の無い注文書（読み取れなかったなど）も、黙って抜かず「要確認」の1行にする
    if (!o.lines.length) {
      out.push({
        orderNo, customerCode: cust?.code ?? '', customer: cust?.name ?? o.customer ?? '', orderDate: c.orderDate ?? '', deliveryDate: c.deliveryDate ?? '',
        productCode: '', name: '', spec: '', qty: null, unit: '', pieces: null, price: null, priceFrom: '', amount: null, readName: '',
        review: o.error ? `注文書を読み取れませんでした（${o.error}）` : ['明細がありません', ...headerMsg].join('／'),
        image: o.filename, level: 'red', fieldLevels: {},
      });
      return;
    }
    o.lines.forEach((l, k) => {
      const r = c.lines[k];
      // 候補のまま（人が選んでいない）の商品は、コード・マスタの単価・ケースの換算を入れない
      const p = r.settled ? r.product : null;
      const fromSheet = r.priceFrom === '注文書';
      const flags = [...c.header.flags, ...r.flags];
      out.push({
        orderNo,
        customerCode: cust?.code ?? '',
        customer: cust?.name ?? o.customer,
        orderDate: c.orderDate ?? '',
        deliveryDate: c.deliveryDate ?? '',
        productCode: p?.code ?? '',
        name: p?.name ?? l.name,
        spec: p?.spec ?? l.spec,
        qty: Number.isFinite(l.qty) ? l.qty : null,
        unit: l.unit || p?.unit || '',
        // 候補のままなら、ケースの換算（候補の入数）は使わない
        pieces: p || r.perUnit === 1 ? r.pieces : null,
        price: p || fromSheet ? r.price : null,
        priceFrom: p || fromSheet ? r.priceFrom : '',
        amount: p || typeof l.amount === 'number' ? r.amount : null,
        readName: [l.name, l.spec].filter(Boolean).join(' '),
        review: [...headerMsg, ...r.flags.map((f) => f.message)].join('／'),
        image: o.filename,
        level: worst(flags),
        fieldLevels: {
          customer: worst(c.header.flags.filter((f) => f.field === 'customer')),
          deliveryDate: worst(c.header.flags.filter((f) => f.field === 'deliveryDate')),
          name: worst(r.flags.filter((f) => f.field === 'name')),
          qty: worst(r.flags.filter((f) => f.field === 'qty' || f.field === 'unit')),
          price: worst(r.flags.filter((f) => f.field === 'unitPrice')),
          amount: worst(r.flags.filter((f) => f.field === 'amount')),
        },
      });
    });
  });
  return out;
}

const dateCell = (cell, iso) => { if (iso) { cell.value = toExcelDate(iso); cell.numFmt = 'yyyy/mm/dd'; } else cell.value = null; };

export function buildOrderWorkbook(ExcelJS, rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ソエギ デモ';
  const ws = wb.addWorksheet('受注一覧', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = ORDER_COLUMNS.map(([header, width]) => ({ header, width }));
  styleHeader(ws.getRow(1));
  for (const r of rows) {
    // 数の無いマスは空のまま（'' を入れると、集計の数式で文字として扱われる）
    const row = ws.addRow([r.orderNo, r.customerCode, r.customer, null, null, r.productCode, r.name, r.spec, r.qty, r.unit, r.pieces, r.price, r.priceFrom, r.amount, r.readName, r.review, r.image]);
    dateCell(row.getCell(4), r.orderDate);
    dateCell(row.getCell(5), r.deliveryDate);
    // 3桁区切りは整数だけ（小数の数量 2.5 を「3」と見せない）
    for (const n of [9, 11, 12, 14]) if (Number.isInteger(row.getCell(n).value)) row.getCell(n).numFmt = '#,##0';
    const paint = (n, lv) => { if (lv) row.getCell(n).fill = fill(LEVEL_FILL[lv]); };
    paint(3, r.fieldLevels.customer); paint(5, r.fieldLevels.deliveryDate); paint(7, r.fieldLevels.name);
    paint(9, r.fieldLevels.qty); paint(12, r.fieldLevels.price); paint(14, r.fieldLevels.amount);
    if (r.level) row.getCell(16).fill = fill(LEVEL_FILL[r.level]);
    row.getCell(16).alignment = { wrapText: true, vertical: 'top' };
  }
  const last = rows.length + 1;
  ws.autoFilter = { from: 'A1', to: `Q${Math.max(last, 2)}` };

  // 集計の数式は SUMPRODUCT の「=」で比べる（COUNTIF・SUMIF は * ? を文字の代わりとして読むため、品名・取引先名で数がずれる）
  const R = (col) => `'受注一覧'!$${col}$2:$${col}$${Math.max(last, 2)}`;

  // 取引先別（受注一覧を参照する数式。結果も入れておく）
  const byCust = wb.addWorksheet('取引先別');
  byCust.columns = [{ header: '取引先', width: 26 }, { header: '明細の行数', width: 11 }, { header: '金額の合計', width: 14 }];
  styleHeader(byCust.getRow(1));
  const custs = [...new Set(rows.map((r) => r.customer))];
  custs.forEach((name, i) => {
    const n = i + 2;
    const matched = rows.filter((r) => r.customer === name);
    const row = byCust.addRow([name, null, null]);
    row.getCell(2).value = { formula: `SUMPRODUCT(--(${R('C')}=A${n}))`, result: matched.length };
    row.getCell(3).value = { formula: `SUMPRODUCT(--(${R('C')}=A${n}),${R('N')})`, result: matched.reduce((t, r) => t + (r.amount || 0), 0) };
    row.getCell(3).numFmt = '#,##0';
  });

  // 納品日別：納品日×商品の個数（バラ）。商品マスタに無い品は品名で分ける。
  // 個数に直せない明細（単位が分からない・候補のままのケース）は 0 として足さず、行数を隣に出して黄にする
  const byDay = wb.addWorksheet('納品日別');
  byDay.columns = [{ header: '納品日', width: 12 }, { header: '商品コード', width: 11 }, { header: '品名', width: 28 }, { header: '個数（バラ）の合計', width: 16 }, { header: '個数に直せない明細', width: 18 }];
  styleHeader(byDay.getRow(1));
  const keys = [];
  for (const r of rows) {
    if (!r.name && !r.productCode) continue; // 明細の無い注文書の行は、商品の集計に入れない
    const k = `${r.deliveryDate}|${r.productCode}|${r.name}`;
    if (!keys.some((x) => x.k === k)) keys.push({ k, r });
  }
  keys.sort((a, b) => (a.r.deliveryDate || '9999').localeCompare(b.r.deliveryDate || '9999') || a.k.localeCompare(b.k));
  keys.forEach(({ r }, i) => {
    const n = i + 2;
    const same = rows.filter((x) => x.deliveryDate === r.deliveryDate && x.productCode === r.productCode && x.name === r.name);
    const row = byDay.addRow([null, r.productCode || null, r.name, null, null]);
    if (r.deliveryDate) dateCell(row.getCell(1), r.deliveryDate); else { row.getCell(1).value = '（納品日なし）'; row.getCell(1).fill = fill(COLORS.red); }
    const cond = `(${R('E')}=${r.deliveryDate ? `A${n}` : '""'})*(${R('F')}=B${n})*(${R('G')}=C${n})`;
    row.getCell(4).value = { formula: `SUMPRODUCT(${cond},${R('K')})`, result: same.reduce((t, x) => t + (x.pieces || 0), 0) };
    row.getCell(4).numFmt = '#,##0';
    const unknown = same.filter((x) => x.pieces == null).length;
    row.getCell(5).value = { formula: `SUMPRODUCT(${cond}*(${R('K')}=""))`, result: unknown };
    if (unknown) { row.getCell(4).fill = fill(COLORS.yellow); row.getCell(5).fill = fill(COLORS.yellow); }
  });
  byDay.addRow([]);
  byDay.addRow(['※「個数に直せない明細」が1以上の行は、合計にその明細が入っていません。「要確認」のシートを見てください。']);

  // 要確認の行だけ
  const rev = wb.addWorksheet('要確認');
  rev.columns = [{ header: '受注No', width: 9 }, { header: '取引先', width: 24 }, { header: '注文書の品名', width: 26 }, { header: '指摘', width: 64 }, { header: '注文書の画像', width: 22 }];
  styleHeader(rev.getRow(1));
  const flagged = rows.filter((r) => r.level);
  for (const r of flagged) {
    const row = rev.addRow([r.orderNo, r.customer, r.readName, r.review, r.image]);
    row.getCell(4).fill = fill(LEVEL_FILL[r.level]);
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
  }
  if (!flagged.length) rev.addRow(['', '', '要確認の行はありません']);
  rev.addRow([]);
  rev.addRow(['※ 商品の照合・数量の検算・納品日の確認はプログラムが行い、AIは注文書を読むだけです。最後は人が確かめてください。']);
  rev.addRow([DISCLAIMER]);
  return wb;
}

// ---- CSV ---------------------------------------------------------------------------

const CSV_COLUMNS = ['受注No', '取引先コード', '取引先', '発注日', '納品日', '商品コード', '品名', '規格', '数量', '単位', '個数（バラ）', '単価', '金額', '要確認'];

/** Excel で開いたときに式として動く値を、文字として扱わせる（先頭に ' を付ける） */
export const safeText = (v) => (/^[=+\-@\t\r]/.test(String(v)) ? `'${v}` : String(v));
const csvCell = (v, text) => {
  if (v == null || v === '') return '';
  const s = text ? safeText(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function orderCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      [r.orderNo, true], [r.customerCode, true], [r.customer, true], [r.orderDate.replace(/-/g, '/'), false], [r.deliveryDate.replace(/-/g, '/'), false],
      [r.productCode, true], [r.name, true], [r.spec, true], [r.qty, false], [r.unit, true], [r.pieces, false], [r.price, false], [r.amount, false], [r.review, true],
    ].map(([v, t]) => csvCell(v, t)).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** @returns {{blob: Blob, unmappable: string[]}} encoding：'utf8'（BOM付き）か 'sjis' */
export function orderCsvBlob(rows, encoding) {
  const text = orderCsv(rows);
  if (encoding === 'sjis') {
    const { bytes, unmappable } = encodeSjis(text);
    return { blob: new Blob([bytes], { type: 'text/csv;charset=shift_jis' }), unmappable: [...new Set(unmappable)] };
  }
  return { blob: new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }), unmappable: [] };
}
