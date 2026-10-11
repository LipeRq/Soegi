// レシート → Excel。様式は3つ：標準（明細／科目別の集計／要確認）、仕訳の形、〇〇会計事務所様式（例）。
import { worstLevel, levelOf, isValidDate } from './receipt-check.js';
import { COLORS, fill, styleHeader, toExcelDate, DISCLAIMER } from './xlsx-common.js';

const UNSET = '（未選択）';
const LEVEL_FILL = { red: COLORS.red, yellow: COLORS.yellow };

const accountOf = (r) => r.account || UNSET;
const memoOf = (r) => [r.payee, r.summary].filter(Boolean).join(' ');
const reviewText = (c) => c.flags.map((f) => f.message).join('／');

function paint(cell, flags, field) {
  const lv = levelOf(flags, field);
  if (lv) cell.fill = fill(LEVEL_FILL[lv]);
}

function setDate(cell, iso) {
  if (isValidDate(iso)) { cell.value = toExcelDate(iso); cell.numFmt = 'yyyy/mm/dd'; } else cell.value = iso || '';
}

/**
 * @param ExcelJS ExcelJS本体
 * @param rows 確認済みの行（receipt.js の行モデル）
 * @param checks checkReceipts の結果（rows と同じ並び）
 * @param opts {style:'standard'|'journal'|'office', creditAccount:string}
 */
export function buildReceiptWorkbook(ExcelJS, rows, checks, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ソエギ デモ';
  if (opts.style === 'journal') addJournal(wb, rows, checks, opts.creditAccount || '現金');
  else if (opts.style === 'office') addOffice(wb, rows, checks, opts.creditAccount || '現金');
  else addStandard(wb, rows, checks);
  addReview(wb, rows, checks);
  return wb;
}

function addStandard(wb, rows, checks) {
  const ws = wb.addWorksheet('明細', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = [
    ['No', 6], ['日付', 12], ['支払先', 24], ['合計（税込）', 13], ['10%対象（税込）', 14], ['8%対象（税込）', 14],
    ['消費税額', 11], ['登録番号', 18], ['支払方法', 11], ['品目', 24], ['勘定科目', 15], ['科目の理由', 30],
    ['要確認', 40], ['画像ファイル名', 22],
  ];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  styleHeader(ws.getRow(1));
  rows.forEach((r, i) => {
    const c = checks[i];
    const row = ws.addRow([
      i + 1, null, r.payee, r.total ?? '', r.amount10 ?? '', r.amount8 ?? '', r.tax ?? '',
      r.invoiceNo, r.payment, r.summary, accountOf(r), r.reason, reviewText(c), r.filename,
    ]);
    setDate(row.getCell(2), r.date);
    for (const col of [4, 5, 6, 7]) row.getCell(col).numFmt = '#,##0';
    paint(row.getCell(2), c.flags, 'date');
    paint(row.getCell(3), c.flags, 'payee');
    paint(row.getCell(4), c.flags, 'total');
    paint(row.getCell(5), c.flags, 'amount10');
    paint(row.getCell(6), c.flags, 'amount8');
    paint(row.getCell(8), c.flags, 'invoiceNo');
    paint(row.getCell(11), c.flags, 'account');
    const lv = worstLevel(c.flags);
    if (lv) row.getCell(13).fill = fill(LEVEL_FILL[lv]);
    row.getCell(13).alignment = { wrapText: true, vertical: 'top' };
  });
  ws.autoFilter = { from: 'A1', to: `N${Math.max(rows.length + 1, 2)}` };

  // 科目別の集計（明細を参照する数式。結果も入れておく）
  const sum = wb.addWorksheet('科目別の集計');
  sum.columns = [{ header: '勘定科目', width: 20 }, { header: '件数', width: 8 }, { header: '合計（税込）', width: 15 }];
  styleHeader(sum.getRow(1));
  const used = [];
  for (const r of rows) if (!used.includes(accountOf(r))) used.push(accountOf(r));
  const last = rows.length + 1;
  used.forEach((acc, i) => {
    const matched = rows.filter((r) => accountOf(r) === acc);
    const rowNo = i + 2;
    const row = sum.addRow([acc, null, null]);
    row.getCell(2).value = { formula: `COUNTIF('明細'!$K$2:$K$${last},A${rowNo})`, result: matched.length };
    row.getCell(3).value = { formula: `SUMIF('明細'!$K$2:$K$${last},A${rowNo},'明細'!$D$2:$D$${last})`, result: matched.reduce((t, r) => t + (r.total || 0), 0) };
    row.getCell(3).numFmt = '#,##0';
  });
  const totalRow = sum.addRow(['合計', null, null]);
  const n = used.length + 1;
  totalRow.getCell(2).value = { formula: `SUM(B2:B${n})`, result: rows.length };
  totalRow.getCell(3).value = { formula: `SUM(C2:C${n})`, result: rows.reduce((t, r) => t + (r.total || 0), 0) };
  totalRow.getCell(3).numFmt = '#,##0';
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => { cell.fill = fill(COLORS.gray); });
  sum.addRow([]);
  sum.addRow(['※ 勘定科目はAIの候補を人が確認したものです。最終的な判断は税理士・経理担当者が行ってください。']);
  sum.addRow([DISCLAIMER]);
}

function addJournal(wb, rows, checks, credit) {
  const ws = wb.addWorksheet('仕訳', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '日付', width: 12 }, { header: '借方科目', width: 18 }, { header: '貸方科目', width: 14 },
    { header: '金額', width: 12 }, { header: '摘要', width: 44 },
  ];
  styleHeader(ws.getRow(1));
  rows.forEach((r, i) => {
    const c = checks[i];
    const row = ws.addRow([null, accountOf(r), credit, r.total ?? '', memoOf(r)]);
    setDate(row.getCell(1), r.date);
    row.getCell(4).numFmt = '#,##0';
    paint(row.getCell(1), c.flags, 'date');
    paint(row.getCell(2), c.flags, 'account');
    paint(row.getCell(4), c.flags, 'total');
    paint(row.getCell(5), c.flags, 'payee');
  });
  ws.autoFilter = { from: 'A1', to: `E${Math.max(rows.length + 1, 2)}` };
  ws.addRow([]);
  ws.addRow(['※ 色付きのセルは要確認です（詳細は「要確認」シート）。借方科目はAIの候補を人が確認したものです。']);
  ws.addRow([DISCLAIMER]);
}

/**
 * 税区分ごとの行に分ける（10%と8%が混ざったレシートは2行）。内訳が無ければ合計を10%として1行。
 * 内訳が合計と合わないレシートは、分けずに合計で1行（要確認の色が付く）。
 */
export function splitByTax(r) {
  const has10 = Number.isFinite(r.amount10); const has8 = Number.isFinite(r.amount8);
  const total = Number.isFinite(r.total) ? r.total : null;
  const sumOk = total != null && (r.amount10 || 0) + (r.amount8 || 0) === total;
  if ((has10 || has8) && sumOk) {
    const out = [];
    if (r.amount10) out.push({ tax: '課税仕入 10%', amount: r.amount10 });
    if (r.amount8) out.push({ tax: '課税仕入 8%（軽減）', amount: r.amount8 });
    if (out.length) return out;
  }
  return [{ tax: has8 && !has10 ? '課税仕入 8%（軽減）' : '課税仕入 10%', amount: total ?? '' }];
}

// 架空の会計事務所の取り込み様式（例）。実際の導入では、事務所の様式に列を合わせる
function addOffice(wb, rows, checks, credit) {
  const ws = wb.addWorksheet('取込用', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '伝票日付', width: 12 }, { header: '借方勘定科目', width: 16 }, { header: '借方税区分', width: 18 },
    { header: '借方金額', width: 12 }, { header: '貸方勘定科目', width: 14 }, { header: '貸方金額', width: 12 },
    { header: '摘要', width: 36 }, { header: '登録番号', width: 18 }, { header: '証憑No.', width: 10 },
  ];
  styleHeader(ws.getRow(1));
  rows.forEach((r, i) => {
    const c = checks[i];
    for (const part of splitByTax(r)) {
      const row = ws.addRow([null, accountOf(r), part.tax, part.amount, credit, part.amount, memoOf(r), r.invoiceNo || '', `R-${String(i + 1).padStart(3, '0')}`]);
      setDate(row.getCell(1), r.date);
      row.getCell(4).numFmt = '#,##0'; row.getCell(6).numFmt = '#,##0';
      paint(row.getCell(1), c.flags, 'date');
      paint(row.getCell(2), c.flags, 'account');
      paint(row.getCell(4), c.flags, 'total');
      paint(row.getCell(8), c.flags, 'invoiceNo');
    }
  });
  ws.autoFilter = { from: 'A1', to: `I${Math.max(ws.rowCount, 2)}` };
  ws.addRow([]);
  ws.addRow(['※ 〇〇会計事務所様式は架空の例です。お試し導入では、御社・事務所でお使いの様式の列に合わせます。']);
  ws.addRow(['※ 10%と8%が混ざったレシートは、税区分ごとに行を分けています。証憑No.はレシートの通し番号です。']);
  ws.addRow([DISCLAIMER]);
}

function addReview(wb, rows, checks) {
  const ws = wb.addWorksheet('要確認');
  ws.columns = [
    { header: 'No', width: 6 }, { header: '日付', width: 12 }, { header: '支払先', width: 24 },
    { header: '合計（税込）', width: 13 }, { header: '指摘内容', width: 60 }, { header: '画像ファイル名', width: 22 },
  ];
  styleHeader(ws.getRow(1));
  let count = 0;
  rows.forEach((r, i) => {
    const c = checks[i];
    if (!c.flags.length) return;
    count++;
    const row = ws.addRow([i + 1, null, r.payee, r.total ?? '', reviewText(c), r.filename]);
    setDate(row.getCell(2), r.date);
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(5).fill = fill(LEVEL_FILL[worstLevel(c.flags)]);
  });
  if (!count) ws.addRow(['', '', '要確認の行はありません']);
  ws.addRow([]);
  ws.addRow(['※ 電子帳簿保存法のスキャナ保存の要件を満たす仕組みではありません。原本の保存は今までどおりお願いします。']);
}
