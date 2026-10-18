// 紙のタイムカード・出勤簿の写真：AIが読んだ表を、プログラムで確かめる。計算は overtime.js（AIは計算しない）。
//  赤：氏名が空／日付が読めない・対象の月の外／出勤か退勤の片方が空／時刻が読めない
//  黄：退勤が出勤より早い（日またぎ？）／勤務が16時間を超える／同じ人の同じ日が2行／確かさ「低」（手書きの修正・にじみ）／
//      二重打刻（1つの欄に2つの時刻。人が選ぶ）／外出か戻りの片方だけ・戻りが外出より早い／出勤も退勤も空
// 外出と戻りがそろっていれば、休憩はプログラムが「戻り−外出」で決める（AIの読んだ休憩より優先）
import { parseDate, parseTime, isBlank, normalizeName, calculate } from './overtime.js';

const LONG_MIN = 16 * 60;
const DAY = 24 * 60;
const LABEL = { start: '出勤', end: '退勤', out: '外出', back: '戻り' };

/** 休憩の分。外出・戻りがそろっていれば「戻り−外出」、無ければ読んだ休憩（空なら ''＝設定の既定） */
export function effectiveBreak(r) {
  const o = parseTime(r.out); const b = parseTime(r.back);
  if (!isBlank(r.out) && !isBlank(r.back) && o != null && b != null && b >= o) return b - o;
  return r.breakMin ?? '';
}

/** 計算エンジンに渡す形（overtime.js の calculate の records） */
export const toCalcRecord = (r, i) => ({ name: r.name, date: r.date, start: r.start, end: r.end, breakMin: effectiveBreak(r), row: i + 1 });

const jpMonth = (period) => `${+period.slice(0, 4)}年${+period.slice(5, 7)}月`;

/**
 * @param records 画面の行 [{name, date, start, end, out, back, breakMin, startAlt, endAlt, conf:{start,end,out,back}, note}]
 * @param period 'YYYY-MM'（対象の月。空なら月は確かめない）
 * @returns {{flags:{field, level, message}[]}[]}  field は name|date|start|end|out|back|breakMin|row
 */
export function checkTimecards(records, period = '') {
  const out = records.map((r) => {
    const flags = [];
    const add = (field, level, message) => flags.push({ field, level, message });
    if (!normalizeName(r.name)) add('name', 'red', '氏名が空です');

    const date = parseDate(r.date);
    if (isBlank(r.date) || !date) add('date', 'red', '日付を読めません');
    else if (period && !date.startsWith(period)) add('date', 'red', `対象の月（${jpMonth(period)}）の外の日付です`);

    const noStart = isBlank(r.start); const noEnd = isBlank(r.end);
    const s = parseTime(r.start); const e = parseTime(r.end);
    if (noStart && noEnd) add('row', 'yellow', '出勤も退勤も空です（休みの日なら、この行を削除してください）');
    else if (noStart || noEnd) add(noStart ? 'start' : 'end', 'red', `${noStart ? '出勤' : '退勤'}が空です`);
    if (!noStart && s == null) add('start', 'red', '出勤の時刻を読めません');
    if (!noEnd && e == null) add('end', 'red', '退勤の時刻を読めません');
    if (s != null && e != null) {
      if (e < s) add('end', 'yellow', '退勤が出勤より早い時刻です（日またぎ？夜勤なら、そのままで構いません）');
      const span = (e < s ? e + DAY : e) - s;
      if (span > LONG_MIN) add('row', 'yellow', `勤務が16時間を超えています（${Math.floor(span / 60)}時間${span % 60}分）`);
    }

    // 外出・戻り
    const hasOut = !isBlank(r.out); const hasBack = !isBlank(r.back);
    if (hasOut !== hasBack) add(hasOut ? 'back' : 'out', 'yellow', `${hasOut ? '戻り' : '外出'}が空です（外出・戻りの両方があるとき、休憩を計算します）`);
    else if (hasOut && parseTime(r.back) != null && parseTime(r.out) != null && parseTime(r.back) < parseTime(r.out)) add('back', 'yellow', '戻りが外出より早い時刻です');

    // 二重打刻（人が選ぶ）と、読み取りに自信のない時刻
    for (const f of ['start', 'end']) {
      const alt = f === 'start' ? r.startAlt : r.endAlt;
      if (!isBlank(alt)) add(f, 'yellow', `二重打刻：${LABEL[f]}の欄に ${r[f] || '（空）'} と ${alt} があります。正しいほうを選んでください`);
    }
    for (const f of ['start', 'end', 'out', 'back']) {
      const alt = f === 'start' ? r.startAlt : f === 'end' ? r.endAlt : '';
      if (r.conf?.[f] === '低' && isBlank(alt)) add(f, 'yellow', `${LABEL[f]}の読み取りに自信がありません${r.note ? `（${r.note}）` : ''}`);
    }
    return { flags };
  });

  // 同じ人の同じ日が2行
  const seen = new Map();
  records.forEach((r, i) => {
    const date = parseDate(r.date); const name = normalizeName(r.name);
    if (!date || !name) return;
    const k = `${name}|${date}`;
    seen.set(k, [...(seen.get(k) ?? []), i]);
  });
  for (const idx of seen.values()) if (idx.length > 1) for (const i of idx) out[i].flags.push({ field: 'row', level: 'yellow', message: '同じ人の同じ日が2行あります（2回の勤務なら、そのままで構いません）' });
  return out;
}

export const worstOf = (flags) => (flags.some((f) => f.level === 'red') ? 'red' : flags.some((f) => f.level === 'yellow') ? 'yellow' : null);
export const levelOf = (flags, field) => worstOf(flags.filter((f) => f.field === field));

/**
 * 直す前（AIが読んだまま）と直した後（いまの表）を、同じ計算エンジンで集計して並べる。
 * @returns {{name:string, before:{overMin:number, status:string}|null, after:{overMin:number, status:string}|null}[]}
 */
export function compareRuns(beforeRecords, afterRecords, settings) {
  const sumUp = (records) => {
    const res = calculate(records.map(toCalcRecord), settings);
    const m = new Map();
    for (const p of res.periods) for (const x of p.people) {
      const cur = m.get(x.name) ?? { overMin: 0, overPlusHolidayMin: 0 };
      m.set(x.name, { overMin: cur.overMin + x.overMin, overPlusHolidayMin: cur.overPlusHolidayMin + x.overPlusHolidayMin, status: x.status });
    }
    return m;
  };
  const a = sumUp(beforeRecords); const b = sumUp(afterRecords);
  const names = [...new Set([...a.keys(), ...b.keys()])];
  return names.map((name) => ({ name, before: a.get(name) ?? null, after: b.get(name) ?? null }));
}
