import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { docxXmlToText, sheetToText, cleanText, joinWrappedLines, decodeTextBytes } from '../public/js/doc-text.js';
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

test('レビューで直したこと：箇条書き・見出し・表の行をつながない、長い英文の行に引きずられない', () => {
  const full = 'この資料は現場で働くすべての職員が、毎朝の朝礼のあとに必ず読み返すための決まりごとをまとめたものです';
  assert.deepEqual(joinWrappedLines([full, '・事務所に入るときは、あいさつをします', full, 'ます。']), [full, '・事務所に入るときは、あいさつをします', `${full}ます。`]);
  assert.deepEqual(joinWrappedLines([full, '第2条 休憩の決まり']), [full, '第2条 休憩の決まり']);
  // 表の行（短い行）はつなげない
  assert.deepEqual(joinWrappedLines(['外壁塗装 m2 3200 足場代は別', '屋根塗装 m2 2800 足場代は別', '洗面台の交換 台 98000 本体を含む']), ['外壁塗装 m2 3200 足場代は別', '屋根塗装 m2 2800 足場代は別', '洗面台の交換 台 98000 本体を含む']);
  // 英文の長い行が1本あっても、日本語の折り返しはつながる
  const en = 'This is a very long English sentence that is much longer than any of the Japanese lines in this page.';
  assert.deepEqual(joinWrappedLines([en, full, 'です。', 'ABC', full, 'です。']).filter((l) => l.endsWith('です。')).length, 2);
});

test('テキストの文字コード：UTF-8・BOM・UTF-16（BOM付き）・Shift_JIS・EUC-JP。化けた文字は受け入れない', () => {
  const text = '有給休暇は、3日前までに休暇届を出します。\n遅刻するときは電話します。';
  const u8 = new TextEncoder().encode(text);
  assert.equal(decodeTextBytes(u8), text);
  assert.equal(decodeTextBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), u8])), text);
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(decodeTextBytes(u16), text);
  const be = Buffer.from(text, 'utf16le').swap16();
  assert.equal(decodeTextBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), text);
  // Shift_JIS / EUC-JP（node の TextEncoder は UTF-8 だけなので、バイト列を直接用意する）
  const sjis = Buffer.from([0x95, 0x69, 0x96, 0xbc, 0x2c, 0x92, 0x50, 0x89, 0xbf, 0x0a, 0x8f, 0x5c, 0x8f, 0x5c]);
  assert.match(decodeTextBytes(sjis), /^品名,単価\n/);
  const eucjp = Buffer.from([0xa4, 0xa2, 0xa4, 0xa4, 0xa4, 0xa6, 0xa4, 0xa8, 0xa4, 0xaa]); // あいうえお
  assert.equal(decodeTextBytes(eucjp), 'あいうえお');
  // BOM なしの UTF-16 や、バイナリは断る
  assert.throws(() => decodeTextBytes(Buffer.from(text, 'utf16le')), /判別できません/);
  assert.throws(() => decodeTextBytes(Buffer.from([0x80, 0x81, 0x82, 0xfd, 0xfe, 0xff, 0x90, 0x91, 0x92, 0x93])), /判別できません/);
});
