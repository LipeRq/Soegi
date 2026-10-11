import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildReceiptWorkbook, splitByTax } from '../public/js/receipt-xlsx.js';
import { buildAttendanceWorkbook } from '../public/js/attendance-xlsx.js';
import { checkReceipts } from '../public/js/receipt-check.js';
import { calculate, DEFAULT_SETTINGS } from '../public/js/overtime.js';

const rows = [
  { filename: 'IMG_1.jpg', date: '2026-10-01', payee: 'さくら文具店', total: 1980, amount10: 1980, amount8: null, tax: 180, invoiceNo: 'T1234567890123', payment: '現金', summary: '用紙', account: '事務用品費', reason: '文具', conf: {} },
  { filename: 'IMG_2.jpg', date: '2026-10-02', payee: 'みどり食堂', total: 1760, amount10: 1000, amount8: 500, tax: 130, invoiceNo: 'T12', payment: '現金', summary: '定食', account: '', reason: '', conf: {} },
];
const today = new Date(2026, 9, 7);

// ExcelJS は時刻書式のセルを Date で返すので、「日」単位の数値に戻す
const days = (v) => (v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : v);

async function roundTrip(wb) {
  const buf = await wb.xlsx.writeBuffer();
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buf);
  return out;
}

test('レシート標準様式：明細・科目別の集計・要確認が出て、赤セルが付く', async () => {
  const wb = await roundTrip(buildReceiptWorkbook(ExcelJS, rows, checkReceipts(rows, today), { style: 'standard' }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['明細', '科目別の集計', '要確認']);
  const d = wb.getWorksheet('明細');
  assert.equal(d.getCell('C2').value, 'さくら文具店');
  assert.equal(d.getCell('K3').value, '（未選択）');
  assert.ok(d.getCell('D3').fill?.fgColor?.argb); // 合計不一致の赤
  assert.match(String(d.getCell('M3').value), /登録番号/);
  const s = wb.getWorksheet('科目別の集計');
  assert.equal(s.getCell('B2').value.formula.includes('COUNTIF'), true);
  assert.equal(s.getCell('C4').value.result, 3740);
  const r = wb.getWorksheet('要確認');
  assert.equal(r.getCell('A2').value, 2); // 2行目のレシートだけ
  assert.equal(r.rowCount >= 2, true);
});

test('レシート仕訳様式：日付・借方・貸方・金額・摘要', async () => {
  const wb = await roundTrip(buildReceiptWorkbook(ExcelJS, rows, checkReceipts(rows, today), { style: 'journal', creditAccount: '未払金' }));
  const j = wb.getWorksheet('仕訳');
  assert.deepEqual([1, 2, 3, 4, 5].map((c) => j.getRow(1).getCell(c).value), ['日付', '借方科目', '貸方科目', '金額', '摘要']);
  assert.equal(j.getCell('B2').value, '事務用品費');
  assert.equal(j.getCell('C2').value, '未払金');
  assert.equal(j.getCell('D2').value, 1980);
  assert.equal(j.getCell('E2').value, 'さくら文具店 用紙');
});

test('残業の集計：一覧・人ごとの日別・設定', async () => {
  const recs = [
    { name: '青木 一郎', date: '2026-09-01', start: '9:00', end: '20:00', breakMin: 60 },
    { name: '伊藤/花子', date: '2026-09-06', start: '22:00', end: '07:00', breakMin: 60 },
  ];
  const res = calculate(recs);
  const wb = await roundTrip(buildAttendanceWorkbook(ExcelJS, res.periods[0], DEFAULT_SETTINGS));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['一覧', '伊藤_花子', '青木 一郎', '使った設定']);
  const list = wb.getWorksheet('一覧');
  assert.equal(list.getCell('A3').value, '伊藤/花子'); // 法定休日の出勤が多い順
  assert.equal(list.getCell('A4').value, '青木 一郎');
  assert.ok(Math.abs(days(list.getCell('D4').value) - 120 / 1440) < 1e-9);
  const day = wb.getWorksheet('青木 一郎');
  assert.ok(Math.abs(days(day.getCell('G2').value) - 120 / 1440) < 1e-9);
  assert.ok(Math.abs(days(day.getCell('G3').value.result) - 120 / 1440) < 1e-9);
});

test('レシート事務所様式（例）：10%と8%が混ざったレシートは2行に分ける', async () => {
  const mixed = [{ ...rows[0], total: 1100, amount10: 400, amount8: 700 }, rows[1]];
  assert.deepEqual(splitByTax(mixed[0]).map((p) => p.amount), [400, 700]);
  assert.deepEqual(splitByTax(rows[1]).map((p) => p.amount), [1760]); // 内訳が合わない→分けない
  const wb = await roundTrip(buildReceiptWorkbook(ExcelJS, mixed, checkReceipts(mixed, today), { style: 'office' }));
  const ws = wb.getWorksheet('取込用');
  assert.equal(ws.getCell('C2').value, '課税仕入 10%');
  assert.equal(ws.getCell('C3').value, '課税仕入 8%（軽減）');
  assert.equal(ws.getCell('D3').value, 700);
  assert.equal(ws.getCell('I3').value, 'R-001');
  assert.equal(ws.getCell('I4').value, 'R-002');
  assert.ok(wb.getWorksheet('要確認'));
});
