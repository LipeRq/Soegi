// 会計ソフトに取り込むファイル（弥生会計の形式・freee の形式）。レシート1枚＝支出1件、10%と8%（軽減）は行を分ける。
// - 出すのは、勘定科目を人が「確定」し、要確認（赤）の無い行だけ（設計 #6）。出さなかった行は一覧で返す
// - 税区分の文字列は、このファイルの表1か所に持つ。試用版で取り込めたと確かめるまで verified は false（画面に「取り込み未確認」）
// - 登録番号（T＋13桁）が無いレシートは、取引日でインボイスの経過措置の割合（80%・70%・50%・30%）を決める（プログラムが決める）
// 調べた日：2026-10-18（弥生・freee・マネーフォワードの公式ヘルプの検索結果。本文はこの環境から開けなかった）。設計 v0.4 4章
import { worstLevel, INVOICE_RE, isValidDate } from './receipt-check.js';
import { encodeSjis } from './sjis.js';

/**
 * 登録番号の無い相手からの仕入れの控除の割合（経過措置）。令和8年度の税制改正のあと（2026-10-18 に調べた値）。
 * 期間の外（2031年10月以降）は 0。制度の最新は国税庁で確かめる
 */
export const TRANSITION = [
  { from: '2023-10-01', to: '2026-09-30', rate: 80 },
  { from: '2026-10-01', to: '2028-09-30', rate: 70 },
  { from: '2028-10-01', to: '2030-09-30', rate: 50 },
  { from: '2030-10-01', to: '2031-09-30', rate: 30 },
];
const INVOICE_START = '2023-10-01';

/**
 * 仕入税額控除の割合。登録番号あり＝100。無し＝取引日の経過措置の割合（2023年9月までは区分記載請求書で 100）
 * @returns {100|80|70|50|30|0}
 */
export function deductionRate(dateIso, registered) {
  if (registered || dateIso < INVOICE_START) return 100;
  return TRANSITION.find((t) => dateIso >= t.from && dateIso <= t.to)?.rate ?? 0;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 税率ごとの行に分ける。内訳（10%対象・8%対象）が合計と合えばその金額、無ければ合計を1行（8%だけ書いてあれば8%）。
 * 内訳が合わないレシートは赤なので、ここには来ない
 * @returns {{rate:10|8, amount:number}[]}
 */
export function taxParts(r) {
  const has10 = isNum(r.amount10) && r.amount10 > 0; const has8 = isNum(r.amount8) && r.amount8 > 0;
  if ((has10 || has8) && (r.amount10 || 0) + (r.amount8 || 0) === r.total) {
    return [has10 && { rate: 10, amount: r.amount10 }, has8 && { rate: 8, amount: r.amount8 }].filter(Boolean);
  }
  return [{ rate: has8 && !has10 ? 8 : 10, amount: r.total }];
}

/**
 * 出す行と、出さない行（理由つき）に分ける。
 * @param rows receipt.js の行  @param checks checkReceipts の結果（同じ並び）
 * @returns {{ok:{r, no:number, registered:boolean, rate:number, duplicate:boolean}[], skipped:{no:number, payee:string, reason:string}[]}}
 */
export function selectRows(rows, checks) {
  const ok = []; const skipped = [];
  rows.forEach((r, i) => {
    const no = i + 1;
    const why = r.error ? '読み取れませんでした'
      : worstLevel(checks[i].flags) === 'red' ? '要確認（赤）があります'
        : !r.account ? '勘定科目が選ばれていません'
          : !r.confirmed ? '勘定科目が未確定です（「確定」に印を付けてください）'
            : !isValidDate(r.date) || !isNum(r.total) ? '日付か合計が空です' : '';
    if (why) { skipped.push({ no, payee: r.payee || '（支払先なし）', reason: why }); return; }
    const registered = INVOICE_RE.test(String(r.invoiceNo ?? '').trim());
    const rate = deductionRate(r.date, registered);
    if (rate === 0) { skipped.push({ no, payee: r.payee, reason: '経過措置の期間の外です（登録番号なし・2031年10月以降）。税理士に確かめてください' }); return; }
    ok.push({ r, no, registered, rate, duplicate: Boolean(checks[i].duplicate) });
  });
  return { ok, skipped };
}

/** CSV の1つの値。" , 改行を含むときだけ "" で囲む。先頭が = + - @ の文字は ' を付けて式にしない（数の列は呼ぶ側で文字にしない） */
export function csvValue(v, { text = true } = {}) {
  if (v == null) return '';
  let s = String(v);
  if (text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---- 税区分の文字（ここ1か所）---------------------------------------------------------------
// 1文字違うと、取り込みで対応づけの画面が出るか、違う税区分になる。かっこ・％の全角半角もこのまま（NFKC をかけない）
// キーは「税率_控除の割合」。100＝登録番号あり（適格）

/** 弥生インポート形式の借方税区分。込＝税込経理、内＝税抜経理（内税）。末尾は 適格 か 区分＋割合 */
export const YAYOI_TAX = {
  込: {
    '10_100': '課対仕入込10%適格', '8_100': '課対仕入込軽減8%適格',
    '10_80': '課対仕入込10%区分80%', '8_80': '課対仕入込軽減8%区分80%',
    '10_70': '課対仕入込10%区分70%', '8_70': '課対仕入込軽減8%区分70%',
    '10_50': '課対仕入込10%区分50%', '8_50': '課対仕入込軽減8%区分50%',
    '10_30': '課対仕入込10%区分30%', '8_30': '課対仕入込軽減8%区分30%',
  },
  内: {
    '10_100': '課対仕入内10%適格', '8_100': '課対仕入内軽減8%適格',
    '10_80': '課対仕入内10%区分80%', '8_80': '課対仕入内軽減8%区分80%',
    '10_70': '課対仕入内10%区分70%', '8_70': '課対仕入内軽減8%区分70%',
    '10_50': '課対仕入内10%区分50%', '8_50': '課対仕入内軽減8%区分50%',
    '10_30': '課対仕入内10%区分30%', '8_30': '課対仕入内軽減8%区分30%',
  },
};
export const YAYOI_CREDIT_TAX = '対象外'; // 現金など、貸方の資産の科目

/** freee 取引のインポートの税区分。（控NN）のかっこは全角、% は半角 */
export const FREEE_TAX = {
  '10_100': '課対仕入10%', '8_100': '課対仕入8%（軽）',
  '10_80': '課対仕入（控80）10%', '8_80': '課対仕入（控80）8%（軽）',
  '10_70': '課対仕入（控70）10%', '8_70': '課対仕入（控70）8%（軽）',
  '10_50': '課対仕入（控50）10%', '8_50': '課対仕入（控50）8%（軽）',
  '10_30': '課対仕入（控30）10%', '8_30': '課対仕入（控30）8%（軽）',
};

/** 取り込みで確かめたか（オーナーが試用版で取り込めたら true にする） */
export const VERIFIED = { yayoi: false, freee: false };

/** freee 取引のインポートの見出し（21列。公式のサンプルと同じ文字・順番） */
export const FREEE_HEADER = [
  '収支区分', '管理番号', '発生日', '決済期日', '取引先コード', '取引先', '勘定科目', '税区分', '金額', '税計算区分', '税額', '備考',
  '品目', '部門', 'メモタグ（複数指定可、カンマ区切り）', 'セグメント1', 'セグメント2', 'セグメント3', '決済日', '決済口座', '決済金額',
];

// ---- 文字と数の書き方 ------------------------------------------------------------------------

/** 会計ソフトに入れる科目名（画面の候補と違うものだけ）。違う名前だと、取り込みで対応づけの画面が出る */
const ACCOUNT_NAME = { '車両費（燃料）': '車両費' };
export const accountName = (a) => ACCOUNT_NAME[a] ?? String(a ?? '').trim();

/**
 * 取り込みファイルに入れる文字。改行・タブは空白、半角カンマは「、」、引用符は消す（引用符で囲まなくて済むように）。
 * 先頭の = + @ は消し、- は全角にする（表計算ソフトで開いたときに式にならないように。' を付けると、その ' が名前に残るため）
 */
export function importText(v, max = 0) {
  let s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/,/g, '、').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[=+@]+/, '').replace(/^-/, '－').trim();
  return max ? [...s].slice(0, max).join('') : s;
}
const slashDate = (iso) => iso.replace(/-/g, '/');

/** 税抜経理（内税）の税額：その税率の税込金額から計算（切り捨て）。1行だけのレシートでレシートに税額があればそれを使う */
function taxAmount(part, parts, r) {
  if (parts.length === 1 && isNum(r.tax) && r.tax >= 0) return r.tax;
  return Math.floor((part.amount * part.rate) / (100 + part.rate));
}

/**
 * 人に確かめてほしい行（出すけれど、税区分を変えることがある）。プログラムは会社の条件を知らないので、決めずに知らせる
 * @returns {{no:number, payee:string, note:string}[]}
 */
export function caveats(ok) {
  const out = [];
  for (const { r, no, registered, duplicate } of ok) {
    // 重複の疑い（黄）は出すが、2回取り込むと経費が2倍になるので知らせる
    if (duplicate) out.push({ no, payee: r.payee, note: '同じ日・支払先・金額のレシートが2枚以上あります。同じレシートなら、片方の「確定」を外してください' });
    if (registered) continue;
    if (r.account === '旅費交通費') out.push({ no, payee: r.payee, note: '登録番号がありません。電車・バスの運賃（3万円未満）なら、全額を控除できます（適格の税区分）' });
    else if (r.total < 10000 && r.date <= '2029-09-30') out.push({ no, payee: r.payee, note: '登録番号がありません。1万円未満は、少額特例を使える事業者なら全額を控除できます（適格の税区分）' });
  }
  return out;
}

// ---- 弥生インポート形式（マネーフォワード クラウド会計の「弥生会計」からの取り込みでも使う）----------------
// 25項目・見出しの行なし・Shift_JIS・改行は CRLF。1行＝1仕訳（識別フラグ 2000）。10%と8%が混ざるレシートは2行

/**
 * @param ok selectRows の ok  @param opts {method:'込'|'内', credit:'現金' など}
 * @returns {string[][]} 25項目の行
 */
export function yayoiRows(ok, { method = '込', credit = '現金' } = {}) {
  const table = YAYOI_TAX[method];
  if (!table) throw new Error(`経理方式が違います：${method}`);
  const rows = [];
  for (const { r, rate } of ok) {
    const parts = taxParts(r);
    const memo = importText([r.payee, r.summary].filter(Boolean).join(' '), 30); // 弥生会計 オンラインの摘要は30文字まで
    for (const part of parts) {
      const tax = table[`${part.rate}_${rate}`];
      rows.push([
        '2000', '', '', slashDate(r.date), importText(accountName(r.account)), '', '', tax, String(part.amount),
        method === '内' ? String(taxAmount(part, parts, r)) : '',
        importText(credit), '', '', YAYOI_CREDIT_TAX, String(part.amount), '', memo,
        '', '', '0', '', '', '0', '0', 'no',
      ]);
    }
  }
  return rows;
}

/** @returns {{bytes:Uint8Array, unmappable:string[]}} Shift_JIS（CP932）、BOM なし */
export function yayoiFile(rows) {
  const text = rows.map((cols) => cols.join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
  const { bytes, unmappable } = encodeSjis(text);
  return { bytes, unmappable: [...new Set(unmappable)] };
}

// ---- freee 取引のインポート ----------------------------------------------------------------
// 見出しの行あり（21列）・UTF-8（BOM 付き）・改行は CRLF。10%と8%が混ざるレシートは、2件の支出にする
// （複数行の取引にすると、決済の欄をどの行に書くかが確かめられていないため）

/** 貸方の選択 → freee の決済口座。空なら未決済の取引（未払金）になる */
const FREEE_SETTLE = { 現金: '現金', 事業主借: '事業主借', 未払金: '', 普通預金: '' };

/** @param opts {credit} @returns {string[][]} 見出しを含む行 */
export function freeeRows(ok, { credit = '現金' } = {}) {
  const account = FREEE_SETTLE[credit] ?? '';
  const rows = [FREEE_HEADER];
  for (const { r, no, rate, registered } of ok) {
    for (const part of taxParts(r)) {
      const memo = importText([`No.${no}`, r.summary, registered ? r.invoiceNo : ''].filter(Boolean).join(' '));
      rows.push([
        '支出', '', slashDate(r.date), '', '', importText(r.payee), importText(accountName(r.account)), FREEE_TAX[`${part.rate}_${rate}`],
        String(part.amount), '内税', '', memo, '', '', '', '', '', '',
        account ? slashDate(r.date) : '', account, account ? String(part.amount) : '',
      ]);
    }
  }
  return rows;
}

/** @returns {Blob} UTF-8（BOM 付き） */
export function freeeFile(rows) {
  const text = rows.map((cols) => cols.map((v) => csvValue(v, { text: false })).join(',')).join('\r\n') + '\r\n';
  return new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
}
