// Excel出力の共通部品。ExcelJS はページ側で読み込んだものを渡す（テストでは node の exceljs を渡す）。

export const COLORS = {
  ink: 'FF1A1A1A', shu: 'FFB7352A', shuLight: 'FFFBF1EF', gray: 'FFF4F4F4',
  yellow: 'FFFFF2B3', orange: 'FFFFD9B3', red: 'FFF6C9C4',
};

export const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = fill(COLORS.ink);
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 22;
}

export function safeSheetName(name, used) {
  let base = String(name).replace(/[\\/*?:[\]]/g, '_').trim().slice(0, 31) || 'sheet';
  let n = base; let i = 2;
  while (used.has(n.toLowerCase())) {
    const suffix = `_${i++}`;
    n = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n.toLowerCase());
  return n;
}

export const DISCLAIMER = 'デモ用の架空データです。入力内容は保存しません。読み取り・下書きには外部のAIサービスを使います。';

/** YYYY-MM-DD → Excelの日付（UTCの0時。表示のずれを避けるため） */
export function toExcelDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
