import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReceipts, levelOf, worstLevel } from '../public/js/receipt-check.js';
import { validateReceipt, validateTimecard } from '../src/schemas.js';

const today = new Date(2026, 9, 7); // 2026-10-07
const base = { date: '2026-10-01', payee: 'さくら文具店', total: 1980, amount10: 1980, amount8: null, invoiceNo: 'T1234567890123', conf: {} };
const check = (over) => checkReceipts([{ ...base, ...over }], today)[0];

test('問題のないレシートは指摘なし', () => {
  assert.deepEqual(check({}).flags, []);
});

test('10%＋8% ≠ 合計 → 赤（合計と金額のセル）', () => {
  const r = check({ amount10: 1000, amount8: 500 });
  assert.equal(levelOf(r.flags, 'total'), 'red');
  assert.equal(levelOf(r.flags, 'amount10'), 'red');
  assert.equal(worstLevel(r.flags), 'red');
  assert.deepEqual(check({ amount10: 1000, amount8: 980 }).flags, []);
  assert.deepEqual(check({ amount10: null, amount8: null }).flags, []); // 内訳が書かれていなければ見ない
});

test('登録番号が T＋13桁でない → 赤。空は指摘なし', () => {
  assert.equal(levelOf(check({ invoiceNo: 'T123' }).flags, 'invoiceNo'), 'red');
  assert.equal(levelOf(check({ invoiceNo: '1234567890123' }).flags, 'invoiceNo'), 'red');
  assert.equal(levelOf(check({ invoiceNo: 'T12345678901234' }).flags, 'invoiceNo'), 'red');
  assert.equal(check({ invoiceNo: '' }).flags.length, 0);
});

test('日付：未来・1年以上前は黄、空は赤', () => {
  assert.equal(levelOf(check({ date: '2026-10-08' }).flags, 'date'), 'yellow');
  assert.equal(levelOf(check({ date: '2026-10-07' }).flags, 'date'), null);
  assert.equal(levelOf(check({ date: '2025-10-07' }).flags, 'date'), null);
  assert.equal(levelOf(check({ date: '2025-10-06' }).flags, 'date'), 'yellow');
  assert.equal(levelOf(check({ date: '' }).flags, 'date'), 'red');
  assert.equal(levelOf(check({ date: '2026-02-30' }).flags, 'date'), 'red');
});

test('必須項目が空 → 赤', () => {
  assert.equal(levelOf(check({ payee: ' ' }).flags, 'payee'), 'red');
  assert.equal(levelOf(check({ total: null }).flags, 'total'), 'red');
});

test('確かさが「低」の項目は黄', () => {
  const r = check({ conf: { payee: '低', total: '高' } });
  assert.equal(levelOf(r.flags, 'payee'), 'yellow');
  assert.equal(levelOf(r.flags, 'total'), null);
});

test('同じ日・支払先・金額 → 重複の疑い（両方の行に出る）', () => {
  const rows = [base, { ...base }, { ...base, total: 500, amount10: 500 }];
  const r = checkReceipts(rows, today);
  assert.equal(r[0].duplicate, true);
  assert.equal(r[1].duplicate, true);
  assert.equal(r[2].duplicate, false);
  assert.equal(levelOf(r[0].flags, 'row'), 'yellow');
});

// ---- Worker側の検証 ---------------------------------------------------------

const goodReceipt = {
  is_receipt: true, date: '2026/9/3', payee: 'みどり食堂', total: '1,760', amount_10: null, amount_8: 1760,
  tax_amount: 130, invoice_no: 't-2345678901234', payment_method: '現金', summary: '定食', account: '会議費',
  account_reason: '打合せ', confidence: { date: '高', payee: '高', total: '高', tax: '中', invoice_no: '中', account: '中' },
};

test('validateReceipt：表記ゆれを整える', () => {
  const v = validateReceipt(goodReceipt);
  assert.equal(v.date, '2026-09-03');
  assert.equal(v.total, 1760);
  assert.equal(v.invoice_no, 'T2345678901234');
  assert.equal(v.account, '会議費');
});

test('validateReceipt：科目が候補外なら空にして確かさ低', () => {
  const v = validateReceipt({ ...goodReceipt, account: '交通費' });
  assert.equal(v.account, '');
  assert.equal(v.confidence.account, '低');
});

test('validateReceipt：形が崩れていたら例外（再試行の合図）', () => {
  assert.throws(() => validateReceipt(null), /schema/);
  assert.throws(() => validateReceipt({ ...goodReceipt, is_receipt: 'yes' }), /schema/);
  assert.throws(() => validateReceipt({ ...goodReceipt, confidence: undefined }), /schema/);
  assert.throws(() => validateReceipt({ ...goodReceipt, total: 'たくさん' }), /schema/);
});

test('validateReceipt：全角かっこの科目（車両費（燃料））も候補の一覧と一致する', () => {
  const base2 = { is_receipt: true, date: '2026-10-01', payee: 'あおぞらGS', total: 6200, amount_10: 6200, amount_8: null, tax_amount: 564, invoice_no: '', payment_method: '現金', summary: '給油', account_reason: '', confidence: { date: '高', payee: '高', total: '高', tax: '高', invoice_no: '高', account: '高' } };
  assert.equal(validateReceipt({ ...base2, account: '車両費（燃料）' }).account, '車両費（燃料）');
  assert.equal(validateReceipt({ ...base2, account: '車両費(燃料)' }).account, '車両費（燃料）');
  assert.equal(validateReceipt({ ...base2, account: '知らない科目' }).account, '');
});

test('validateTimecard', () => {
  const v = validateTimecard({ employee_name: ' 青木 一郎 ', entries: [{ date: '2026-09-01', start: '9:00', end: '18時00分', break_min: '60' }] });
  assert.deepEqual(v.entries[0], {
    date: '2026-09-01', start: '09:00', end: '18:00', out: '', back: '', break_min: 60, start_alt: '', end_alt: '',
    conf: { start: '低', end: '低', out: '高', back: '高' }, note: '', // 確かさが無いときは「低」に倒す
  });
  const w = validateTimecard({ employee_name: '', entries: [{ date: '2026-09-15', start: '8:21', end: '17:32', end_alt: '21:48', out: '12:05', back: '13:20', conf_start: '高', conf_end: '低', conf_out: '中', conf_back: 'x', note: '二重打刻' }] });
  assert.equal(w.entries[0].end_alt, '21:48');
  assert.deepEqual(w.entries[0].conf, { start: '高', end: '低', out: '中', back: '低' });
  assert.throws(() => validateTimecard({ entries: 'x' }), /schema/);
});
