// 日報の Excel（A4 1枚の様式）。中身は report-format.js の型（画面と同じ文）。足りない項目は赤で「（未入力）」。
import { COLORS, fill, DISCLAIMER } from './xlsx-common.js';
import { formatDate, formatHours, isSafety, missingFields, SAFETY_NOTICE, UNFILLED } from './report-format.js';

const safeText = (v) => (/^[=+\-@\t\r]/.test(String(v)) ? `'${v}` : String(v));
const thin = { style: 'thin', color: { argb: 'FFAAAAAA' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

export function buildReportWorkbook(ExcelJS, f, spoken = '') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ソエギ デモ';
  const ws = wb.addWorksheet('日報', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
  ws.getColumn(1).width = 18; ws.getColumn(2).width = 64;
  const t = ws.addRow(['日報']); ws.mergeCells('A1:B1');
  t.getCell(1).font = { bold: true, size: 18 }; t.height = 30;
  let rowNo = 2;
  if (isSafety(f, spoken)) {
    const r = ws.addRow([`※ ${SAFETY_NOTICE}`]); ws.mergeCells(`A${rowNo}:B${rowNo}`);
    r.getCell(1).font = { bold: true, color: { argb: 'FF8A1F2C' } }; r.getCell(1).fill = fill(COLORS.red); r.height = 24; rowNo += 1;
  }
  const miss = new Set(missingFields(f).map((m) => m.field));
  const work = (f.work ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  const rows = [
    ['日付', formatDate(f.date), 'date'],
    ['現場・訪問先', String(f.site ?? '').trim(), 'site'],
    ['作業内容', work.map((w) => `・${w}`).join('\n'), 'work'],
    ['人数', Number.isInteger(f.people) && f.people > 0 ? `${f.people}人` : '', 'people'],
    ['時間', formatHours(f) ?? '', 'hours'],
    ['危ない所', String(f.hazards ?? '').trim() || 'なし', null],
    ['気づき', String(f.notes ?? '').trim() || 'なし', null],
    ['明日の予定', String(f.tomorrow ?? '').trim(), 'tomorrow'],
  ];
  for (const [label, value, key] of rows) {
    const r = ws.addRow([label, value || UNFILLED]);
    r.getCell(1).font = { bold: true }; r.getCell(1).fill = fill(COLORS.gray);
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' }; r.getCell(1).alignment = { vertical: 'top' };
    if (key && miss.has(key)) r.getCell(2).fill = fill(COLORS.red);
    if (key === 'work') r.height = Math.max(20, 18 * Math.max(1, work.length));
    for (const c of [1, 2]) r.getCell(c).border = border;
    r.getCell(2).value = safeText(r.getCell(2).value);
  }
  ws.addRow([]);
  ws.addRow(['※ 日報の文はプログラムの型で作っています。AIは話した言葉から項目を取り出すだけです。送る前に、人が確かめてください。']);
  ws.addRow([DISCLAIMER]);
  return wb;
}
