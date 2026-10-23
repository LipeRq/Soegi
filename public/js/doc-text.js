// 「御社の資料で試す」：ファイルを、画面の中で文字にする（サーバーには文字だけを送る。ファイルそのものは送らない）。
//   PDF … pdf.js（文字の層だけ。スキャンした画像だけの PDF は読めない）／Word（.docx）… JSZip で本文の XML／
//   Excel（.xlsx）… ExcelJS（「シート名・行番号・値」の形）／テキスト（.txt .csv .md）… そのまま（UTF-8 か Shift_JIS）
import { decodeCsvBytes } from './csv.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = '.pdf,.docx,.xlsx,.txt,.csv,.md,application/pdf,text/plain,text/csv,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_DIR = '/vendor/pdfjs/';
const MAX_PDF_PAGES = 200;

/** サーバーと同じ決まりで整える（NUL を除く・改行をそろえる・空行を詰める）。位置の数え方を画面とサーバーで一致させる */
export const cleanText = (t) => String(t ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
  const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
});

/** Word の本文の XML（word/document.xml）→ 段落ごとの文字。表のセルは行ごとにタブで区切る */
export function docxXmlToText(xml) {
  const out = [];
  const body = String(xml ?? '');
  // 表の行（w:tr）は、セル（w:tc）の段落をタブでつなぐ。それ以外の段落は1行
  const para = (p) => {
    let t = '';
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g)) {
      if (m[1] != null) t += unescapeXml(m[1]); else t += m[0].startsWith('<w:tab') ? '\t' : '\n';
    }
    return t;
  };
  let rest = body;
  const tableRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
  let last = 0;
  const flushParas = (chunk) => { for (const m of chunk.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) out.push(para(m[0])); };
  for (const tm of rest.matchAll(tableRe)) {
    flushParas(rest.slice(last, tm.index));
    for (const row of tm[0].matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)) {
      const cells = [...row[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((p) => para(p[0])).join(' ').trim());
      out.push(cells.join('\t'));
    }
    last = tm.index + tm[0].length;
  }
  flushParas(rest.slice(last));
  return cleanText(out.join('\n'));
}

/** Excel の1シート → 「[シート名 3行目] A | B | C」の行。空の行は出さない */
export function sheetToText(name, rows) {
  const lines = [];
  rows.forEach((cells, i) => {
    const vals = cells.map((v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim()));
    while (vals.length && !vals.at(-1)) vals.pop();
    if (vals.some(Boolean)) lines.push(`[${name} ${i + 1}行目] ${vals.join(' | ')}`);
  });
  return lines.join('\n');
}

/**
 * PDF の行（折り返された行）をつなぐ。日本語の段落が行の幅で切れていると、文の途中に改行が入り、引用が途切れるため。
 * 前の行が「ほぼ最大の長さ」で、文の終わり（。など）でなく、前後が日本語の文字のときだけつなぐ（見出しなど短い行はつながない）
 */
export function joinWrappedLines(lines) {
  const max = Math.max(0, ...lines.map((l) => l.length));
  const cjk = /[\u3040-\u30ff\u4e00-\u9fff、，]/;
  const out = [];
  for (const line of lines) {
    const prev = out.at(-1);
    if (prev != null && prev.length >= max * 0.8 && max >= 20 && !/[。．.!?！？：:]$/.test(prev) && cjk.test(prev.at(-1)) && /^[\u3040-\u30ff\u4e00-\u9fff]/.test(line)) out[out.length - 1] = prev + line;
    else out.push(line);
  }
  return out;
}

const ext = (f) => (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(`${PDF_DIR}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_DIR}pdf.worker.min.mjs`;
  }
  return pdfjs;
}

async function pdfText(buf) {
  const lib = await loadPdfjs();
  // 端末の書体や外部のデータを読みに行かない（CSP のため）
  const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, cMapUrl: `${PDF_DIR}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDF_DIR}standard_fonts/` }).promise;
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES);
  const out = [];
  for (let n = 1; n <= pages; n += 1) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const lines = []; let line = '';
    for (const it of tc.items) {
      line += it.str;
      if (it.hasEOL) { lines.push(line); line = ''; }
    }
    if (line) lines.push(line);
    out.push(joinWrappedLines(lines).join('\n'));
  }
  const text = cleanText(out.join('\n\n'));
  if (text.replace(/\s/g, '').length < 20 * Math.max(1, Math.min(pages, 3))) {
    throw new Error('文字を取り出せませんでした。スキャンした画像だけの PDF は読めません（文字が入った PDF か、Word・テキストでお試しください）');
  }
  return { text, note: doc.numPages > pages ? `先頭の${pages}ページだけ読みました` : '' };
}

async function docxText(buf) {
  if (!window.JSZip) throw new Error('Wordを読む部品を読み込めませんでした。再読み込みしてお試しください');
  const zip = await window.JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Word（.docx）として読めませんでした');
  return { text: docxXmlToText(await f.async('string')), note: '' };
}

async function xlsxText(buf) {
  if (!window.ExcelJS) throw new Error('Excelを読む部品を読み込めませんでした。再読み込みしてお試しください');
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const parts = [];
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const arr = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        const v = c.value;
        arr[col - 1] = v == null ? '' : v instanceof Date ? v : typeof v === 'object' ? ('result' in v ? v.result : Array.isArray(v.richText) ? v.richText.map((r) => r.text).join('') : v.text ?? '') : v;
      });
      rows[n - 1] = arr;
    });
    const t = sheetToText(ws.name, Array.from(rows, (r) => r ?? []));
    if (t) parts.push(t);
  }
  return { text: parts.join('\n'), note: '' };
}

/**
 * @returns {Promise<{text:string, note:string}>} 取り出せなければ、日本語のメッセージで throw する
 */
export async function extractText(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('10MBを超えています');
  const e = ext(file);
  const buf = await file.arrayBuffer();
  let r;
  try {
    if (e === 'pdf') r = await pdfText(buf);
    else if (e === 'docx') r = await docxText(buf);
    else if (e === 'xlsx') r = await xlsxText(buf);
    else if (['txt', 'csv', 'md'].includes(e)) r = { text: decodeCsvBytes(buf), note: '' };
    else if (e === 'doc' || e === 'xls') throw new Error(`古い形式（.${e}）は読めません。${e === 'doc' ? 'Word の「.docx」' : 'Excel の「.xlsx」'}で保存し直してください`);
    else throw new Error('読めるのは PDF・Word（.docx）・Excel（.xlsx）・テキスト（.txt .csv .md）です');
  } catch (err) {
    if (/[ぁ-んァ-ン一-龥]/.test(err?.message ?? '')) throw err;
    throw new Error('読み込めないファイルです（壊れているか、パスワードがかかっている可能性があります）');
  }
  const text = cleanText(r.text);
  if (!text) throw new Error('文字がありませんでした');
  return { text, note: r.note };
}
