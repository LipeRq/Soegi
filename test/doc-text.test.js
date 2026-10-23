import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { docxXmlToText, sheetToText, cleanText, joinWrappedLines } from '../public/js/doc-text.js';
import { normalizeOwnDocs, finalizeOwnAnswer } from '../src/core/own.js';
import { mockDocAnswer } from '../src/mock.js';

const SAMPLES = JSON.parse(readFileSync('public/samples/own/samples.json', 'utf8'));

test('Word の本文：段落・タブ・改行・表・文字参照', () => {
  const xml = '<w:document><w:body><w:p><w:r><w:t>見出し &amp; 本文</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t xml:space="preserve">A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>&#x3042;&lt;</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>品名</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>単価</w:t></w:r></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:r><w:t>洗面台</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>98,000円</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>おわり</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(docxXmlToText(xml), '見出し & 本文\nA\tB\nあ<\n品名\t単価\n洗面台\t98,000円\nおわり');
  assert.equal(docxXmlToText(''), '');
});

test('Excel：シート名と行番号と値の形。空の行・末尾の空のマスは出さない', () => {
  const t = sheetToText('単価表', [['項目', '単価'], [], ['洗面台', 98000, '', ''], [null, null], [new Date(Date.UTC(2026, 9, 1)), '備考']]);
  assert.equal(t, '[単価表 1行目] 項目 | 単価\n[単価表 3行目] 洗面台 | 98000\n[単価表 5行目] 2026-10-01 | 備考');
});

test('文字の整え：NUL・改行・空行', () => {
  assert.equal(cleanText('a\u0000b\r\n\r\n\r\n\r\nc  \r\nd'), 'ab\n\nc\nd');
});

test('見本の資料3つ：読み取れて、質問例に正しい資料名の引用が付き、資料に無い質問は「見当たりません」', async () => {
  // 画面と同じ手順で文字にする（docx は JSZip、xlsx は ExcelJS）。pdf は画面（pdf.js）側で確かめる
  const docx = await JSZip.loadAsync(readFileSync('public/samples/own/warranty.docx'));
  const wText = docxXmlToText(await docx.file('word/document.xml').async('string'));
  assert.match(wText, /構造部分（基礎・柱・梁）の保証は、引き渡しから10年です。/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('public/samples/own/prices.xlsx');
  const rows = [];
  wb.worksheets[0].eachRow({ includeEmpty: true }, (row, n) => { const a = []; row.eachCell({ includeEmpty: true }, (c, i) => { a[i - 1] = c.value; }); rows[n - 1] = a; });
  const xText = sheetToText(wb.worksheets[0].name, rows);
  assert.match(xText, /\[単価表 5行目\] クロス張替え \| m2 \| 1100 \| 家具の移動は別/);
  const rulesText = '■ 高所作業\n2メートル以上の高さで作業するときは、安全帯（フルハーネス）を着け、必ず2人以上で作業します。';
  const docs = normalizeOwnDocs([
    { name: SAMPLES.files[0].name, text: cleanText(wText) },
    { name: SAMPLES.files[1].name, text: cleanText(rulesText) },
    { name: SAMPLES.files[2].name, text: cleanText(xText) },
  ]);
  for (const { q, doc } of SAMPLES.questions) {
    const a = finalizeOwnAnswer(docs, mockDocAnswer(docs, q), q);
    if (doc) {
      assert.equal(a.found, true, q);
      assert.equal(a.citations[0].docName, doc, q);
    } else {
      assert.equal(a.found, false, q);
      assert.equal(a.answer, '資料には見当たりません。担当者に確認してください。');
    }
  }
  // 「けが」の質問は、答えと一緒に要確認を出す
  assert.equal(finalizeOwnAnswer(docs, mockDocAnswer(docs, '手を切ったとき'), '手を切ったとき').requireConfirm, true);
});

test('PDF の折り返された行をつなぐ：見出しや文の終わりの行はつながない', () => {
  const full = '2メートル以上の高さで作業するときは、安全帯（フルハーネス）を着け、必ず2人';
  assert.deepEqual(joinWrappedLines(['■ 高所作業', full, '以上で作業します。', '■ 朝礼', '毎朝8時に朝礼をします。']), ['■ 高所作業', `${full}以上で作業します。`, '■ 朝礼', '毎朝8時に朝礼をします。']);
  assert.deepEqual(joinWrappedLines(['短い', '行です']), ['短い', '行です']);
});
