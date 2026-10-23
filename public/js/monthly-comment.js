// 月次レポートのコメント：AIの文に数字を書かせない。
// 計算した数字・名前を「事実の一覧（番号付き）」にして渡し、AIは {f3} のような番号で指す。プログラムが値を埋める。
// AIの文に数字（全角・半角）が残っていたら、その行は捨てて決まった文に置き換える。原因は断定しない。
import { yenShort, pct, share, yen } from './monthly-calc.js';

/** 事実の一覧（AIに渡す）。値のある事実だけを入れる（無いものは、AIが指せない） */
export function buildFacts(c) {
  const f = []; const add = (label, value) => { f.push({ id: `f${f.length + 1}`, label, value: String(value) }); };
  add('対象の月', c.label);
  add('売上合計', yenShort(c.total));
  if (c.prev) add('前月比', pct(c.prev.pct));
  if (c.yoy) add('前年同月比', pct(c.yoy.pct));
  add('取引の件数', `${c.count.toLocaleString('ja-JP')}件`);
  if (c.avgUnit != null) add('平均単価（金額÷数量）', `${Math.round(c.avgUnit).toLocaleString('ja-JP')}円`);
  const t = c.customers.top[0];
  if (t) { add('売上がいちばん多い顧客', t.name); add('その顧客の構成比', share(t.share)); }
  const tp = c.products.top[0];
  if (tp) { add('売上がいちばん多い商品', tp.name); add('その商品の構成比', share(tp.share)); }
  const rc = c.customerMovers?.risers[0]; const fc = c.customerMovers?.fallers[0];
  if (rc) { add('前年同月より最も伸びた顧客', rc.name); add('その増えた額', yenShort(rc.diff)); }
  if (fc) { add('前年同月より最も落ちた顧客', fc.name); add('その減った額', yenShort(Math.abs(fc.diff))); }
  const rp = c.productMovers?.risers[0]; const fp = c.productMovers?.fallers[0];
  if (rp) { add('前年同月より最も伸びた商品', rp.name); add('その増えた額', yenShort(rp.diff)); }
  if (fp) { add('前年同月より最も落ちた商品', fp.name); add('その減った額', yenShort(Math.abs(fp.diff))); }
  return f;
}

/** 決まった文（AIを使わないときと、AIの行を捨てたときの置き換え）。数字はプログラムが埋める */
export function fixedLines(c) {
  const lines = [];
  const base = c.yoy ?? c.prev;
  const baseName = c.yoy ? '前年同月' : '前月';
  lines.push(base
    ? `${c.label}の売上は${yenShort(c.total)}で、${baseName}より${base.diff >= 0 ? '増えました' : '減りました'}（${pct(base.pct)}）。`
    : `${c.label}の売上は${yenShort(c.total)}です（比べる月のデータがありません）。`);
  const t = c.customers.top[0];
  if (t) lines.push(`売上がいちばん多い顧客は${t.name}で、全体の${share(t.share)}です。`);
  const r = c.customerMovers?.risers[0]; const d = c.customerMovers?.fallers[0];
  if (r || d) lines.push([r && `前年同月より最も伸びた顧客は${r.name}（${yenShort(r.diff)}増）`, d && `最も落ちた顧客は${d.name}（${yenShort(Math.abs(d.diff))}減）`].filter(Boolean).join('、') + 'です。');
  else lines.push('前年同月のデータがないため、伸びた・落ちた所は出せません。');
  return lines.slice(0, 3);
}

const TOKEN = /\{f(\d{1,2})\}/g;
const DIGIT = /[0-9０-９]/;
// 原因を断定する言い方（「〜の可能性」まで。言い切らない）
const CAUSAL = /が原因|原因は|のせいで|のおかげ|によるものです|ためです|からです。$/;

/**
 * AIの行 → 値を埋めた行。使えない行は null（呼び出し側が決まった文に置き換える）。
 * 使えない行：番号が事実に無い／番号を除いて数字が残る／原因を言い切る／空・長すぎる
 * @returns {{lines:(string|null)[], dropped:{index:number, reason:string}[]}}
 */
export function renderComment(aiLines, facts) {
  const byId = new Map(facts.map((x) => [x.id, x.value]));
  const dropped = [];
  const lines = (Array.isArray(aiLines) ? aiLines : []).slice(0, 3).map((raw, index) => {
    const t = String(raw ?? '').normalize('NFKC').trim();
    const bare = t.replace(TOKEN, '');
    const ids = [...t.matchAll(TOKEN)].map((m) => `f${m[1]}`);
    const bad = !t ? '空' : t.length > 120 ? '長すぎる' : ids.some((id) => !byId.has(id)) ? '事実に無い番号' : DIGIT.test(bare) ? '数字が残っている' : CAUSAL.test(bare) ? '原因を言い切っている' : '';
    if (bad) { dropped.push({ index, reason: bad }); return null; }
    return t.replace(TOKEN, (_, n) => byId.get(`f${n}`));
  });
  return { lines, dropped };
}

/** 3行にそろえる：AIの行が使えなければ、同じ位置の決まった文を使う */
export function mergeLines(rendered, fixed) {
  return Array.from({ length: 3 }, (_, i) => ({ text: rendered[i] ?? fixed[i] ?? '', source: rendered[i] ? 'ai' : 'fixed' })).filter((l) => l.text);
}

export { yen };
