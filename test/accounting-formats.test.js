import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReceipts } from '../public/js/receipt-check.js';
import {
  deductionRate, taxParts, selectRows, csvValue, YAYOI_TAX, FREEE_TAX, FREEE_HEADER, yayoiRows, yayoiFile, freeeRows, freeeFile, importText, caveats, TRANSITION,
} from '../public/js/accounting-formats.js';

const row = (over) => ({
  date: '2026-10-05', payee: 'さくら文具店', total: 1980, amount10: 1980, amount8: null, tax: 180, invoiceNo: 'T1234567890123',
  payment: '現金', summary: 'コピー用紙', account: '事務用品費', reason: '', conf: {}, confirmed: true, error: '', ...over,
});
const today = new Date('2026-10-18T09:00:00+09:00');

test('経過措置（令和8年度改正のあと）：登録番号なしは、取引日で 80% → 70% → 50% → 30% → 0', () => {
  assert.equal(deductionRate('2026-10-05', true), 100);
  const cases = [['2023-10-01', 80], ['2026-09-30', 80], ['2026-10-01', 70], ['2028-09-30', 70], ['2028-10-01', 50], ['2030-09-30', 50], ['2030-10-01', 30], ['2031-09-30', 30], ['2031-10-01', 0]];
  for (const [d, rate] of cases) assert.equal(deductionRate(d, false), rate, d);
  assert.equal(deductionRate('2023-09-30', false), 100); // インボイス制度の前
  // 期間がすき間なく続いている
  for (let i = 1; i < TRANSITION.length; i++) {
    const prev = new Date(`${TRANSITION[i - 1].to}T00:00:00Z`); prev.setUTCDate(prev.getUTCDate() + 1);
    assert.equal(prev.toISOString().slice(0, 10), TRANSITION[i].from);
  }
});

test('税率ごとの行：内訳が合えば分ける。無ければ合計を1行', () => {
  assert.deepEqual(taxParts(row({ total: 1100, amount10: 600, amount8: 500 })), [{ rate: 10, amount: 600 }, { rate: 8, amount: 500 }]);
  assert.deepEqual(taxParts(row({ total: 864, amount10: null, amount8: 864 })), [{ rate: 8, amount: 864 }]);
  assert.deepEqual(taxParts(row({ total: 500, amount10: null, amount8: null })), [{ rate: 10, amount: 500 }]);
});

test('出す行：確定していて赤の無い行だけ。出さない行は理由つき', () => {
  const rows = [
    row(),
    row({ confirmed: false }),
    row({ account: '', confirmed: false }),
    row({ invoiceNo: 'T123' }), // 登録番号の形が違う → 赤
    row({ error: '読み取れませんでした', confirmed: true, date: '', payee: '', total: null, amount10: null }), // 読めず＝空の欄が赤
    row({ invoiceNo: '', date: '2026-09-20' }),
  ];
  const { ok, skipped } = selectRows(rows, checkReceipts(rows, today));
  assert.deepEqual(ok.map((x) => x.no), [1, 6]);
  assert.equal(ok[1].registered, false);
  assert.equal(ok[1].rate, 80);
  assert.deepEqual(skipped.map((x) => x.no), [2, 3, 4, 5]);
  assert.match(skipped[0].reason, /未確定/);
  assert.match(skipped[1].reason, /選ばれていません/);
  assert.match(skipped[2].reason, /赤/);
  assert.match(skipped[3].reason, /赤/);
  // 読めなかった行でも、人が埋めて「確定」すれば出す
  const fixed = [row({ error: '読み取れませんでした', confirmed: true })];
  assert.equal(selectRows(fixed, checkReceipts(fixed, today)).ok.length, 1);
  // 0円以下の合計・内訳は出さない
  const neg = [row({ total: 0, amount10: 0 }), row({ payee: '値引きの店', total: 900, amount10: 1000, amount8: -100 })];
  const n = selectRows(neg, checkReceipts(neg, today));
  assert.equal(n.ok.length, 0);
  assert.match(n.skipped[0].reason, /0円以下/);
  assert.match(n.skipped[1].reason, /内訳に0円以下/);
});

test('CSV の値：引用符と、式にしない印', () => {
  assert.equal(csvValue('a,b'), '"a,b"');
  assert.equal(csvValue('say "hi"'), '"say ""hi"""');
  assert.equal(csvValue('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvValue(-500, { text: false }), '-500');
  assert.equal(csvValue(null), '');
});

// ---- 税区分の文字：1文字ずつ（かっこ・％の全角半角まで）----------------------------------------
const codes = (t) => [...t].map((c) => c.codePointAt(0).toString(16));

test('税区分の文字：弥生は「課対仕入込10%適格」の形、freee は（控70）の全角かっこと半角の %', () => {
  assert.equal(YAYOI_TAX.込['10_100'], '課対仕入込10%適格');
  assert.equal(YAYOI_TAX.込['8_70'], '課対仕入込軽減8%区分70%');
  assert.equal(YAYOI_TAX.内['10_80'], '課対仕入内10%区分80%');
  assert.equal(FREEE_TAX['8_100'], '課対仕入8%（軽）');
  assert.equal(FREEE_TAX['10_70'], '課対仕入（控70）10%');
  for (const t of [...Object.values(YAYOI_TAX.込), ...Object.values(YAYOI_TAX.内), ...Object.values(FREEE_TAX)]) {
    assert.ok(!/[\s％()]/.test(t), `${t} に空白・全角％・半角かっこが無い`);
    assert.ok(t.includes('%'), t);
  }
  assert.deepEqual(codes('（控70）').slice(0, 1), ['ff08']);
  // 全部の組み合わせ（税率×割合）がある
  for (const rate of [10, 8]) for (const d of [100, 80, 70, 50, 30]) {
    assert.ok(YAYOI_TAX.込[`${rate}_${d}`] && YAYOI_TAX.内[`${rate}_${d}`] && FREEE_TAX[`${rate}_${d}`], `${rate}_${d}`);
  }
});

const rows = [
  row({ payee: 'さくら文具店', summary: 'コピー用紙, ボールペン', total: 1980, amount10: 1980, tax: 180 }),
  row({ payee: 'やまの駅 売店', summary: '弁当・お茶', total: 1100, amount10: 600, amount8: 500, invoiceNo: '', date: '2026-10-12', account: '会議費', tax: null }),
  row({ payee: '"=SUM(A1)"', summary: 'テスト', total: 500, amount10: 500, date: '2026-09-25', invoiceNo: '' }),
];
const sel = () => selectRows(rows, checkReceipts(rows, today)).ok;

test('弥生インポート形式：25項目・2000・税区分・税込経理は税額なし・摘要は30文字まで', () => {
  const out = yayoiRows(sel(), { method: '込', credit: '現金' });
  assert.equal(out.length, 4); // 2枚目は 10% と 8% の2行
  for (const cols of out) assert.equal(cols.length, 25);
  const [a, b, c, d] = out;
  assert.deepEqual(a.slice(0, 11), ['2000', '', '', '2026/10/05', '事務用品費', '', '', '課対仕入込10%適格', '1980', '', '現金']);
  assert.equal(a[13], '対象外');
  assert.equal(a[14], '1980');
  assert.equal(a[16], 'さくら文具店 コピー用紙、 ボールペン'); // 半角カンマは「、」
  assert.deepEqual(a.slice(19), ['0', '', '', '0', '0', 'no']);
  assert.equal(b[7], '課対仕入込10%区分70%'); // 登録番号なし・2026/10/12 → 70%
  assert.equal(b[8], '600');
  assert.equal(c[7], '課対仕入込軽減8%区分70%');
  assert.equal(d[7], '課対仕入込10%区分80%'); // 2026/9/25 → 80%
  assert.ok(!d[16].startsWith('=') && !d[16].includes('"'));
  // 税抜経理（内税）は税額を入れる
  const inner = yayoiRows(sel(), { method: '内' });
  assert.equal(inner[0][7], '課対仕入内10%適格');
  assert.equal(inner[0][9], '180'); // レシートの税額
  assert.equal(inner[1][9], String(Math.floor((600 * 10) / 110)));
  assert.equal(inner[2][9], String(Math.floor((500 * 8) / 108)));
  // ファイル：Shift_JIS・見出しなし・CRLF・読み戻すと同じ
  const { bytes, unmappable } = yayoiFile(out);
  assert.deepEqual(unmappable, []);
  const text = new TextDecoder('shift_jis').decode(bytes);
  assert.ok(text.startsWith('2000,,,2026/10/05,'));
  assert.ok(text.endsWith('no\r\n'));
  assert.equal(text.split('\r\n').length, 5);
  assert.ok(!text.includes('"'));
  assert.notEqual(bytes[0], 0xef); // BOM なし
});

test('freee 取引のインポート：21列の見出し・支出・税区分・決済の欄', async () => {
  const out = freeeRows(sel(), { credit: '現金' });
  assert.deepEqual(out[0], FREEE_HEADER);
  assert.equal(FREEE_HEADER.length, 21);
  assert.equal(FREEE_HEADER[14], 'メモタグ（複数指定可、カンマ区切り）');
  for (const cols of out) assert.equal(cols.length, 21);
  const [, a, b, c] = out;
  assert.deepEqual(a.slice(0, 11), ['支出', '', '2026/10/05', '', '', 'さくら文具店', '事務用品費', '課対仕入10%', '1980', '内税', '']);
  assert.match(a[11], /^No\.1 .*T1234567890123$/);
  assert.deepEqual(a.slice(18), ['2026/10/05', '現金', '1980']);
  assert.equal(b[7], '課対仕入（控70）10%');
  assert.equal(c[7], '課対仕入（控70）8%（軽）');
  assert.equal(c[8], '500');
  assert.deepEqual(c.slice(18), ['2026/10/12', '現金', '500']); // 2件の支出に分ける
  // 未払金は決済の欄を空に（未決済）
  const unpaid = freeeRows(sel(), { credit: '未払金' });
  assert.deepEqual(unpaid[1].slice(18), ['', '', '']);
  // ファイル：UTF-8 の BOM・CRLF
  const buf = new Uint8Array(await freeeFile(out).arrayBuffer());
  assert.deepEqual([...buf.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder().decode(buf.slice(3));
  assert.ok(text.startsWith('収支区分,管理番号,発生日,'));
  assert.ok(text.includes('"メモタグ（複数指定可、カンマ区切り）"') === false); // 全角の読点なので囲まない
  assert.ok(text.endsWith('\r\n'));
});

test('取り込みの文字：改行・引用符・先頭の記号', () => {
  assert.equal(importText('a,b\n"c"'), 'a、b c');
  assert.equal(importText('=HYPERLINK("x")'), 'HYPERLINK(x)');
  assert.equal(importText('-値引き'), '－値引き');
  assert.equal(importText('= =SUM(A1)'), 'SUM(A1)'); // 記号と空白が続いても取る
  assert.equal(importText('- =1+1'), '－1+1');
  assert.equal(importText('あいうえお', 3), 'あいう');
});

test('確かめてほしい行：登録番号なしの交通費と、1万円未満', () => {
  const rs = [row({ account: '旅費交通費', invoiceNo: '', total: 420, amount10: 420 }), row({ invoiceNo: '', total: 2000, amount10: 2000 }), row({ payee: '別の店' })];
  const ok = selectRows(rs, checkReceipts(rs, today)).ok;
  const notes = caveats(ok);
  assert.equal(notes.length, 2);
  assert.match(notes[0].note, /運賃/);
  assert.match(notes[1].note, /少額特例/);
  // 重複の疑い：出す行どうしで2枚以上のときだけ。片方の「確定」を外すと消える
  const dup = [row(), row()];
  assert.equal(caveats(selectRows(dup, checkReceipts(dup, today)).ok).filter((n) => /ほかにも出す行/.test(n.note)).length, 2);
  const dup2 = [row(), row({ confirmed: false })];
  assert.equal(caveats(selectRows(dup2, checkReceipts(dup2, today)).ok).filter((n) => /ほかにも出す行/.test(n.note)).length, 0);
  // 直し方は、ソフトごとの税区分の名前で
  assert.match(caveats(ok, { format: 'freee' })[1].note, /課対仕入10%/);
  assert.match(caveats(ok, { format: 'yayoi' })[1].note, /末尾を「適格」/);
  // 弥生（Shift_JIS）にできない文字は、ダウンロードの前に知らせる
  const emoji = [row({ summary: 'ケーキ🍰' })];
  assert.match(caveats(selectRows(emoji, checkReceipts(emoji, today)).ok, { format: 'yayoi' })[0].note, /Shift_JIS にできない文字（🍰）/);
});
