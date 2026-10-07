// 残業の集計 → Excel。一覧／1人1シートの日別表／使った設定。
import { fmtClock, STATUS_TEXT, WEEKDAY_LABELS, LIMITS } from './overtime.js';
import { COLORS, fill, styleHeader, safeSheetName, toExcelDate } from './xlsx-common.js';

const NOTE = '目安の表示です。法的な判断は社会保険労務士にご相談ください。';
const DEMO = 'デモ用の架空データです。入力内容は保存しません。';
const STATUS_FILL = { yellow: COLORS.yellow, orange: COLORS.orange, red: COLORS.red };
const DURATION = '[h]:mm';
const dur = (min) => min / 1440; // Excelの時間は「日」単位

export function buildAttendanceWorkbook(ExcelJS, period, settings) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ソエギ デモ';
  const used = new Set();

  // 一覧
  const ws = wb.addWorksheet(safeSheetName('一覧', used), { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.addRow([`${period.label}　時間外労働の集計`]);
  ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow(['氏名', '出勤日数', '実労働', '時間外', '深夜', '休日労働', '時間外＋休日労働', '週40時間超（参考）', '連続勤務（最長・日）', '判定']);
  styleHeader(ws.getRow(2));
  [16, 10, 11, 11, 11, 11, 16, 16, 16, 38].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  period.people.forEach((p) => {
    const row = ws.addRow([
      p.name, p.workDays, dur(p.workMin), dur(p.overMin), dur(p.nightMin), dur(p.holidayMin),
      dur(p.overPlusHolidayMin), dur(p.weeklyOverMin), p.streakFlag ? `${p.maxStreak}日（6日以上）` : `${p.maxStreak}日`,
      STATUS_TEXT[p.status],
    ]);
    for (let c = 3; c <= 8; c++) row.getCell(c).numFmt = DURATION;
    if (STATUS_FILL[p.status]) { row.getCell(10).fill = fill(STATUS_FILL[p.status]); row.getCell(1).fill = fill(STATUS_FILL[p.status]); }
    if (p.streakFlag) row.getCell(9).fill = fill(COLORS.shuLight);
  });
  ws.addRow([]);
  ws.addRow([NOTE]);
  ws.addRow(['※ 週40時間超は参考表示です（判定には使っていません）。']);
  ws.addRow([DEMO]);

  // 1人1シート
  for (const p of period.people) {
    const sh = wb.addWorksheet(safeSheetName(p.name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
    sh.columns = [
      { header: '日付', width: 12 }, { header: '曜日', width: 6 }, { header: '出勤', width: 9 }, { header: '退勤', width: 9 },
      { header: '休憩（分）', width: 10 }, { header: '実労働', width: 10 }, { header: '時間外', width: 10 },
      { header: '深夜', width: 10 }, { header: '休日労働', width: 10 }, { header: '備考', width: 34 },
    ];
    styleHeader(sh.getRow(1));
    p.days.forEach((d) => {
      const notes = [];
      if (d.crossesMidnight) notes.push('日またぎ');
      if (d.isHoliday) notes.push('法定休日');
      if (d.breakDefaulted) notes.push('休憩は既定値');
      if (d.streak >= 6) notes.push(`${d.streak}日連続勤務の一部`);
      const row = sh.addRow([null, WEEKDAY_LABELS[d.weekday], dur(d.start), dur(d.end % 1440), d.breakMin, dur(d.workMin), dur(d.overMin), dur(d.nightMin), dur(d.holidayMin), notes.join('・')]);
      row.getCell(1).value = toExcelDate(d.date); row.getCell(1).numFmt = 'yyyy/mm/dd';
      row.getCell(3).numFmt = 'hh:mm'; row.getCell(4).numFmt = 'hh:mm';
      for (let c = 6; c <= 9; c++) row.getCell(c).numFmt = DURATION;
      if (d.isHoliday) row.getCell(2).fill = fill(COLORS.shuLight);
    });
    const first = 2; const last = p.days.length + 1;
    const total = sh.addRow(['合計', null, null, null, null, null, null, null, null, null]);
    const sums = [['F', 'workMin', 6], ['G', 'overMin', 7], ['H', 'nightMin', 8], ['I', 'holidayMin', 9]];
    for (const [col, key, idx] of sums) {
      total.getCell(idx).value = { formula: `SUM(${col}${first}:${col}${last})`, result: dur(p[key]) };
      total.getCell(idx).numFmt = DURATION;
    }
    total.font = { bold: true };
    total.eachCell({ includeEmpty: true }, (c) => { c.fill = fill(COLORS.gray); });
    sh.addRow([]);
    sh.addRow([NOTE]);
  }

  // 使った設定
  const st = wb.addWorksheet(safeSheetName('使った設定', used));
  st.columns = [{ width: 30 }, { width: 50 }];
  const closeText = settings.closeDay === 'end' ? '月末' : `${settings.closeDay}日`;
  const rows = [
    ['所定労働時間', `${settings.scheduledMin / 60}時間`],
    ['休憩の既定（書かれていない日に使う）', `${settings.defaultBreakMin}分`],
    ['法定休日', `${WEEKDAY_LABELS[settings.holidayWeekday]}曜日`],
    ['締め日', closeText],
    ['集計期間', period.label],
  ];
  rows.forEach((r) => st.addRow(r));
  st.addRow([]);
  st.addRow(['計算のルール']);
  st.lastRow.font = { bold: true };
  [
    '実労働＝退勤−出勤−休憩（退勤が出勤より早ければ日をまたいだとみなす）',
    '時間外＝1日の実労働のうち所定労働時間を超えた分（法定休日の日は休日労働に数える）',
    '深夜＝22:00〜翌5:00の労働時間（休憩は昼間にとったものとして深夜から引かない）',
    '休日労働＝法定休日の労働時間（日またぎは出勤した日で判定）',
    '週40時間超は月〜日で数えた参考表示（法定休日を除き、1日の所定分まで）',
    `判定：黄＝時間外が月${LIMITS.yellowOver / 60}時間超／橙＝時間外＋休日労働が月${LIMITS.orange / 60}時間以上／赤＝同${LIMITS.red / 60}時間以上`,
    '計算はプログラムで行っています（AIは使っていません）。同じ入力なら毎回同じ結果です。',
  ].forEach((t) => st.addRow([t]));
  st.addRow([]);
  st.addRow([NOTE]);
  st.addRow([DEMO]);
  return wb;
}
