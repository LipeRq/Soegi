import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculate, calcShift, nightMinutes, parseTime, parseDate, parseBreak, periodKeyOf,
  judge, weekdayOf, fmtHM, fmtClock,
} from '../public/js/overtime.js';
import { decodeCsvBytes, parseCsv, guessColumns, toRecords } from '../public/js/csv.js';

const h = (hh, mm = 0) => hh * 60 + mm;
const rec = (name, date, start, end, breakMin = '') => ({ name, date, start, end, breakMin });
const one = (records, settings) => calculate(records, settings).periods[0].people[0];

test('文字列の読み取り', () => {
  assert.equal(parseTime('9:00'), 540);
  assert.equal(parseTime('09:30:15'), 570);
  assert.equal(parseTime('９：００'), 540);
  assert.equal(parseTime('9時30分'), 570);
  assert.equal(parseTime('0900'), 540);
  assert.equal(parseTime('2026-09-01 18:15'), 1095);
  assert.equal(parseTime('25:30'), 1530);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('9:75'), null);
  assert.equal(parseDate('2026/9/1'), '2026-09-01');
  assert.equal(parseDate('2026年9月1日'), '2026-09-01');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseBreak(''), null);
  assert.equal(parseBreak('0'), 0);
  assert.equal(parseBreak('60分'), 60);
  assert.equal(parseBreak('1:00'), 60);
  assert.ok(Number.isNaN(parseBreak('あ')));
  assert.equal(weekdayOf('2026-09-06'), 0); // 日曜
});

test('通常の日：9:00-18:00 休憩60 → 実労働480、時間外0', () => {
  const s = calcShift(h(9), h(18), 60, 60);
  assert.equal(s.workMin, 480);
  assert.equal(s.nightMin, 0);
});

test('時間外：9:00-20:00 休憩60 → 実労働600、時間外120', () => {
  const p = one([rec('A', '2026-09-01', '9:00', '20:00', 60)]); // 火曜
  assert.equal(p.workMin, 600);
  assert.equal(p.overMin, 120);
  assert.equal(p.nightMin, 0);
  assert.equal(p.holidayMin, 0);
});

test('深夜：14:00-23:30 休憩60 → 実労働510、時間外30、深夜90', () => {
  const p = one([rec('A', '2026-09-01', '14:00', '23:30', 60)]);
  assert.equal(p.workMin, 510);
  assert.equal(p.overMin, 30);
  assert.equal(p.nightMin, 90);
});

test('日またぎ：22:00-翌7:00 休憩60 → 実労働480、時間外0、深夜420（22-24時=120 + 0-5時=300）', () => {
  const s = calcShift(h(22), h(7), 60, 60);
  assert.equal(s.crossesMidnight, true);
  assert.equal(s.workMin, 480);
  assert.equal(s.nightMin, 420);
  const p = one([rec('A', '2026-09-01', '22:00', '07:00', 60)]);
  assert.equal(p.overMin, 0);
  assert.equal(p.days[0].end, h(31));
  assert.equal(fmtClock(p.days[0].end), '07:00');
});

test('日またぎ＋時間外：18:00-翌5:30 休憩60 → 実労働630、時間外150、深夜450（22-29時=420 → 22:00〜5:00）', () => {
  const p = one([rec('A', '2026-09-01', '18:00', '05:30', 60)]);
  assert.equal(p.workMin, 630); // 690分-60
  assert.equal(p.overMin, 150);
  assert.equal(p.nightMin, 420); // 22:00-5:00 = 7h
});

test('深夜帯の端：早朝4:00-9:00 休憩0 → 深夜60（4:00-5:00）', () => {
  assert.equal(nightMinutes(h(4), h(9)), 60);
  assert.equal(nightMinutes(h(5), h(22)), 0);
  assert.equal(nightMinutes(h(21, 59), h(22, 1)), 1);
});

test('法定休日（日曜）：9:00-17:00 休憩60 → 休日労働420、時間外0', () => {
  const p = one([rec('A', '2026-09-06', '9:00', '17:00', 60)]);
  assert.equal(p.holidayMin, 420);
  assert.equal(p.overMin, 0);
  assert.equal(p.days[0].isHoliday, true);
});

test('法定休日に9時間：休日労働540（時間外には二重に数えない）', () => {
  const p = one([rec('A', '2026-09-06', '9:00', '19:00', 60)]);
  assert.equal(p.holidayMin, 540);
  assert.equal(p.overMin, 0);
  assert.equal(p.overPlusHolidayMin, 540);
});

test('法定休日の設定を土曜に変えると、土曜が休日労働・日曜は通常日', () => {
  const sat = one([rec('A', '2026-09-05', '9:00', '17:00', 60)], { holidayWeekday: 6 });
  assert.equal(sat.holidayMin, 420);
  const sun = one([rec('A', '2026-09-06', '9:00', '19:00', 60)], { holidayWeekday: 6 });
  assert.equal(sun.holidayMin, 0);
  assert.equal(sun.overMin, 60);
});

test('休憩：空欄は既定60分、0は休憩なし', () => {
  const blank = one([rec('A', '2026-09-01', '9:00', '18:00', '')]);
  assert.equal(blank.workMin, 480);
  assert.equal(blank.days[0].breakDefaulted, true);
  const zero = one([rec('A', '2026-09-01', '9:00', '18:00', '0')]);
  assert.equal(zero.workMin, 540);
  assert.equal(zero.overMin, 60);
  assert.equal(zero.days[0].breakDefaulted, false);
  const custom = one([rec('A', '2026-09-01', '9:00', '18:00', '')], { defaultBreakMin: 45 });
  assert.equal(custom.workMin, 495);
});

test('所定労働時間の設定：7.5時間にすると8時間勤務の時間外は30分', () => {
  const p = one([rec('A', '2026-09-01', '9:00', '18:00', 60)], { scheduledMin: 450 });
  assert.equal(p.overMin, 30);
});

test('同じ日に2回の勤務は合算して、1日の所定を超えた分を時間外にする', () => {
  const p = one([
    rec('A', '2026-09-01', '9:00', '13:00', 0),
    rec('A', '2026-09-01', '14:00', '20:00', 0),
  ]);
  assert.equal(p.workMin, 600);
  assert.equal(p.overMin, 120);
  assert.equal(p.days.length, 1);
});

test('連続勤務：6日以上で表示', () => {
  const days = (n) => Array.from({ length: n }, (_, i) => rec('A', `2026-09-${String(7 + i).padStart(2, '0')}`, '9:00', '18:00', 60));
  assert.equal(one(days(5)).streakFlag, false);
  assert.equal(one(days(5)).maxStreak, 5);
  assert.equal(one(days(6)).streakFlag, true);
  assert.equal(one(days(7)).maxStreak, 7); // 7〜13日
  // 間が1日空けば別
  const gap = [...days(3), rec('A', '2026-09-11', '9:00', '18:00', 60), rec('A', '2026-09-12', '9:00', '18:00', 60)];
  assert.equal(one(gap).maxStreak, 3);
});

test('判定の境界：時間外45:00ちょうどは対象外、45:01で黄', () => {
  assert.equal(judge(2700, 2700), 'none');
  assert.equal(judge(2701, 2701), 'yellow');
  assert.equal(judge(2700, 4799), 'none');
  assert.equal(judge(2701, 4799), 'yellow');
  assert.equal(judge(2000, 4800), 'orange'); // 時間外＋休日が80時間ちょうど
  assert.equal(judge(0, 5999), 'orange');
  assert.equal(judge(0, 6000), 'red');
});

test('判定：時間外46:00＋休日労働34:00＝80:00ちょうどで橙、1分少なければ黄', () => {
  const build = (lastSundayEnd) => {
    const r = [];
    const weekdays = [1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25];
    weekdays.forEach((d, i) => {
      // 18日は 9:00-20:30（時間外150分）、最後の1日だけ 9:00-19:00（時間外60分）→ 18×150+60 = 2760分
      const end = i === weekdays.length - 1 ? '19:00' : '20:30';
      r.push(rec('A', `2026-09-${String(d).padStart(2, '0')}`, '9:00', end, 60));
    });
    // 日曜4日 × 510分（9:00-17:30 休憩0）= 2040分
    [6, 13, 20].forEach((d) => r.push(rec('A', `2026-09-${String(d).padStart(2, '0')}`, '9:00', '17:30', 0)));
    r.push(rec('A', '2026-09-27', '9:00', lastSundayEnd, 0));
    return r;
  };
  const exact = one(build('17:30'));
  assert.equal(exact.overMin, 2760);
  assert.equal(exact.holidayMin, 2040);
  assert.equal(exact.overPlusHolidayMin, 4800);
  assert.equal(exact.status, 'orange');
  const less = one(build('17:29'));
  assert.equal(less.overPlusHolidayMin, 4799);
  assert.equal(less.status, 'yellow'); // 時間外46時間は45時間超
});

test('週40時間（参考）：月〜土 各9時間勤務 → 所定分480×6=2880、40時間を超える480分', () => {
  const recs = ['07', '08', '09', '10', '11', '12'].map((d) => rec('A', `2026-09-${d}`, '9:00', '19:00', 60));
  const p = one(recs);
  assert.equal(p.weeklyOverMin, 480);
  assert.equal(p.overMin, 6 * 60);
});

test('締め日：20日締めなら 9/21 は10月分、9/20 は9月分', () => {
  assert.equal(periodKeyOf('2026-09-20', 20), '2026-09');
  assert.equal(periodKeyOf('2026-09-21', 20), '2026-10');
  assert.equal(periodKeyOf('2026-12-25', 20), '2027-01');
  assert.equal(periodKeyOf('2026-09-30', 'end'), '2026-09');
  const res = calculate([
    rec('A', '2026-09-20', '9:00', '18:00', 60),
    rec('A', '2026-09-21', '9:00', '18:00', 60),
  ], { closeDay: 20 });
  assert.deepEqual(res.periods.map((p) => p.key), ['2026-09', '2026-10']);
  assert.equal(res.periods[1].label, '2026年10月分（9/21〜10/20）');
});

test('入力エラー：読めない行は errors に出し、計算には入れない。休み（出退勤が空）はエラーにしない', () => {
  const res = calculate([
    rec('A', '2026-09-01', '9:00', '18:00', 60),
    rec('A', '2026-09-02', '', '', ''),
    rec('A', '2026-09-03', '9:00', '', ''),
    rec('A', 'x', '9:00', '18:00', ''),
    rec('A', '2026-09-05', '9:xx', '18:00', ''),
    rec('', '2026-09-05', '9:00', '18:00', ''),
  ]);
  assert.equal(res.errors.length, 4);
  assert.equal(res.periods[0].people[0].workDays, 1);
});

test('同じ入力なら毎回同じ結果', () => {
  const records = [rec('A', '2026-09-01', '22:00', '07:00', 60), rec('B', '2026-09-06', '9:00', '20:00', '')];
  assert.deepEqual(calculate(records), calculate(records));
});

test('表示用の整形', () => {
  assert.equal(fmtHM(0), '0:00');
  assert.equal(fmtHM(125), '2:05');
  assert.equal(fmtHM(5105), '85:05');
  assert.equal(fmtClock(1860), '07:00');
});

// ---- CSV ---------------------------------------------------------------------

test('CSV：BOM・引用符・CRLF・見出しの自動対応', () => {
  const text = '﻿氏名,日付,出勤,退勤,休憩分\r\n"山田, 太郎",2026/9/1,9:00,18:00,\r\n';
  const bytes = new TextEncoder().encode(text);
  const rows = parseCsv(decodeCsvBytes(bytes.buffer));
  assert.equal(rows[1][0], '山田, 太郎');
  const map = guessColumns(rows[0]);
  assert.deepEqual(map, { name: 0, date: 1, start: 2, end: 3, breakMin: 4 });
  const records = toRecords(rows, map);
  assert.equal(records[0].row, 2);
  assert.equal(one(records).workMin, 480);
});

test('CSV：Shift_JIS のファイルも読める', () => {
  // 「氏名,日付」を Shift_JIS にしたバイト列
  const sjis = new Uint8Array([0x8e, 0x81, 0x96, 0xbc, 0x2c, 0x93, 0xfa, 0x95, 0x74, 0x0a, 0x41, 0x2c, 0x31, 0x0a]);
  const rows = parseCsv(decodeCsvBytes(sjis.buffer));
  assert.deepEqual(rows[0], ['氏名', '日付']);
});

// ---- 同梱サンプル：別の方法（1分ずつ数える）で計算した値と一致すること -------------------

function bruteForce(records) {
  // 1分ずつ数える独立実装。休憩は昼間にとったものとして深夜からは引かない。
  const people = new Map();
  for (const r of records) {
    const [, mo, da] = r.date.split('-').map(Number);
    const sMin = parseTime(r.start); let eMin = parseTime(r.end);
    if (eMin < sMin) eMin += 1440;
    let total = 0; let night = 0;
    for (let m = sMin; m < eMin; m++) {
      total++;
      const t = m % 1440;
      if (t < 300 || t >= 1320) night++;
    }
    const br = r.breakMin === '' ? 60 : Number(r.breakMin);
    const work = total - br;
    const wd = new Date(Date.UTC(2026, mo - 1, da)).getUTCDay();
    const p = people.get(r.name) ?? { work: 0, over: 0, night: 0, holiday: 0 };
    p.work += work; p.night += Math.min(night, work);
    if (wd === 0) p.holiday += work; else p.over += Math.max(0, work - 480);
    people.set(r.name, p);
  }
  return people;
}

test('同梱サンプル（5人×2026年9月）が1分単位で一致する', () => {
  const text = decodeCsvBytes(readFileSync(new URL('../public/sample/attendance-sample-2026-09.csv', import.meta.url)));
  const rows = parseCsv(text);
  const records = toRecords(rows, guessColumns(rows[0]));
  const res = calculate(records);
  assert.equal(res.errors.length, 0);
  assert.equal(res.periods.length, 1);
  const expected = bruteForce(records);
  assert.equal(res.periods[0].people.length, 5);
  for (const p of res.periods[0].people) {
    const e = expected.get(p.name);
    assert.deepEqual(
      { work: p.workMin, over: p.overMin, night: p.nightMin, holiday: p.holidayMin },
      e, p.name,
    );
  }
  const by = Object.fromEntries(res.periods[0].people.map((p) => [p.name, p]));
  assert.equal(by['青木 一郎'].status, 'orange');
  assert.equal(by['青木 一郎'].streakFlag, true);
  assert.equal(by['伊藤 花子'].status, 'yellow');
  assert.equal(by['上田 健'].status, 'none');
  assert.ok(by['遠藤 美咲'].nightMin > 0 && by['遠藤 美咲'].holidayMin === 420);
  // デモで「一番多い人」が先頭に来る
  assert.equal(res.periods[0].people[0].name, '青木 一郎');
});
