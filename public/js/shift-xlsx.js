// シフト表のチェック：Excel を読む（ExcelJS のシート → 行の配列）と、結果の Excel（一覧／人ごと／色を付けたシフト表／使った設定）。
// 中身は shift-check.js の結果から作る。ExcelJS はページ側で読み込んだものを渡す（テストでは node の exceljs を渡す）。
import { COLORS, fill, styleHeader } from './xlsx-common.js';
import { BANDS, KIND_LABEL, PROBLEM_KINDS, normCode, worstOf } from './shift-check.js';

const LEVEL_FILL = { red: COLORS.red, yellow: COLORS.yellow };
const LEVEL_TEXT = { red: '要確認', yellow: '注意' };
export const SHIFT_NOTE = 'デモ用の架空データです。シフト表は画面の中だけで読み、送信・保存しません（AIは使いません）。';

/** ExcelJS のマスの値 → 文字・数・日付（数式は結果、リッチテキストは文字だけ） */
export function cellValue(v) {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text ?? '');
    return '';
  }
  return v;
}

/** ExcelJS のシート → 行の配列（空のマスは ''） */
export function sheetRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (c, col) => { arr[col - 1] = cellValue(c.value); });
    rows[n - 1] = arr;
  });
  return Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? ''));
}

const ym = (period) => `${+period.slice(0, 4)}年${+period.slice(5, 7)}月`;
const thin = { style: 'thin', color: { argb: 'FFBBBBBB' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

/**
 * @param state {grid, result（checkShift の結果）, settings（checkShift に渡したもの）, title}
 */
export function buildShiftWorkbook(ExcelJS, { grid, result, settings, title = '' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ソエギ デモ';
  const { days, problems, people, cellFlags, dayFlags, bandCount } = result;
  const red = problems.filter((p) => p.level === 'red').length;
  const yellow = problems.length - red;

  // ---- 一覧 ----
  const list = wb.addWorksheet('一覧', { views: [{ state: 'frozen', ySplit: 1 }] });
  list.columns = [{ header: '判定', width: 9 }, { header: '種類', width: 18 }, { header: '日', width: 6 }, { header: '氏名', width: 14 }, { header: '内容', width: 80 }];
  styleHeader(list.getRow(1));
  for (const p of problems) {
    const row = list.addRow([LEVEL_TEXT[p.level], PROBLEM_KINDS[p.kind] ?? p.kind, p.day ?? null, p.person ?? '', p.text]);
    row.getCell(1).fill = fill(LEVEL_FILL[p.level]);
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
  }
  if (!problems.length) list.addRow(['', '', null, '', '見つかった問題はありません']);
  list.addRow([]);
  list.addRow([`${ym(grid.period)}${title ? `　${title}` : ''}：要確認（赤）${red}件／注意（黄）${yellow}件`]);
  list.addRow(['※ 判定はすべてプログラムが行います（AIは使いません）。人数は1時間ごとに、その1時間ずっといる人を数えます。']);
  list.addRow(['※ 勤務と勤務の間の時間は参考の表示です。法的な判断は、社会保険労務士にご確認ください。']);
  list.addRow([SHIFT_NOTE]);

  // ---- 人ごと ----
  const per = wb.addWorksheet('人ごと', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  per.columns = [
    { header: '氏名', width: 14 }, { header: '出勤日数', width: 9 }, { header: '休日数', width: 8 }, { header: '有給など', width: 9 }, { header: '夜勤明け', width: 9 },
    { header: '夜勤の回数', width: 10 }, { header: '最大連勤', width: 9 }, { header: '上限を超えた連勤', width: 15 }, { header: '希望休とのぶつかり', width: 16 },
    { header: '勤務の間が短い（参考）', width: 19 }, { header: '空・表にない記号', width: 15 },
  ];
  styleHeader(per.getRow(1));
  const rules = settings.rules;
  for (const x of people) {
    const row = per.addRow([x.name, x.workDays, x.holidays, x.leaves, x.afters, x.nights, x.maxStreak, x.streakRuns, x.conflicts, x.intervals, x.blanks + x.unknowns]);
    if (x.holidays < rules.minHolidays) row.getCell(3).fill = fill(COLORS.yellow);
    if (x.maxStreak > rules.maxStreak) { row.getCell(7).fill = fill(COLORS.yellow); row.getCell(8).fill = fill(COLORS.yellow); }
    if (x.conflicts) row.getCell(9).fill = fill(COLORS.red);
    if (x.intervals) row.getCell(10).fill = fill(COLORS.yellow);
    if (x.unknowns) row.getCell(11).fill = fill(COLORS.red); else if (x.blanks) row.getCell(11).fill = fill(COLORS.yellow);
  }
  per.addRow([]);
  per.addRow([`※ 休日数は「${KIND_LABEL.off}」の記号の数です（有給・夜勤明けは数えません）。下限は${rules.minHolidays}日、連勤の上限は${rules.maxStreak}日です。`]);

  // ---- 色を付けたシフト表 ----
  const sh = wb.addWorksheet('シフト表', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sh.getColumn(1).width = 16;
  days.forEach((_, i) => { sh.getColumn(i + 2).width = 5; });
  sh.getCell('A1').value = `${ym(grid.period)} シフト表のチェック${title ? `　${title}` : ''}（色のマスにはメモがあります）`;
  sh.getCell('A1').font = { bold: true, size: 13 };
  const head = sh.getRow(2); const week = sh.getRow(3);
  head.getCell(1).value = '氏名'; week.getCell(1).value = '曜日';
  days.forEach((d, i) => {
    const a = head.getCell(i + 2); const b = week.getCell(i + 2);
    a.value = d.day; b.value = d.isHoliday ? `${d.weekday}祝` : d.weekday;
    const df = dayFlags.get(d.day);
    for (const c of [a, b]) {
      c.alignment = { horizontal: 'center' };
      if (df) c.fill = fill(COLORS.red); else if (d.type === 'holiday') c.fill = fill(COLORS.gray);
    }
    if (df) a.note = `人が足りない時間帯があります（${df.text}）`;
  });
  for (const r of [head, week]) r.eachCell((c) => { c.font = { bold: true }; c.border = border; });
  grid.people.forEach((p, pi) => {
    const row = sh.addRow([p.name, ...days.map((_, i) => normCode(p.cells[i]))]);
    days.forEach((d, i) => {
      const c = row.getCell(i + 2);
      c.alignment = { horizontal: 'center' };
      const flags = cellFlags.get(`${pi}|${d.day}`) ?? [];
      const lv = worstOf(flags);
      if (lv) { c.fill = fill(LEVEL_FILL[lv]); c.note = flags.map((f) => `${LEVEL_TEXT[f.level]}：${f.text}`).join('\n'); }
    });
    row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
  });
  sh.addRow([]);
  // 時間帯ごとの、いちばん少ない時の人数（足りなければ赤）
  for (const b of BANDS) {
    const to = b.to > 24 ? `翌${b.to - 24}` : b.to;
    const row = sh.addRow([`${b.label}（${b.from}〜${to}時）の人数`, ...days.map((d) => bandCount.get(`${d.day}|${b.key}`)?.min ?? null)]);
    days.forEach((d, i) => {
      const bc = bandCount.get(`${d.day}|${b.key}`);
      const c = row.getCell(i + 2);
      c.alignment = { horizontal: 'center' };
      if (bc && bc.min < bc.need) { c.fill = fill(COLORS.red); c.note = `必要${bc.need}人（いちばん少ない時に${bc.min}人）`; }
    });
    row.font = { color: { argb: 'FF444444' } };
  }
  sh.addRow([]);
  sh.addRow(['※ 人数の行は、その時間帯で一番少ない時の人数です（1時間ごとに、その1時間ずっといる人を数えます）。赤は必要な人数より少ない日です。']);
  sh.addRow(['※ 赤＝要確認（人が足りない・希望休の日に勤務・表にない記号）／黄＝注意（連勤・夜勤明け・勤務の間・空の欄など）。']);

  // ---- 使った設定 ----
  const st = wb.addWorksheet('使った設定');
  st.columns = [{ width: 22 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 34 }];
  const h1 = (t) => { const r = st.addRow([t]); r.font = { bold: true }; };
  h1('記号の表');
  styleHeader(st.addRow(['記号', '名前', '始まり', '終わり', '種類']));
  for (const s of settings.symbols) st.addRow([normCode(s.code), s.name, s.kind === 'work' ? s.start : '', s.kind === 'work' ? s.end : '', KIND_LABEL[s.kind] ?? s.kind]);
  st.addRow([]);
  h1('必要な人数');
  styleHeader(st.addRow(['', ...BANDS.map((b) => `${b.label}（${b.from}〜${b.to > 24 ? `翌${b.to - 24}` : b.to}時）`)]));
  st.addRow(['平日', ...BANDS.map((b) => settings.needs.weekday[b.key])]);
  st.addRow(['土日祝', ...BANDS.map((b) => settings.needs.holiday[b.key])]);
  st.addRow([]);
  h1('決まり');
  st.addRow(['連勤の上限', `${rules.maxStreak}日`]);
  st.addRow(['月の休日数の下限', `${rules.minHolidays}日`]);
  st.addRow(['勤務と勤務の間（参考）', `${rules.minRestHours}時間`]);
  st.addRow(['祝日（この月）', days.filter((d) => d.isHoliday).map((d) => `${d.day}日`).join('・') || 'なし']);
  st.addRow([]);
  h1('希望休');
  if (settings.hopes?.length) for (const x of settings.hopes) st.addRow([x.name, `${x.day}日`]);
  else st.addRow(['（なし）']);
  st.addRow([]);
  st.addRow([SHIFT_NOTE]);
  return wb;
}
