// ナレッジの「御社の資料で試す」の見本の資料（架空の工務店「やまがた住建（仮）」）を作る。3つとも架空。
//   node scripts/gen-own-samples.mjs → public/samples/own/（Word・PDF・Excel）と samples.json
// - 保証とアフターサービス.docx：保証の年数・定期点検・不具合の連絡
// - 現場のルール.pdf：朝礼・保護具・高所作業・けがのとき（Playwright の Chromium で作る。作るときだけ使う）
// - 工事の単価表.xlsx：項目・単位・単価
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/node-tools/node_modules/')('playwright')); }

const OUT = new URL('../public/samples/own/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---- Word ----
const WARRANTY = {
  title: 'やまがた住建（仮）　保証とアフターサービス',
  paras: [
    '■ 引き渡し後の保証',
    '構造部分（基礎・柱・梁）の保証は、引き渡しから10年です。',
    '屋根と外壁の防水の保証は、引き渡しから10年です。',
    '内装と建具の保証は、引き渡しから2年です。',
    '設備機器（給湯器・キッチン・トイレなど）は、メーカーの保証（1年）に従います。',
    '■ 定期点検',
    '引き渡しから6か月・1年・2年・5年・10年の時に、無料で点検に伺います。',
    '点検の日は、点検の1か月前までに、こちらからお電話で相談します。',
    '■ 不具合のご連絡',
    '平日の9時から17時は、会社の電話（0000-00-0000）でお受けします。',
    '夜間・休日は、水漏れと停電の緊急のご連絡だけ、専用の電話（090-0000-0000）でお受けします。',
    '■ 費用',
    '保証の期間内の不具合は、無料で直します。お客さまの使い方が原因の場合は、有料になります。',
  ],
};
const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${[WARRANTY.title, ...WARRANTY.paras].map((t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml', docXml);
writeFileSync(new URL('warranty.docx', OUT), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

// ---- Excel ----
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('単価表');
ws.addRow(['やまがた住建（仮）　工事の単価表（税抜）']);
ws.addRow(['項目', '単位', '単価（円）', '備考']);
const PRICES = [
  ['外壁塗装（シリコン）', 'm2', 3200, '足場代は別'],
  ['屋根塗装', 'm2', 2800, '足場代は別'],
  ['クロス張替え', 'm2', 1100, '家具の移動は別'],
  ['フローリング張替え', 'm2', 8500, '下地の補修は別'],
  ['洗面台の交換', '台', 98000, '本体を含む（標準品）'],
  ['トイレの交換', '台', 135000, '本体を含む（標準品）'],
  ['足場の設置', 'm2', 800, '3階建てまで'],
];
for (const r of PRICES) ws.addRow(r);
ws.getColumn(1).width = 26; ws.getColumn(4).width = 26;
await wb.xlsx.writeFile(fileURLToPath(new URL('prices.xlsx', OUT)));

// ---- PDF ----
const RULES = [
  ['朝礼', '毎朝8時に、事務所の前で朝礼をします。その日の作業と、危険な所を全員で確かめます。'],
  ['保護具', '現場に入るときは、ヘルメットと安全靴を必ず着けます。粉じんの出る作業では、マスクも着けます。'],
  ['高所作業', '2メートル以上の高さで作業するときは、安全帯（フルハーネス）を着け、必ず2人以上で作業します。'],
  ['近隣へのあいさつ', '工事の始まる前の日に、両隣と向かいの家へ、工事の日程を書いた紙を持ってごあいさつに伺います。'],
  ['けがをしたとき', '手や足を切った・落ちた・体調が悪くなったときは、すぐに作業をやめて、現場監督に電話します。軽いけがでも、必ず報告します。'],
];
const html = `<!doctype html><meta charset="utf-8"><style>
body{font-family:"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif;font-size:13pt;line-height:1.9;margin:0}
h1{font-size:18pt;border-bottom:2px solid #333;padding-bottom:6px} h2{font-size:14pt;margin:18px 0 2px}
</style><body><h1>やまがた住建（仮）　現場のルール</h1>${RULES.map(([h, t]) => `<h2>■ ${esc(h)}</h2><p>${esc(t)}</p>`).join('')}</body>`;
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(html);
await p.pdf({ path: fileURLToPath(new URL('rules.pdf', OUT)), format: 'A4', margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' } });
await b.close();

writeFileSync(new URL('samples.json', OUT), `${JSON.stringify({
  company: 'やまがた住建（仮）',
  note: '架空の工務店の資料です。',
  files: [
    { file: 'warranty.docx', name: '保証とアフターサービス.docx', label: '保証とアフターサービス（Word）' },
    { file: 'rules.pdf', name: '現場のルール.pdf', label: '現場のルール（PDF）' },
    { file: 'prices.xlsx', name: '工事の単価表.xlsx', label: '工事の単価表（Excel）' },
  ],
  questions: [
    { q: '構造部分の保証は何年ですか？', doc: '保証とアフターサービス.docx' },
    { q: 'クロス張替えの単価はいくらですか？', doc: '工事の単価表.xlsx' },
    { q: '高い所で作業するときは何を着けますか？', doc: '現場のルール.pdf' },
    { q: '来月の社員旅行はどこですか？', doc: null },
  ],
}, null, 2)}\n`);
console.log('wrote public/samples/own/');
