// 紙のタイムカード・出勤簿の写真：AIが読んだ表を、プログラムで確かめる。計算は overtime.js（AIは計算しない）。
//  赤：氏名が空／日付が読めない・対象の月の外（締め日を見る）／出勤か退勤の片方が空／時刻・休憩が読めない／出勤が24時以降・24時間を超える
//      （赤の行は計算から外れる。計算エンジン overtime.js が外す行は、ここでも必ず赤にする＝「OK」のまま黙って外れない）
//  黄：退勤が出勤より早い（日またぎ？）／勤務が16時間を超える／休憩が勤務より長い／同じ人の同じ日が2行／確かさ「低」（手書きの修正・にじみ）／
//      二重打刻（1つの欄に2つの時刻。人が選ぶ）／外出・戻りの片方だけ・読めない・逆／休憩の欄が使われない／出勤も退勤も空
// 外出と戻りがそろっていれば、休憩はプログラムが「戻り−外出」で決める（AIの読んだ休憩より優先）
import { parseDate, parseTime, parseBreak, isBlank, normalizeName, calculate, periodKeyOf, periodLabel } from './overtime.js';

const LONG_MIN = 16 * 60;
const DAY = 24 * 60;
const LABEL = { start: '出勤', end: '退勤', out: '外出', back: '戻り' };

/**
 * 休憩の決まり方。外出・戻りがそろっていれば「戻り−外出」（夜勤で0時をまたぐ外出も数える）。
 * 無ければ読んだ休憩、空なら設定の既定。
 * @returns {{value:number|string, source:'outback'|'field'|'default'}}  value は計算エンジンに渡す値
 */
export function breakInfo(r) {
  const o = parseTime(r.out); const b = parseTime(r.back);
  if (!isBlank(r.out) && !isBlank(r.back) && o != null && b != null) {
    if (b >= o) return { value: b - o, source: 'outback' };
    const s = parseTime(r.start); const e = parseTime(r.end);
    if (s != null && e != null && e < s) return { value: b + DAY - o, source: 'outback' }; // 夜勤：23:30 外出 → 0:30 戻り
  }
  if (!isBlank(r.breakMin)) return { value: r.breakMin, source: 'field' };
  return { value: '', source: 'default' };
}
export const effectiveBreak = (r) => breakInfo(r).value;

/** 計算エンジンに渡す形（overtime.js の calculate の records） */
export const toCalcRecord = (r, i) => ({ name: r.name, date: r.date, start: r.start, end: r.end, breakMin: effectiveBreak(r), row: i + 1 });

/**
 * @param records 画面の行 [{name, date, start, end, out, back, breakMin, startAlt, endAlt, conf:{start,end,out,back}, note}]
 * @param opts 'YYYY-MM' か {period:'YYYY-MM', closeDay:'end'|数}。対象の月（締め日で決まる集計期間）。空なら確かめない
 * @returns {{flags:{field, level, message}[]}[]}  field は name|date|start|end|out|back|breakMin|row
 */
export function checkTimecards(records, opts = '') {
  const { period = '', closeDay = 'end' } = typeof opts === 'string' ? { period: opts } : opts;
  const out = records.map((r) => {
    const flags = [];
    const add = (field, level, message) => flags.push({ field, level, message });
    if (!normalizeName(r.name)) add('name', 'red', '氏名が空です');

    const date = parseDate(r.date);
    if (isBlank(r.date) || !date) add('date', 'red', '日付を読めません');
    else if (period && periodKeyOf(date, closeDay) !== period) add('date', 'red', `対象の月（${periodLabel(period, closeDay)}）の外の日付です`);

    const noStart = isBlank(r.start); const noEnd = isBlank(r.end);
    const s = parseTime(r.start); const e = parseTime(r.end);
    if (noStart && noEnd) add('row', 'yellow', '出勤も退勤も空です（休みの日なら、この行を削除してください）');
    else if (noStart || noEnd) add(noStart ? 'start' : 'end', 'red', `${noStart ? '出勤' : '退勤'}が空です`);
    if (!noStart && s == null) add('start', 'red', '出勤の時刻を読めません');
    if (!noEnd && e == null) add('end', 'red', '退勤の時刻を読めません');
    if (s != null && s >= DAY) add('start', 'red', '出勤が24時以降です（翌日の行にしてください）');
    const bi = breakInfo(r);
    const br = bi.source === 'outback' ? bi.value : parseBreak(r.breakMin);
    if (bi.source !== 'outback' && Number.isNaN(br)) add('breakMin', 'red', '休憩を読めません（分の数で入れてください）');
    if (s != null && e != null && s < DAY) {
      if (e < s) add('end', 'yellow', '退勤が出勤より早い時刻です（日またぎ？夜勤なら、そのままで構いません）');
      const span = (e < s ? e + DAY : e) - s;
      if (span > DAY) add('row', 'red', '勤務が24時間を超えています');
      else if (span > LONG_MIN) add('row', 'yellow', `勤務が16時間を超えています（${Math.floor(span / 60)}時間${span % 60}分）`);
      if (typeof br === 'number' && !Number.isNaN(br) && br > span) add('breakMin', 'yellow', '休憩が勤務の時間より長くなっています');
    }

    // 外出・戻り
    const hasOut = !isBlank(r.out); const hasBack = !isBlank(r.back);
    const o = parseTime(r.out); const b = parseTime(r.back);
    if (hasOut && o == null) add('out', 'yellow', '外出の時刻を読めません（休憩を計算できません）');
    if (hasBack && b == null) add('back', 'yellow', '戻りの時刻を読めません（休憩を計算できません）');
    if (hasOut !== hasBack) add(hasOut ? 'back' : 'out', 'yellow', `${hasOut ? '戻り' : '外出'}が空です（外出・戻りの両方があるとき、休憩を計算します）`);
    else if (hasOut && o != null && b != null && bi.source !== 'outback') add('back', 'yellow', '戻りが外出より早い時刻です（休憩を計算できません）');
    // 外出・戻りから休憩を計算したときは、休憩の欄の値を使わないことを知らせる
    if (bi.source === 'outback' && !isBlank(r.breakMin) && parseBreak(r.breakMin) !== bi.value) add('breakMin', 'yellow', `外出・戻りがあるので、休憩は戻り−外出の${bi.value}分で計算します（休憩の欄の値は使いません）`);

    // 二重打刻（人が選ぶ）と、読み取りに自信のない時刻
    for (const f of ['start', 'end']) {
      const alt = f === 'start' ? r.startAlt : r.endAlt;
      if (!isBlank(alt)) add(f, 'yellow', `二重打刻：${LABEL[f]}の欄に ${r[f] || '（空）'} と ${alt} があります。正しいほうを選んでください`);
    }
    // 気づき（note）は、その欄のことが書いてある欄に付ける（どの欄のことか分からなければ、最初の欄だけに）
    const low = ['start', 'end', 'out', 'back'].filter((f) => r.conf?.[f] === '低' && isBlank(f === 'start' ? r.startAlt : f === 'end' ? r.endAlt : ''));
    const noteFor = low.filter((f) => r.note && r.note.includes(LABEL[f]));
    for (const f of low) {
      const withNote = r.note && (noteFor.length ? noteFor.includes(f) : f === low[0]);
      add(f, 'yellow', `${LABEL[f]}の読み取りに自信がありません${withNote ? `（${r.note}）` : ''}`);
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
 * 直す前（AIが読んだまま）と直した後（いまの表）を、同じ計算エンジン（同じ設定）で集計して並べる。
 * 判定は月（集計期間）ごとなので、人×集計期間ごとに並べる（期間をまたいで足さない）
 * @returns {{name:string, period:string, label:string, before:{overMin, overPlusHolidayMin, status}|null, after:{…}|null}[]}
 */
export function compareRuns(beforeRecords, afterRecords, settings) {
  const sumUp = (records) => {
    const res = calculate(records.map(toCalcRecord), settings);
    const m = new Map();
    for (const p of res.periods) for (const x of p.people) {
      m.set(`${x.name}|${p.key}`, { name: x.name, period: p.key, label: p.label, overMin: x.overMin, overPlusHolidayMin: x.overPlusHolidayMin, status: x.status });
    }
    return m;
  };
  const a = sumUp(beforeRecords); const b = sumUp(afterRecords);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x.split('|')[1].localeCompare(y.split('|')[1]));
  return keys.map((k) => {
    const x = b.get(k) ?? a.get(k);
    return { name: x.name, period: x.period, label: x.label, before: a.get(k) ?? null, after: b.get(k) ?? null };
  });
}
