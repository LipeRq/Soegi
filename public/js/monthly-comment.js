// 月次レポートのコメント：AIの文に数字を書かせない。
// 計算した数字・名前を「事実の一覧（番号付き）」にして渡し、AIは {f3} のような番号で指す。プログラムが値を埋める。
// AIの文に数字（全角・半角）が残っていたら、その行は捨てて決まった文に置き換える。原因は断定しない。
import { yenShort, pct, share, yen } from './monthly-calc.js';

/** 事実の一覧（AIに渡す）。値のある事実だけを入れる（無いものは、AIが指せない） */
const clip = (s, n) => { const a = [...s]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : s; };
export function buildFacts(c) {
  // 値は80文字まで（サーバーも同じ長さで切るので、AIの文と画面の名前がずれない）
  const f = []; const add = (label, value) => { f.push({ id: `f${f.length + 1}`, label: String(label).slice(0, 40), value: clip(String(value), 80) }); };
  add('対象の月', c.label);
  add('売上合計', yenShort(c.total));
  if (c.prev?.pct != null) add('前月比', pct(c.prev.pct));
  if (c.yoy?.pct != null) add('前年同月比', pct(c.yoy.pct));
  add('取引の件数', `${c.count.toLocaleString('ja-JP')}件`);
  if (c.avgUnit != null) add('平均単価（金額÷数量）', `${Math.round(c.avgUnit).toLocaleString('ja-JP')}円`);
  const t = c.customers.top[0];
  if (t) { add('売上がいちばん多い顧客', t.name); if (t.share != null) add('その顧客の構成比', share(t.share)); }
  const tp = c.products.top[0];
  if (tp) { add('売上がいちばん多い商品', tp.name); if (tp.share != null) add('その商品の構成比', share(tp.share)); }
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
  // 比べる相手：割合の出せる前年同月 → 前月（どちらも出せなければ、金額だけ）
  const pick = [[c.yoy, '前年同月'], [c.prev, '前月']].find(([x]) => x && x.pct != null);
  const [base, baseName] = pick ?? [];
  lines.push(base
    ? `${c.label}の売上は${yenShort(c.total)}で、${baseName}${base.diff === 0 ? 'と変わりません' : `より${base.diff > 0 ? '増えました' : '減りました'}`}（${pct(base.pct)}）。`
    : `${c.label}の売上は${yenShort(c.total)}です（比べる月のデータがありません）。`);
  const t = c.customers.top[0];
  if (t) lines.push(`売上がいちばん多い顧客は${t.name}${t.share != null ? `で、全体の${share(t.share)}` : ''}です。`);
  const r = c.customerMovers?.risers[0]; const d = c.customerMovers?.fallers[0];
  if (r || d) lines.push([r && `前年同月より最も伸びた顧客は${r.name}（${yenShort(r.diff)}増）`, d && `最も落ちた顧客は${d.name}（${yenShort(Math.abs(d.diff))}減）`].filter(Boolean).join('、') + 'です。');
  else lines.push('前年同月のデータがないため、伸びた・落ちた所は出せません。');
  return lines.slice(0, 3);
}

// 全角の { f 1 } も番号として読む（値を埋めるのは元の文。見た目の記号は変えない）
const TOKEN = /[{｛][fｆ]([0-9０-９]{1,2})[}｝]/g;
// 数字は、アラビア数字・全角数字・漢数字、数を言う言葉（倍・割・半分）も許さない（数はプログラムが埋める）
const DIGIT = /[0-9０-９〇一二三四五六七八九十百千万億兆]|[倍割]|半分|ゼロ/;
// 原因を断定する言い方（「〜の可能性」まで。言い切らない）。捨てても決まった文に置き換わるので、広めに止める
const CAUSAL = /原因|理由|せい|おかげ|影響|起因|要因|によるもの|ためです|ためだ|からです|からだ|効果/;
const toId = (n) => `f${Number(String(n).replace(/[０-９]/g, (d) => d.charCodeAt(0) - 0xFF10))}`;

/**
 * AIの行 → 値を埋めた行。使えない行は null（呼び出し側が決まった文に置き換える）。
 * 使えない行：番号が事実に無い／番号を除いて数字が残る／原因を言い切る／空・長すぎる
 * @returns {{lines:(string|null)[], dropped:{index:number, reason:string}[]}}
 */
export function renderComment(aiLines, facts) {
  const byId = new Map(facts.map((x) => [x.id, x.value]));
  const dropped = [];
  const lines = (Array.isArray(aiLines) ? aiLines : []).slice(0, 3).map((raw, index) => {
    const t = String(raw ?? '').trim();
    const bare = t.replace(TOKEN, '').normalize('NFKC');
    const ids = [...t.matchAll(TOKEN)].map((m) => toId(m[1]));
    const bad = !t ? '空' : t.length > 90 ? '長すぎる' : ids.some((id) => !byId.has(id)) ? '事実に無い番号' : /[{}｛｝]/.test(bare) ? '番号の形が正しくない' : DIGIT.test(bare) ? '数字が残っている' : CAUSAL.test(bare) ? '原因を言い切っている' : '';
    if (bad) { dropped.push({ index, reason: bad }); return null; }
    return t.replace(TOKEN, (_, n) => byId.get(toId(n)));
  });
  return { lines, dropped };
}

/** 3行にそろえる：AIの行が使えなければ、同じ位置の決まった文を使う */
export function mergeLines(rendered, fixed) {
  return Array.from({ length: 3 }, (_, i) => ({ text: rendered[i] ?? fixed[i] ?? '', source: rendered[i] ? 'ai' : 'fixed' })).filter((l) => l.text);
}

export { yen };
