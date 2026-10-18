import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkTimecards, effectiveBreak, toCalcRecord, compareRuns, levelOf, worstOf } from '../public/js/timecard-check.js';
import { DEFAULT_SETTINGS, fmtHM, normalizeName } from '../public/js/overtime.js';

const rec = (over) => ({
  name: '鈴木 健太', date: '2026-09-15', start: '08:30', end: '19:30', out: '', back: '', breakMin: '', startAlt: '', endAlt: '',
  conf: { start: '高', end: '高', out: '高', back: '高' }, note: '', ...over,
});
const one = (over, period = '2026-09') => checkTimecards([rec(over)], period)[0].flags;

test('問題のない行は指摘なし', () => {
  assert.deepEqual(one({}), []);
});

test('赤：氏名・日付・対象の月・片方だけの時刻・読めない時刻', () => {
  assert.equal(levelOf(one({ name: '' }), 'name'), 'red');
  assert.equal(levelOf(one({ date: '9月の' }), 'date'), 'red');
  assert.match(one({ date: '2026-10-01' }).map((f) => f.message).join(), /対象の月（2026年9月）の外/);
  assert.equal(levelOf(one({ end: '' }), 'end'), 'red');
  assert.equal(levelOf(one({ start: '8時半ごろ' }), 'start'), 'red');
  assert.equal(worstOf(one({ start: '', end: '' })), 'yellow'); // 休みの日かもしれない
});

test('黄：日またぎ・16時間超・同じ日が2行・確かさ低・二重打刻・外出か戻りの片方', () => {
  assert.match(one({ start: '22:00', end: '07:00' }).map((f) => f.message).join(), /日またぎ/);
  assert.match(one({ start: '06:00', end: '23:30' }).map((f) => f.message).join(), /16時間を超えています/);
  const dup = checkTimecards([rec(), rec()], '2026-09');
  assert.ok(dup.every((c) => c.flags.some((f) => /同じ人の同じ日/.test(f.message))));
  assert.match(one({ conf: { start: '低', end: '高' }, note: '手書きの修正' }).map((f) => f.message).join(), /出勤の読み取りに自信がありません（手書きの修正）/);
  const dbl = one({ end: '17:32', endAlt: '21:48', conf: { end: '低' } });
  assert.equal(dbl.length, 1); // 二重打刻のときは、確かさ低の指摘を重ねない
  assert.match(dbl[0].message, /17:32 と 21:48/);
  assert.equal(levelOf(one({ out: '12:05' }), 'back'), 'yellow');
  assert.equal(levelOf(one({ out: '13:20', back: '12:05' }), 'back'), 'yellow');
});

test('休憩：外出・戻りがあれば「戻り−外出」。無ければ読んだ休憩、空なら既定', () => {
  assert.equal(effectiveBreak(rec({ out: '12:05', back: '13:20', breakMin: 60 })), 75);
  assert.equal(effectiveBreak(rec({ breakMin: 45 })), 45);
  assert.equal(effectiveBreak(rec()), '');
  assert.deepEqual(toCalcRecord(rec({ out: '12:00', back: '12:45' }), 0), { name: '鈴木 健太', date: '2026-09-15', start: '08:30', end: '19:30', breakMin: 45, row: 1 });
});

test('見本：鈴木さんは、二重打刻の正しい時刻（21:48）を選ぶと時間外が45時間を超えて黄になる', () => {
  const s = JSON.parse(readFileSync(new URL('../public/samples/timecards/samples.json', import.meta.url), 'utf8')).samples.find((x) => x.id === 'suzuki');
  const rows = s.entries.map((e) => rec({ name: s.employee_name, date: e.date, start: e.start, end: e.end, out: e.out, back: e.back, breakMin: e.break_min ?? '', startAlt: e.start_alt, endAlt: e.end_alt, conf: e.conf, note: e.note }));
  const checks = checkTimecards(rows, s.period);
  assert.ok(checks.some((c) => c.flags.some((f) => /二重打刻/.test(f.message))));
  const fixed = rows.map((r) => (r.date === '2026-09-15' ? { ...r, end: '21:48', endAlt: '' } : r));
  const [cmp] = compareRuns(rows, fixed, DEFAULT_SETTINGS);
  assert.equal(cmp.name, normalizeName(s.employee_name));
  assert.equal(fmtHM(cmp.before.overMin), '41:03');
  assert.equal(cmp.before.status, 'none');
  assert.equal(fmtHM(cmp.after.overMin), '45:19');
  assert.equal(cmp.after.status, 'yellow');
});
