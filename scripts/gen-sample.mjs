// デモ用の打刻データ（架空の5人×2026年9月）を作る。毎回同じ内容になる（乱数なし）。
//   node scripts/gen-sample.mjs
// 狙い：青木＝橙（時間外80時間超・6日連勤）／伊藤＝黄（45時間超）／上田＝通常／
//       遠藤＝深夜・日またぎ・法定休日の出勤／小川＝休憩の列が空（既定60分）と0分
import { writeFileSync } from 'node:fs';
import { calculate, fmtHM } from '../public/js/overtime.js';

const YEAR = 2026; const MONTH = 9;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${YEAR}-${pad(MONTH)}-${pad(d)}`;
const wd = (d) => new Date(Date.UTC(YEAR, MONTH - 1, d)).getUTCDay(); // 0=日
const OFF_WEEKDAYS = new Set([21, 22, 23]); // 敬老の日・国民の休日・秋分の日（会社は休み）
const rows = [];
const add = (name, d, start, end, br = '') => rows.push([name, iso(d), start, end, br]);
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

for (let d = 1; d <= 30; d++) {
  const w = wd(d);
  const weekday = w >= 1 && w <= 5 && !OFF_WEEKDAYS.has(d);

  // 青木：平日 9:00-22:30（休憩60）＋第2〜4土曜 9:00-15:00 → 時間外が約85時間、6日連勤
  if (weekday) add('青木 一郎', d, '09:00', hm(22 * 60 + 30 + (d % 3) * 5), 60);
  if (w === 6 && d >= 12 && d <= 26) add('青木 一郎', d, '09:00', '15:00', 60);

  // 伊藤：平日 9:00-20:30（休憩60） → 時間外が約47.5時間（黄）
  if (weekday) add('伊藤 花子', d, '09:00', hm(20 * 60 + 30 + (d % 3) * 5), 60);

  // 上田：ほぼ定時、ときどき30分〜1時間の残業
  if (weekday) add('上田 健', d, '09:00', d % 5 === 0 ? '19:00' : d % 4 === 0 ? '18:30' : '18:00', 60);

  // 小川：9:00-18:00。休憩の列は空（既定60分）。短い日は休憩0を明記
  if (weekday) {
    if (d % 6 === 0) add('小川 大輔', d, '09:00', '13:00', 0);
    else add('小川 大輔', d, '09:00', '18:00', '');
  }
}

// 遠藤：日勤＋夜勤（22:00→翌7:00、日またぎ）5回＋日曜出勤（法定休日）1回
for (let d = 1; d <= 30; d++) {
  const w = wd(d);
  const weekday = w >= 1 && w <= 5 && !OFF_WEEKDAYS.has(d);
  if (weekday && ![2, 9, 16, 24, 29].includes(d)) add('遠藤 美咲', d, '09:00', d % 7 === 0 ? '19:30' : '18:00', 60);
}
for (const d of [2, 9, 16, 24, 29]) add('遠藤 美咲', d, '22:00', '07:00', 60);
add('遠藤 美咲', 13, '09:00', '17:00', 60); // 日曜（法定休日）

// 日付→氏名の順に並べる（打刻データらしく、日付順）
const order = ['青木 一郎', '伊藤 花子', '上田 健', '遠藤 美咲', '小川 大輔'];
rows.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : order.indexOf(a[0]) - order.indexOf(b[0]) || (a[2] < b[2] ? -1 : 1)));

const csv = '﻿氏名,日付,出勤,退勤,休憩分\r\n' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
writeFileSync(new URL('../public/sample/attendance-sample-2026-09.csv', import.meta.url), csv);

// 目視用のサマリ
const res = calculate(rows.map(([name, date, start, end, breakMin], i) => ({ row: i + 2, name, date, start, end, breakMin })));
for (const p of res.periods[0].people) {
  console.log(`${p.name}\t出勤${p.workDays}日\t実労働${fmtHM(p.workMin)}\t時間外${fmtHM(p.overMin)}\t深夜${fmtHM(p.nightMin)}\t休日${fmtHM(p.holidayMin)}\t連勤${p.maxStreak}\t${p.status}`);
}
console.log(`rows=${rows.length} errors=${res.errors.length}`);
