import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReceipts } from '../public/js/receipt-check.js';
import { deductionRate, taxParts, selectRows, csvValue } from '../public/js/accounting-formats.js';

const row = (over) => ({
  date: '2026-10-05', payee: 'さくら文具店', total: 1980, amount10: 1980, amount8: null, tax: 180, invoiceNo: 'T1234567890123',
  payment: '現金', summary: 'コピー用紙', account: '事務用品費', reason: '', conf: {}, confirmed: true, error: '', ...over,
});
const today = new Date('2026-10-18T09:00:00+09:00');

test('経過措置：登録番号なしは、取引日で 80% → 50%（2026年10月1日から）', () => {
  assert.equal(deductionRate('2026-10-05', true), 100);
  assert.equal(deductionRate('2026-09-30', false), 80);
  assert.equal(deductionRate('2026-10-01', false), 50);
  assert.equal(deductionRate('2029-09-30', false), 50);
  assert.equal(deductionRate('2029-10-01', false), 0);
  assert.equal(deductionRate('2023-09-30', false), 100); // インボイス制度の前
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
    row({ error: '読み取れませんでした', confirmed: true }),
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
  assert.match(skipped[3].reason, /読み取れません/);
});

test('CSV の値：引用符と、式にしない印', () => {
  assert.equal(csvValue('a,b'), '"a,b"');
  assert.equal(csvValue('say "hi"'), '"say ""hi"""');
  assert.equal(csvValue('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvValue(-500, { text: false }), '-500');
  assert.equal(csvValue(null), '');
});
