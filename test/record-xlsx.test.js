import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildRecordWorkbook, RECORDS } from '../public/js/record-xlsx.js';
import { DEMOS } from '../public/js/estimate.js';

async function roundTrip(wb) {
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await wb.xlsx.writeBuffer());
  return out;
}

test('1週間の記録表：6デモすべてで、使い方の1行目・見出し・7日分の行・合計の行・まとめがある', async () => {
  assert.deepEqual(Object.keys(RECORDS).sort(), Object.keys(DEMOS).sort());
  for (const key of Object.keys(RECORDS)) {
    const rec = RECORDS[key];
    const wb = await roundTrip(buildRecordWorkbook(ExcelJS, key));
    const ws = wb.getWorksheet('1週間の記録');
    assert.match(String(ws.getCell('A1').value), /お試しの前の1週間、これを付けてください/, key);
    assert.equal(ws.getCell('A3').value, '日');
    assert.equal(ws.getCell('C3').value, rec.cols[0].header);
    const lastRow = 3 + 7 * rec.perDay;
    assert.equal(ws.getCell(`A${4}`).value, '1日目');
    assert.equal(ws.getCell(`A${lastRow}`).value, '7日目');
    assert.equal(ws.getCell(`A${lastRow + 1}`).value, '合計');
    // 合計の行に数式（SUM か COUNTA）が1つ以上
    const formulas = [];
    ws.getRow(lastRow + 1).eachCell((c) => { if (c.value?.formula) formulas.push(c.value.formula); });
    assert.ok(formulas.length >= 1, key);
    assert.ok(formulas.every((f) => /^(SUM|COUNTA)\([A-Z]+4:[A-Z]+\d+\)$/.test(f)), formulas.join());
    // 選ぶ列はプルダウン
    rec.cols.forEach((c, i) => {
      if (c.type === 'list') assert.equal(ws.getCell(String.fromCharCode(67 + i) + '4').dataValidation?.type, 'list', `${key}:${c.header}`);
    });
    const sum = wb.getWorksheet('まとめ');
    assert.ok(sum.rowCount >= rec.summary([]).length + 1);
    sum.eachRow((row, n) => {
      const f = row.getCell(2).value?.formula;
      if (f) assert.ok(!/\{|undefined/.test(f), `${key}: ${f}`); // 置き換え忘れが無い
    });
  }
});

test('まとめの数式：経理の1枚あたりの分は、分の合計÷枚数の合計', async () => {
  const wb = await roundTrip(buildRecordWorkbook(ExcelJS, 'receipt'));
  const sum = wb.getWorksheet('まとめ');
  assert.match(sum.getCell('B4').value.formula, /^IFERROR\(ROUND\(SUM\('1週間の記録'!D4:D24\)\/SUM\('1週間の記録'!C4:C24\),1\),""\)$/);
  assert.match(sum.getCell('A4').value, /御社の場合の「1枚の手入力にかかる時間」に入れる/); // 画面の項目名と同じ
  const k = await roundTrip(buildRecordWorkbook(ExcelJS, 'knowledge'));
  assert.match(k.getWorksheet('まとめ').getCell('B4').value.formula, /\/B3,1\)/); // 記録した日数のマスで割る
});

test('まとめの説明：4.3倍の文は月に直すデモだけ。チャットボットは「浮く時間の試算」と書かない', async () => {
  const text = async (key) => {
    const wb = await roundTrip(buildRecordWorkbook(ExcelJS, key));
    let t = ''; wb.getWorksheet('まとめ').eachRow((r) => { t += `${r.getCell(1).value}\n`; });
    return { t, a2: String(wb.getWorksheet('1週間の記録').getCell('A2').value) };
  };
  for (const key of ['receipt', 'order', 'inn']) assert.match((await text(key)).t, /4\.3倍/, key);
  for (const key of ['attendance', 'knowledge', 'foreign', 'chatbot']) assert.doesNotMatch((await text(key)).t, /4\.3倍/, key);
  const bot = await text('chatbot');
  assert.doesNotMatch(bot.t, /浮く時間の試算/);
  assert.doesNotMatch(bot.a2, /試算（御社の場合）に入れる/);
  assert.match((await text('attendance')).a2, /前の月の集計/);
  // 1日おきの灰色は、最後の列まで
  const wb = await roundTrip(buildRecordWorkbook(ExcelJS, 'receipt'));
  const ws = wb.getWorksheet('1週間の記録');
  assert.equal(ws.getCell('F7').fill?.fgColor?.argb, ws.getCell('A7').fill?.fgColor?.argb);
  assert.ok(ws.getCell('A7').fill?.fgColor?.argb);
  assert.equal(ws.getCell('C4').numFmt, undefined);
});
