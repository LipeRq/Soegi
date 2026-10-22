// 1週間の記録表（Excel）。お試しの前の1週間、いまの作業を付けてもらう用紙。
// 2枚目「まとめ」に、御社の場合（試算）に入れる数字を数式で出す。何も送らない（画面の中で作る）。
import { COLORS, fill, styleHeader } from './xlsx-common.js';
import { DEMOS } from './estimate.js';

const YESNO = ['はい', 'いいえ'];
const DAYS = 7;
const WEEKS_PER_MONTH = 4.3;

/**
 * デモごとの記録表。cols：見出し・幅・種類（num＝数、list＝選ぶ、text＝文字）。
 * summary：まとめの行 [項目, 数式か数, 単位, 御社の場合の入力の key]。数式の c[i] は記録表の i 列目の範囲。
 *   数のときは人が書き換えるマス（黄色）。4つ目があれば、項目のあとに「御社の場合の『（画面の項目名）』」を付ける
 * hint：1枚目2行目の、そのデモだけの説明。closing：まとめの最後の文（無ければ、浮く時間の試算の文）
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
      ['1枚あたりの分', `IFERROR(ROUND(SUM(${c[1]})/SUM(${c[0]}),1),"")`, '分', 'before'],
      ['月に直した枚数', `ROUND(SUM(${c[0]})*${WEEKS_PER_MONTH},0)`, '枚', 'count'],
      ['手直しした件数（1週間）', `SUM(${c[2]})`, '件'],
    ],
  },
  attendance: {
    perDay: 3,
    hint: '集計は月に1回の作業です。この1週間に集計が無ければ、前の月の集計にかかった分を1行に書いてください。',
    cols: [
      { header: '作業', width: 12, type: 'list', list: ['集計', '確認', '直し'] },
      { header: '人数', width: 8, type: 'num', sum: true },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
      { header: 'メモ', width: 30, type: 'text' },
    ],
    summary: (c) => [
      ['集計にかかった分（1週間）', `SUMIF(${c[0]},"集計",${c[2]})`, '分'],
      ['1人あたりの集計の分', `IFERROR(ROUND(SUMIF(${c[0]},"集計",${c[2]})/SUMIF(${c[0]},"集計",${c[1]}),1),"")`, '分', 'perPerson'],
      ['確認・直しにかかった分（1週間）', `SUMIF(${c[0]},"確認",${c[2]})+SUMIF(${c[0]},"直し",${c[2]})`, '分'],
    ],
  },
  shift: {
    perDay: 3,
    hint: 'シフト表づくりは月に1回の作業です。この1週間に無ければ、前の月のシフト表を確かめた・組み直した分を書いてください。',
    cols: [
      { header: '作業', width: 12, type: 'list', list: ['作る', '確かめる', '組み直す'] },
      { header: 'シフト表（部署）', width: 16, type: 'text' },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
      { header: '見つけた問題（件）', width: 15, type: 'num', sum: true },
      { header: 'メモ', width: 26, type: 'text' },
    ],
    summary: (c) => [
      ['確かめたシフト表の数', `COUNTIF(${c[0]},"確かめる")`, '表', 'count'],
      ['確かめる・組み直すにかかった分', `SUMIF(${c[0]},"確かめる",${c[2]})+SUMIF(${c[0]},"組み直す",${c[2]})`, '分'],
      ['1つのシフト表あたりの分', `IFERROR(ROUND((SUMIF(${c[0]},"確かめる",${c[2]})+SUMIF(${c[0]},"組み直す",${c[2]}))/COUNTIF(${c[0]},"確かめる"),1),"")`, '分', 'before'],
      ['見つけた問題の件数', `SUM(${c[3]})`, '件'],
    ],
  },
  order: {
    perDay: 8,
    cols: [
      { header: '取引先', width: 16, type: 'text', count: true },
      { header: '届き方', width: 10, type: 'list', list: ['FAX', '紙', 'メール', '電話', 'そのほか'] },
      { header: '明細の行数', width: 10, type: 'num', sum: true },
      { header: 'かかった分', width: 11, type: 'num', sum: true },
      { header: '問い合わせ・直し', width: 14, type: 'list', list: YESNO },
      { header: 'メモ', width: 24, type: 'text' },
    ],
    summary: (c) => [
      ['1週間の注文書の枚数', `COUNTA(${c[0]})`, '枚'],
      ['1週間にかかった分', `SUM(${c[3]})`, '分'],
      ['1枚あたりの分', `IFERROR(ROUND(SUM(${c[3]})/COUNTA(${c[0]}),1),"")`, '分', 'before'],
      ['月に直した枚数', `ROUND(COUNTA(${c[0]})*${WEEKS_PER_MONTH},0)`, '枚', 'count'],
      ['問い合わせ・直しがあった枚数', `COUNTIF(${c[4]},"はい")`, '枚'],
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
      ['1日に聞かれる回数', `IFERROR(ROUND(COUNTA(${c[2]})/{days},1),"")`, '回', 'asks'],
      ['1回の説明の分', `IFERROR(ROUND(AVERAGE(${c[4]}),1),"")`, '分', 'minutes'],
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
      ['1人に1日説明している分', `IFERROR(ROUND(SUM(${c[4]})/{staff}/{days},1),"")`, '分', 'minutes'],
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
      ['月に直した通数', `ROUND(COUNTA(${c[1]})*${WEEKS_PER_MONTH},0)`, '通', 'mails'],
      ['1通の返信の分', `IFERROR(ROUND(AVERAGE(${c[2]}),1),"")`, '分', 'before'],
      ['返信までの平均（時間）', `IFERROR(ROUND(AVERAGE(${c[3]}),1),"")`, '時間'],
      ['予約に至った件数', `COUNTIF(${c[4]},"はい")`, '件'],
    ],
  },
  chatbot: {
    perDay: 5,
    // チャットボットの試算は「1件の成約の粗利」だけ。まとめの件数は、お試しの前後で比べるためのもの
    sheetNote: '2枚目「まとめ」に、お試しの前後で比べる件数が出ます。',
    closing: 'お試しの前後で、問い合わせ・夜・休日の件数と、相談・見積に進んだ件数を比べます。試算は約束ではありません。',
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

/** 結合したマスの文字が切れないよう、行の高さを決める（Excel は結合したマスの高さを自動で合わせない） */
const fitHeight = (text, widthSum) => Math.max(1, Math.ceil((String(text).length * 2.1) / widthSum)) * 16 + 6;

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
  const widthSum = cols.reduce((t, c) => t + c.width, 0);
  const line1 = 'お試しの前の1週間、これを付けてください。1件1行。分は大まかで構いません。';
  const line2 = [DEMOS[key].name, rec.hint, rec.sheetNote ?? '2枚目「まとめ」に、試算（御社の場合）に入れる数字が出ます。', 'この表はソエギに送らなくても構いません。'].filter(Boolean).join('　');
  ws.mergeCells(`A1:${last}1`);
  ws.getCell('A1').value = line1;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A1').alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(1).height = fitHeight(line1, widthSum / 1.2) + 4; // 13pt の太字のぶん広めに
  ws.mergeCells(`A2:${last}2`);
  ws.getCell('A2').value = line2;
  ws.getCell('A2').font = { color: { argb: 'FF44525A' } };
  ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = fitHeight(line2, widthSum);
  const head = ws.getRow(3);
  cols.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
  styleHeader(head);
  head.height = 36; // 2段に折り返す見出し（「手直しした件数」など）が切れない高さ

  const first = 4;
  const lastRow = first + DAYS * rec.perDay - 1;
  for (let d = 0; d < DAYS; d++) {
    for (let k = 0; k < rec.perDay; k++) {
      const r = ws.getRow(first + d * rec.perDay + k);
      r.getCell(1).value = `${d + 1}日目`;
      // 1日おきの灰色と下線は、全部の列に付ける（まだ値の無いマスにも）
      for (let i = 1; i <= cols.length; i++) {
        const cell = r.getCell(i);
        if (d % 2 === 1) cell.fill = fill(COLORS.gray);
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD5DDDF' } } };
      }
    }
  }
  // 入力の決まり（選ぶ列はプルダウン、数の列は0以上の数）
  rec.cols.forEach((c, i) => {
    const L = colLetter(i + 3);
    for (let r = first; r <= lastRow; r++) {
      const cell = ws.getCell(`${L}${r}`);
      if (c.type === 'list') cell.dataValidation = { type: 'list', allowBlank: true, formulae: [`"${c.list.join(',')}"`] };
      // 数の列は表示形式を付けない（標準）。「0.#」だと整数が「3.」と出るため
      if (c.type === 'num') cell.dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: '数を入れてください', error: '0以上の数を入れてください' };
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
  for (let i = 1; i <= cols.length; i++) { const cell = total.getCell(i); cell.fill = fill(COLORS.shuLight); cell.border = { top: { style: 'thin' } }; }

  // まとめ（数式は記録表を参照する）
  const sum = wb.addWorksheet('まとめ');
  sum.columns = [{ header: '項目', width: 70 }, { header: '値', width: 12 }, { header: '単位', width: 8 }];
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
  const inputLabel = (k) => DEMOS[key].inputs.find((x) => x.key === k)?.label;
  items.forEach(([label, f, unit, target], i) => {
    // 御社の場合のどの欄に入れるかは、画面の項目名をそのまま使う（言葉がずれないように）
    const to = target && inputLabel(target) ? `（御社の場合の「${inputLabel(target)}」に入れる）` : '';
    const row = sum.addRow([`${label}${to}`, null, unit]);
    if (typeof f === 'number') {
      row.getCell(2).value = f;
      row.getCell(2).fill = fill(COLORS.yellow);
      row.getCell(1).value = `${label}${to}（黄色のマスは書き換えてください）`;
    } else {
      row.getCell(2).value = { formula: f.replace('{days}', refs.days).replace('{staff}', refs.staff), result: 0 };
    }
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  });
  sum.addRow([]);
  // 4.3倍の説明は、月に直す数式があるデモだけ
  if (items.some(([, f]) => typeof f === 'string' && f.includes(`*${WEEKS_PER_MONTH}`))) {
    sum.addRow([`月に直すときは、1週間の数を${WEEKS_PER_MONTH}倍しています（1ヶ月＝約${WEEKS_PER_MONTH}週）。`]);
  }
  sum.addRow([rec.closing ?? 'この数字を、デモの「御社の場合（試算）」に入れると、浮く時間の試算が出ます。試算は約束ではありません。']);
  return wb;
}
