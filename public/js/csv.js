// CSVの読み込み。Excel由来のShift_JISにも対応する。何もサーバーへ送らない（ブラウザ内で完結）。

/** ArrayBuffer → 文字列。UTF-8として正しければUTF-8、だめならShift_JIS */
export function decodeCsvBytes(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

/** RFC4180風の簡易パーサ（引用符・改行入りセル・CRLF対応）。区切りはカンマ／タブを自動判定 */
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const HINTS = {
  name: ['氏名', '名前', '従業員', '社員', '職員', 'name'],
  date: ['日付', '年月日', '勤務日', '日', 'date'],
  start: ['出勤', '始業', '開始', '出社', 'in', 'start'],
  end: ['退勤', '終業', '終了', '退社', 'out', 'end'],
  breakMin: ['休憩', 'break'],
};

/** 見出し行から、列の対応を推測する。見つからない項目は -1 */
export function guessColumns(header) {
  const h = header.map((v) => String(v).normalize('NFKC').trim().toLowerCase());
  const out = {};
  for (const [key, words] of Object.entries(HINTS)) {
    let idx = -1;
    for (const w of words) {
      idx = h.findIndex((v) => v === w);
      if (idx >= 0) break;
    }
    if (idx < 0) idx = h.findIndex((v) => words.some((w) => v.includes(w)));
    out[key] = idx;
  }
  return out;
}

/** 列の対応に従って、計算用のレコードにする（rowは元ファイルの行番号） */
export function toRecords(rows, mapping, hasHeader = true) {
  const start = hasHeader ? 1 : 0;
  const get = (r, i) => (i >= 0 ? r[i] ?? '' : '');
  return rows.slice(start).map((r, k) => ({
    row: k + start + 1,
    name: get(r, mapping.name),
    date: get(r, mapping.date),
    start: get(r, mapping.start),
    end: get(r, mapping.end),
    breakMin: get(r, mapping.breakMin),
  }));
}
