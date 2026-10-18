// 会計ソフトに取り込むファイル（弥生会計の形式・freee の形式）。レシート1枚＝支出1件、10%と8%（軽減）は行を分ける。
// - 出すのは、勘定科目を人が「確定」し、要確認（赤）の無い行だけ（設計 #6）。出さなかった行は一覧で返す
// - 税区分の文字列は、このファイルの表1か所に持つ。試用版で取り込めたと確かめるまで verified は false（画面に「取り込み未確認」）
// - 登録番号（T＋13桁）が無いレシートは、取引日でインボイスの経過措置の割合（80%・50%）を決める（プログラムが決める）
import { worstLevel, INVOICE_RE, isValidDate } from './receipt-check.js';

/** 登録番号の無い相手からの仕入れの控除の割合（経過措置）。期間の外（2029年10月以降）は 0 */
export const TRANSITION = [
  { from: '2023-10-01', to: '2026-09-30', rate: 80 },
  { from: '2026-10-01', to: '2029-09-30', rate: 50 },
];
const INVOICE_START = '2023-10-01';

/**
 * 仕入税額控除の割合。登録番号あり＝100。無し＝取引日の経過措置の割合（2023年9月までは区分記載請求書で 100）
 * @returns {100|80|50|0}
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
 * @returns {{ok:{r, no:number, registered:boolean, rate:number}[], skipped:{no:number, payee:string, reason:string}[]}}
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
    if (rate === 0) { skipped.push({ no, payee: r.payee, reason: '経過措置の期間の外です（登録番号なし・2029年10月以降）。税理士に確かめてください' }); return; }
    ok.push({ r, no, registered, rate });
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
