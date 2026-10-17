// 1週間の記録表（Excel）。お試しの前の1週間、いまの作業を付けてもらう用紙。
// 2枚目「まとめ」に、御社の場合（試算）に入れる数字を数式で出す。何も送らない（画面の中で作る）。
import { COLORS, fill, styleHeader } from './xlsx-common.js';
import { DEMOS } from './estimate.js';

const YESNO = ['はい', 'いいえ'];
const DAYS = 7;
const WEEKS_PER_MONTH = 4.3;

/**
 * デモごとの記録表。cols：見出し・幅・種類（num＝数、list＝選ぶ、text＝文字）。
 * summary：まとめの行。f は数式（列は記録表の列の文字、{rows} は記録する行の範囲）
 */
export const RECORDS = {
  receipt: {
    perDay: 3,
    cols: [
      { header: '枚数', width: 8, type: 'num', sum: true },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
      { header: '手直しした件数', width: 13, type: 'num', sum: true },
      { header: 'メモ', width: 30, type: 'text' },
    ],
    summary: (c) => [
      ['1週間の枚数', `SUM(${c[0]})`, '枚'],
      ['1週間にかかった分', `SUM(${c[1]})`, '分'],
      ['1枚あたりの分（御社の場合の「1枚の手入力にかかる時間」）', `IFERROR(SUM(${c[1]})/SUM(${c[0]}),"")`, '分'],
      ['月に直した枚数（御社の場合の「月の枚数」）', `ROUND(SUM(${c[0]})*${WEEKS_PER_MONTH},0)`, '枚'],
      ['手直しした件数（1週間）', `SUM(${c[2]})`, '件'],
    ],
  },
  attendance: {
    perDay: 3,
    cols: [
      { header: '作業', width: 12, type: 'list', list: ['集計', '確認', '直し'] },
      { header: '人数', width: 8, type: 'num', sum: true },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
      { header: 'メモ', width: 30, type: 'text' },
    ],
    summary: (c) => [
      ['集計にかかった分（1週間）', `SUMIF(${c[0]},"集計",${c[2]})`, '分'],
      ['1人あたりの集計の分（御社の場合の「1人分の手計算」）', `IFERROR(SUMIF(${c[0]},"集計",${c[2]})/SUMIF(${c[0]},"集計",${c[1]}),"")`, '分'],
      ['確認・直しにかかった分（1週間）', `SUMIF(${c[0]},"確認",${c[2]})+SUMIF(${c[0]},"直し",${c[2]})`, '分'],
    ],
  },
  knowledge: {
    perDay: 8,
    cols: [
      { header: '時刻', width: 8, type: 'text' },
      { header: '聞いた人', width: 12, type: 'text' },
      { header: '聞かれた内容', width: 34, type: 'text', count: true },
      { header: '答えた人', width: 12, type: 'text' },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
    ],
    summary: (c) => [
      ['聞かれた回数（1週間）', `COUNTA(${c[2]})`, '回'],
      ['記録した日数', 5, '日'],
      ['1日に聞かれる回数（御社の場合の「1日に聞かれる回数」）', `IFERROR(ROUND(COUNTA(${c[2]})/{days},1),"")`, '回'],
      ['1回の説明の分（御社の場合の「1回の説明にかかる時間」）', `IFERROR(ROUND(AVERAGE(${c[4]}),1),"")`, '分'],
    ],
  },
  foreign: {
    perDay: 6,
    cols: [
      { header: '時刻', width: 8, type: 'text' },
      { header: 'スタッフ', width: 12, type: 'text' },
      { header: '言語', width: 12, type: 'list', list: ['ベトナム語', 'インドネシア語', '英語', '中国語', 'そのほか'] },
      { header: '聞かれた内容', width: 30, type: 'text', count: true },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
      { header: '夜・休日', width: 10, type: 'list', list: YESNO },
    ],
    summary: (c) => [
      ['説明した回数（1週間）', `COUNTA(${c[3]})`, '回'],
      ['説明にかかった分（1週間）', `SUM(${c[4]})`, '分'],
      ['夜・休日の回数', `COUNTIF(${c[5]},"はい")`, '回'],
      ['外国人スタッフの人数', 6, '人'],
      ['記録した日数', 5, '日'],
      ['1人に1日説明している分（御社の場合）', `IFERROR(ROUND(SUM(${c[4]})/{staff}/{days},1),"")`, '分'],
    ],
  },
  inn: {
    perDay: 5,
    cols: [
      { header: '言語', width: 12, type: 'list', list: ['繁体字中国語', '英語', '韓国語', '簡体字中国語', 'そのほか'] },
      { header: '問い合わせの内容', width: 30, type: 'text', count: true },
      { header: '1通の分', width: 9, type: 'num', sum: true },
      { header: '返信までの時間（時間）', width: 14, type: 'num' },
      { header: '予約に至った', width: 11, type: 'list', list: YESNO },
    ],
    summary: (c) => [
      ['外国語の問い合わせ（1週間）', `COUNTA(${c[1]})`, '通'],
      ['月に直した通数（御社の場合の「月の通数」）', `ROUND(COUNTA(${c[1]})*${WEEKS_PER_MONTH},0)`, '通'],
      ['1通の返信の分（御社の場合の「1通の返信にかかる時間」）', `IFERROR(ROUND(AVERAGE(${c[2]}),1),"")`, '分'],
      ['返信までの平均（時間）', `IFERROR(ROUND(AVERAGE(${c[3]}),1),"")`, '時間'],
      ['予約に至った件数', `COUNTIF(${c[4]},"はい")`, '件'],
    ],
  },
  chatbot: {
    perDay: 5,
    cols: [
      { header: '時刻', width: 8, type: 'text' },
      { header: '経路', width: 10, type: 'list', list: ['電話', 'メール', 'フォーム', 'そのほか'] },
      { header: '問い合わせの内容', width: 30, type: 'text', count: true },
      { header: '夜・休日', width: 10, type: 'list', list: YESNO },
      { header: '相談・見積に進んだ', width: 14, type: 'list', list: YESNO },
    ],
    summary: (c) => [
      ['問い合わせ（1週間）', `COUNTA(${c[2]})`, '件'],
      ['夜・休日の件数', `COUNTIF(${c[3]},"はい")`, '件'],
      ['相談・見積に進んだ件数', `COUNTIF(${c[4]},"はい")`, '件'],
      ['電話', `COUNTIF(${c[1]},"電話")`, '件'],
      ['メール', `COUNTIF(${c[1]},"メール")`, '件'],
      ['フォーム', `COUNTIF(${c[1]},"フォーム")`, '件'],
    ],
  },
};

const colLetter = (n) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };

export function buildRecordWorkbook(ExcelJS, key) {
  const rec = RECORDS[key];
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ソエギ';
  const ws = wb.addWorksheet('1週間の記録', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = [{ header: '日', width: 8 }, { header: '日付', width: 11 }, ...rec.cols];
  const last = colLetter(cols.length);
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // 1行目：使い方。2行目：補足。3行目：見出し
  ws.mergeCells(`A1:${last}1`);
  ws.getCell('A1').value = 'お試しの前の1週間、これを付けてください。1件1行。分は大まかで構いません。';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getRow(1).height = 24;
  ws.mergeCells(`A2:${last}2`);
  ws.getCell('A2').value = `${DEMOS[key].name}／2枚目「まとめ」に、試算（御社の場合）に入れる数字が出ます。この表はソエギに送らなくても構いません。`;
  ws.getCell('A2').font = { color: { argb: 'FF44525A' } };
  const head = ws.getRow(3);
  cols.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
  styleHeader(head);

  const first = 4;
  const lastRow = first + DAYS * rec.perDay - 1;
  for (let d = 0; d < DAYS; d++) {
    for (let k = 0; k < rec.perDay; k++) {
      const r = ws.getRow(first + d * rec.perDay + k);
      r.getCell(1).value = `${d + 1}日目`;
      if (d % 2 === 1) r.eachCell({ includeEmpty: true }, (cell, n) => { if (n <= cols.length) cell.fill = fill(COLORS.gray); });
      for (let i = 0; i < cols.length; i++) r.getCell(i + 1).border = { bottom: { style: 'hair', color: { argb: 'FFD5DDDF' } } };
    }
  }
  // 入力の決まり（選ぶ列はプルダウン、数の列は0以上の数）
  rec.cols.forEach((c, i) => {
    const L = colLetter(i + 3);
    for (let r = first; r <= lastRow; r++) {
      const cell = ws.getCell(`${L}${r}`);
      if (c.type === 'list') cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.list.join(',')}"`] };
      if (c.type === 'num') {
        cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: '数を入れてください', error: '0以上の数を入れてください' };
        cell.numFmt = '0.#';
      }
    }
  });
  // 合計の行
  const total = ws.getRow(lastRow + 1);
  total.getCell(1).value = '合計';
  rec.cols.forEach((c, i) => {
    const L = colLetter(i + 3);
    if (c.sum) total.getCell(i + 3).value = { formula: `SUM(${L}${first}:${L}${lastRow})`, result: 0 };
    else if (c.count) total.getCell(i + 3).value = { formula: `COUNTA(${L}${first}:${L}${lastRow})`, result: 0 };
  });
  total.font = { bold: true };
  total.eachCell({ includeEmpty: true }, (cell, n) => { if (n <= cols.length) { cell.fill = fill(COLORS.shuLight); cell.border = { top: { style: 'thin' } }; } });

  // まとめ（数式は記録表を参照する）
  const sum = wb.addWorksheet('まとめ');
  sum.columns = [{ header: '項目', width: 58 }, { header: '値', width: 12 }, { header: '単位', width: 8 }];
  styleHeader(sum.getRow(1));
  const ranges = rec.cols.map((_, i) => { const L = colLetter(i + 3); return `'1週間の記録'!${L}${first}:${L}${lastRow}`; });
  const items = rec.summary(ranges);
  // 人が入れる数（日数・人数）のセルの場所。数式の {days} {staff} をその番地に置き換える
  const refs = {};
  items.forEach(([label, f], i) => {
    if (typeof f === 'number') {
      if (label.includes('日数')) refs.days = `B${i + 2}`;
      if (label.includes('人数')) refs.staff = `B${i + 2}`;
    }
  });
  items.forEach(([label, f, unit], i) => {
    const row = sum.addRow([label, null, unit]);
    if (typeof f === 'number') {
      row.getCell(2).value = f;
      row.getCell(2).fill = fill(COLORS.yellow);
      row.getCell(1).value = `${label}（黄色のマスは書き換えてください）`;
    } else {
      row.getCell(2).value = { formula: f.replace('{days}', refs.days).replace('{staff}', refs.staff), result: 0 };
    }
  });
  sum.addRow([]);
  sum.addRow([`月に直すときは、1週間の数を${WEEKS_PER_MONTH}倍しています（1か月＝約${WEEKS_PER_MONTH}週）。`]);
  sum.addRow(['この数字を、デモの「御社の場合（試算）」に入れると、浮く時間の試算が出ます。試算は約束ではありません。']);
  return wb;
}
