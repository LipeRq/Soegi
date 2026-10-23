// 月次レポート：売上CSV → 数字（すべてプログラム。AIは計算しない）。
// 対象の月（既定は最新の「締まった月」＝今月より前）の合計／前月比／前年同月比／直近12か月（前年と並べる）／
// 上位の顧客・商品（5つ）と構成比／伸びた・落ちた所（前年同月との差の大きい順に3つずつ）／件数と平均単価。
import { parseDate } from './overtime.js';

const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

/** 金額・数量：「1,200」「¥1,200」「1200円」「△500」「▲500」「(500)」「-500」→ 数。読めなければ null */
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = norm(v).replace(/[,¥￥円個本袋箱]/g, '');
  if (!s) return null;
  let neg = false;
  if (/^[△▲]/.test(s)) { neg = true; s = s.slice(1); } else if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } else if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return neg ? -Number(s) : Number(s);
}

export const ymOf = (iso) => iso.slice(0, 7);
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export const ymLabel = (ym) => `${+ym.slice(0, 4)}年${+ym.slice(5, 7)}月`;

/**
 * CSV の行（見出しを含む）と列の対応から、レコードにする。読めない行は理由つきで外す（黙って捨てない）。
 * @param mapping {date, customer, product, qty, amount} 列の番号（無い列は -1）
 * @returns {{records:{date, ym, customer, product, qty:number|null, amount}[], errors:{row, message}[]}}
 */
export function readSales(rows, mapping, hasHeader = true) {
  const records = []; const errors = [];
  const at = (r, i) => (i >= 0 ? r[i] ?? '' : '');
  rows.slice(hasHeader ? 1 : 0).forEach((r, k) => {
    const row = k + (hasHeader ? 2 : 1);
    if (r.every((c) => !String(c ?? '').trim())) return;
    const date = parseDate(at(r, mapping.date));
    if (!date) { errors.push({ row, message: `日付を読めません（「${norm(at(r, mapping.date)).slice(0, 20)}」）` }); return; }
    const amount = toNumber(at(r, mapping.amount));
    if (amount == null) { errors.push({ row, message: `金額を読めません（「${norm(at(r, mapping.amount)).slice(0, 20)}」）` }); return; }
    const qtyRaw = at(r, mapping.qty);
    const qty = String(qtyRaw).trim() === '' ? null : toNumber(qtyRaw);
    const customer = norm(at(r, mapping.customer)) || '（顧客なし）';
    const product = norm(at(r, mapping.product)) || '（商品なし）';
    records.push({ date, ym: ymOf(date), customer, product, qty, amount });
  });
  return { records, errors };
}

/** 「締まった月」：今月より前の月で、データのある最新の月。無ければ null */
export function latestClosedMonth(records, today) {
  const cur = String(today).slice(0, 7);
  const yms = [...new Set(records.map((r) => r.ym))].filter((m) => m < cur).sort();
  return yms.at(-1) ?? null;
}

/** 対象にできる月（新しい順） */
export const monthsOf = (records) => [...new Set(records.map((r) => r.ym))].sort().reverse();

function sumBy(list, key) {
  const m = new Map();
  for (const r of list) m.set(r[key], (m.get(r[key]) ?? 0) + r.amount);
  return m;
}

const pctOf = (cur, base) => (base > 0 ? (cur - base) / base : null);

/** 1か月分の集計 */
function monthTotals(byMonth, ym) {
  const list = byMonth.get(ym);
  if (!list?.length) return null;
  const total = list.reduce((t, r) => t + r.amount, 0);
  const qtyList = list.filter((r) => r.qty != null && r.qty > 0);
  const qty = qtyList.reduce((t, r) => t + r.qty, 0);
  const qtyAmount = qtyList.reduce((t, r) => t + r.amount, 0);
  return { ym, total, count: list.length, qty, avgUnit: qty > 0 ? qtyAmount / qty : null };
}

/** 伸びた・落ちた：前年同月との差の大きい順に3つずつ。前年同月のデータが無いときは null */
function movers(cur, prev) {
  const names = new Set([...cur.keys(), ...prev.keys()]);
  const all = [...names].map((name) => {
    const c = cur.get(name) ?? 0; const p = prev.get(name) ?? 0;
    return { name, cur: c, prev: p, diff: c - p, pct: pctOf(c, p), isNew: p === 0 && c > 0, isLost: c === 0 && p > 0 };
  });
  return {
    risers: all.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff || a.name.localeCompare(b.name, 'ja')).slice(0, 3),
    fallers: all.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff || a.name.localeCompare(b.name, 'ja')).slice(0, 3),
  };
}

function top5(map, total) {
  const sorted = [...map].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const top = sorted.slice(0, 5).map(([name, amount]) => ({ name, amount, share: total > 0 ? amount / total : null }));
  const rest = sorted.slice(5).reduce((t, [, v]) => t + v, 0);
  return { top, rest, restShare: total > 0 ? rest / total : null, restCount: Math.max(0, sorted.length - 5) };
}

/**
 * @param records readSales のレコード
 * @param ym 対象の月 'YYYY-MM'
 */
export function calcMonthly(records, ym) {
  const byMonth = new Map();
  for (const r of records) { if (!byMonth.has(r.ym)) byMonth.set(r.ym, []); byMonth.get(r.ym).push(r); }
  const cur = monthTotals(byMonth, ym);
  if (!cur) return null;
  const prevM = monthTotals(byMonth, addMonths(ym, -1));
  const yoyM = monthTotals(byMonth, addMonths(ym, -12));
  const rel = (p) => (p ? { ym: p.ym, total: p.total, diff: cur.total - p.total, pct: pctOf(cur.total, p.total), count: p.count, avgUnit: p.avgUnit } : null);
  const list = byMonth.get(ym);
  const prevYearList = byMonth.get(addMonths(ym, -12)) ?? [];
  // 直近12か月（対象の月まで）。データの無い月は null（0にしない）
  const series12 = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(ym, i - 11);
    return { ym: m, thisYear: monthTotals(byMonth, m)?.total ?? null, prevYear: monthTotals(byMonth, addMonths(m, -12))?.total ?? null };
  });
  const customers = top5(sumBy(list, 'customer'), cur.total);
  const products = top5(sumBy(list, 'product'), cur.total);
  const hasYoy = Boolean(yoyM);
  return {
    ym, label: ymLabel(ym),
    total: cur.total, count: cur.count, qty: cur.qty, avgUnit: cur.avgUnit,
    prev: rel(prevM), yoy: rel(yoyM),
    series12, customers, products,
    customerMovers: hasYoy ? movers(sumBy(list, 'customer'), sumBy(prevYearList, 'customer')) : null,
    productMovers: hasYoy ? movers(sumBy(list, 'product'), sumBy(prevYearList, 'product')) : null,
  };
}

// ---- 表示用の文字 ---------------------------------------------------------------------------

export const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
/** 万円（小数1桁まで）。1万円未満は円。大きな数が長くならないようにする */
export function yenShort(n) {
  const a = Math.abs(n);
  if (a >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}億円`;
  if (a >= 10_000) return `${Math.round(n / 1000) / 10}万円`.replace(/(\d)\.0万/, '$1万');
  return yen(n);
}
export const pct = (p) => (p == null ? '—' : `${p >= 0 ? '＋' : '－'}${Math.abs(p * 100).toFixed(1)}%`);
export const share = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);
