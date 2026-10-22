// シフト表のチェック（/shift.html）の見本を作る：架空の介護施設「グループホーム ひなた（架空）」の10人×2026年11月。
// 10日で一回りする並び（早 早 日 休 遅 遅 夜 明 休 休）を人ごとにずらして、どの日も 早2・日1・遅2・夜1・明1・休3 にする
// （平日 朝2・昼3・夕2・夜1／土日祝 朝2・昼2・夕2・夜1 をちょうど満たす）。そこへ、わざと問題を入れる。
// 実行：node scripts/gen-shift-sample.mjs → public/samples/shift/ に Excel・CSV・samples.json
import { mkdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { monthDays, DEFAULT_SYMBOLS } from '../public/js/shift-check.js';

export const PERIOD = '2026-11';
export const FACILITY = 'グループホーム ひなた（架空）';
const PATTERN = ['早', '早', '日', '休', '遅', '遅', '夜', '明', '休', '休'];
const NAMES = ['佐藤 花子', '鈴木 一郎', '高橋 美咲', '田中 健太', '伊藤 由美', '渡辺 翔', '山本 恵子', '中村 大輔', '小林 さくら', '加藤 誠'];

const days = monthDays(PERIOD);
const people = NAMES.map((name, i) => ({ name, cells: days.map((_, d) => PATTERN[(d + ((3 * i) % 10)) % 10]) }));
const set = (name, day, code) => { people.find((p) => p.name === name).cells[day - 1] = code; };

// ---- わざと入れる問題（台本 docs/demo-scenario.md と単体テスト test/shift-check.test.js で同じものを見る） ----
set('鈴木 一郎', 12, '有'); //   12日（木）：遅番の鈴木さんが有給 → 昼の16〜17時と、夕の18〜22時が1人不足
set('山本 恵子', 14, '日'); //   14日（土）：早番が1人だけ → 朝の7〜9時が1人不足
set('小林 さくら', 20, '日'); // 20日：休みを返上して日勤 → 17〜23日の7連勤・月の休日8日
set('加藤 誠', 19, '早'); //     19日：加藤さんと鈴木さんの早番・遅番を入れ替え → 加藤さんは遅番（22時まで）の次の日に早番（7時から）＝間9時間
set('鈴木 一郎', 19, '遅');
// 希望休：渡辺さんの20日は遅番のまま（ぶつかり）、田中さんの19日は夜勤明け（丸1日の休みにならない）。ほかは休みで、印は出ない
export const HOPES = [
  '佐藤 花子,11/9',
  '加藤 誠,2026/11/3',
  '渡辺 翔,20',
  '田中 健太,19',
  '高橋 美咲,11/23',
  '中村 大輔,11/28',
  '伊藤 由美,11/27',
].join('\n');

const OUT = 'public/samples/shift';
mkdirSync(OUT, { recursive: true });

// ---- CSV（氏名,1,2,…,30。UTF-8 BOM 付き） ----
const csv = [['氏名', ...days.map((d) => String(d.day))], ...people.map((p) => [p.name, ...p.cells])].map((r) => r.join(',')).join('\r\n');
writeFileSync(`${OUT}/shift-sample-2026-11.csv`, `﻿${csv}\r\n`);

// ---- Excel（よくある勤務表の形：題名・記号の説明・日の行・曜日の行・人・人数の集計の行） ----
const wb = new ExcelJS.Workbook();
wb.creator = 'ソエギ デモ';
const ws = wb.addWorksheet('勤務表', {
  views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }],
  pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
});
const last = days.length + 1;
ws.getColumn(1).width = 14;
for (let c = 2; c <= last; c++) ws.getColumn(c).width = 4.2;
ws.getCell('A1').value = `2026年11月 勤務表　${FACILITY}`;
ws.getCell('A1').font = { bold: true, size: 14 };
ws.getCell('A2').value = DEFAULT_SYMBOLS.map((s) => (s.start ? `${s.code} ${s.name} ${s.start.replace(/^0/, '')}–${s.end.replace(/^0/, '')}` : `${s.code} ${s.name}`)).join('　');
ws.getCell('A2').font = { size: 9, color: { argb: 'FF555555' } };
const head = ws.getRow(3); const week = ws.getRow(4);
head.getCell(1).value = '氏名'; week.getCell(1).value = '曜日';
const thin = { style: 'thin', color: { argb: 'FFBBBBBB' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
days.forEach((d, i) => {
  head.getCell(i + 2).value = d.day; week.getCell(i + 2).value = d.weekday;
  for (const r of [head, week]) {
    const c = r.getCell(i + 2);
    c.alignment = { horizontal: 'center' };
    if (d.type === 'holiday') c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE3E3' } };
  }
});
for (const r of [head, week]) r.eachCell((c) => { c.font = { bold: true }; c.border = border; });
people.forEach((p, k) => {
  const row = ws.getRow(5 + k);
  row.getCell(1).value = p.name;
  p.cells.forEach((v, i) => { const c = row.getCell(i + 2); c.value = v; c.alignment = { horizontal: 'center' }; });
  row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
});
// 人数の集計の行（COUNTIF の数式。結果も入れておく）。チェックの画面は、数だけの行を読み飛ばす
const firstPerson = 5; const lastPerson = 4 + people.length;
['早', '日', '遅', '夜'].forEach((code, k) => {
  const row = ws.getRow(lastPerson + 2 + k);
  row.getCell(1).value = `${code}の人数`;
  days.forEach((_, i) => {
    const col = ws.getColumn(i + 2).letter;
    const n = people.filter((p) => p.cells[i] === code).length;
    row.getCell(i + 2).value = { formula: `COUNTIF(${col}${firstPerson}:${col}${lastPerson},"${code}")`, result: n };
    row.getCell(i + 2).alignment = { horizontal: 'center' };
  });
  row.font = { color: { argb: 'FF555555' } };
});
await wb.xlsx.writeFile(`${OUT}/shift-sample-2026-11.xlsx`);

writeFileSync(`${OUT}/samples.json`, `${JSON.stringify({
  period: PERIOD,
  facility: FACILITY,
  xlsx: 'shift-sample-2026-11.xlsx',
  csv: 'shift-sample-2026-11.csv',
  hopes: HOPES,
}, null, 2)}\n`);
console.log(`wrote ${OUT}: ${people.length}人×${days.length}日`);
