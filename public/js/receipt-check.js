// レシートのチェック（プログラム）。AIの読み取りが合っているかを機械的に確かめ、人が見る箇所を示す。
//  赤：10%＋8%＝合計 でない／登録番号が T＋13桁でない／必須項目（日付・支払先・合計）が空
//  黄：日付が未来か1年以上前／確かさが「低」の項目／重複の疑い（同じ日・支払先・金額）

export const INVOICE_RE = /^T\d{13}$/;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function isValidDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param rows [{date, payee, total, amount10, amount8, invoiceNo, conf:{date,payee,total,tax,invoice_no,account}}]
 * @returns [{flags:[{field, level, message}], duplicate:boolean}]  field は date|payee|total|amount10|amount8|invoiceNo|account|row
 */
export function checkReceipts(rows, today = new Date()) {
  const todayStr = ymd(today);
  const oneYearAgo = ymd(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));

  const result = rows.map((r) => {
    const flags = [];
    const add = (field, level, message) => flags.push({ field, level, message });

    if (!isValidDate(r.date)) add('date', 'red', '日付が空か、読めません');
    else if (r.date > todayStr) add('date', 'yellow', '日付が未来です');
    else if (r.date < oneYearAgo) add('date', 'yellow', '日付が1年以上前です');

    if (!String(r.payee ?? '').trim()) add('payee', 'red', '支払先が空です');
    if (!isNum(r.total)) add('total', 'red', '合計が空です');

    const has10 = isNum(r.amount10); const has8 = isNum(r.amount8);
    if ((has10 || has8) && isNum(r.total) && (r.amount10 || 0) + (r.amount8 || 0) !== r.total) {
      add('total', 'red', `10%対象＋8%対象（${(r.amount10 || 0) + (r.amount8 || 0)}円）が合計と一致しません`);
      if (has10) add('amount10', 'red', '合計と一致しません');
      if (has8) add('amount8', 'red', '合計と一致しません');
    }

    const inv = String(r.invoiceNo ?? '').trim();
    if (inv && !INVOICE_RE.test(inv)) add('invoiceNo', 'red', '登録番号が「T＋13桁の数字」ではありません');

    const lowLabels = { date: '日付', payee: '支払先', total: '合計', tax: '税額', invoice_no: '登録番号', account: '勘定科目' };
    const lowField = { date: 'date', payee: 'payee', total: 'total', tax: 'amount10', invoice_no: 'invoiceNo', account: 'account' };
    for (const [k, label] of Object.entries(lowLabels)) {
      if (r.conf?.[k] === '低' && !flags.some((f) => f.field === lowField[k])) {
        add(lowField[k], 'yellow', `${label}の読み取りに自信がありません`);
      }
    }
    return { flags, duplicate: false };
  });

  // 重複の疑い
  const groups = new Map();
  rows.forEach((r, i) => {
    if (!isValidDate(r.date) || !String(r.payee ?? '').trim() || !isNum(r.total)) return;
    const key = `${r.date}|${r.payee.trim()}|${r.total}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    for (const i of idx) {
      result[i].duplicate = true;
      result[i].flags.push({ field: 'row', level: 'yellow', message: '重複の疑い（同じ日・支払先・金額）' });
    }
  }
  return result;
}

/** 行の色：赤が1つでもあれば red、黄だけなら yellow、無ければ null */
export function worstLevel(flags) {
  if (flags.some((f) => f.level === 'red')) return 'red';
  if (flags.some((f) => f.level === 'yellow')) return 'yellow';
  return null;
}

/** セルごとの色 */
export function levelOf(flags, field) {
  return worstLevel(flags.filter((f) => f.field === field));
}
