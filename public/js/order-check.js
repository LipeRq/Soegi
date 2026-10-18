// FAX・紙の注文書 → 受注データ：AIが読んだ注文書を、プログラムで商品マスタ・取引先マスタと照合し、検算する。
// AIは読むだけ。どの商品か・数が合っているか・納品日が正しいかは、ここで決める（同じ入力なら毎回同じ結果）。
//  赤：数量が空・0・数でない／数量×単価≠金額／納品日が空・読めない・過去・発注日より前
//  黄：表記ゆれの候補（人が選ぶ）／未登録の商品・取引先／単位がマスタと違う（ケースなど）／単価がマスタと違う／規格が無い／重複／確かさ「低」

const CASE_UNITS = /^(ケース|けーす|cs|c\/s|ｃｓ|箱|ボール|ﾎﾞｰﾙ|case)$/i;

/** 照合用に表記をそろえる（全角半角・空白・中黒・会社の敬称・（仮）の違いを無視） */
export function normText(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase()
    .replace(/[（(]仮[)）]/g, '')
    .replace(/株式会社|有限会社|\(株\)|\(有\)|御中|様|殿|仕入部|仕入れ部|発注係/g, '')
    .replace(/[\s・･·.,、。\-－―]/g, '')
    .trim();
}

/** 規格をそろえる（150ｇ・150グラム・150 g → 150g、1キロ → 1kg） */
export function normSpec(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
    .replace(/キログラム|キロ/g, 'kg').replace(/グラム/g, 'g')
    .replace(/ミリリットル|ミリ/g, 'ml').replace(/リットル/g, 'l');
}

/** 文字の2つ組の一致率（0〜1） */
export function dice(a, b) {
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = grams(a); const B = grams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

export const SIMILAR = 0.6;

/** 品名と規格の文字から、規格らしい部分を取り出す（AIが規格を品名に入れた場合のため） */
function splitSpec(name, spec) {
  if (spec) return { name, spec };
  const m = String(name ?? '').normalize('NFKC').match(/^(.*?)\s*(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|グラム|キロ|ミリ|リットル))$/i);
  return m ? { name: m[1], spec: m[2] } : { name, spec: '' };
}

/**
 * 商品マスタと照合する。
 * @returns {{kind:'empty'|'exact'|'alias'|'similar'|'nospec'|'badspec'|'none', product:object|null, candidates:object[], score:number, spec:string}}
 *   empty：品名が空。exact：品名（表記ゆれを除いて）と規格が一致。alias：表記ゆれの一覧に一致。similar：似ている。
 *   nospec：品名は一致したが、規格が書かれておらず候補が複数。badspec：品名は一致したが、書かれた規格がマスタに無い。
 *   none：見つからない。nospec・badspec は商品を決めない（product は null）
 */
export function matchProduct(line, products) {
  const { name, spec } = splitSpec(line.name, line.spec);
  const n = normText(name); const s = normSpec(spec);
  const out = (kind, product, candidates, score) => ({ kind, product, candidates, score, spec: String(spec ?? '') });
  if (!n) return out('empty', null, [], 0);
  const sameName = products.filter((p) => normText(p.name) === n);
  const sameAlias = products.filter((p) => p.aliases.some((a) => normText(a) === n));
  const pickSpec = (list) => (s ? list.filter((p) => normSpec(p.spec) === s) : list);
  for (const [list, kind] of [[sameName, 'exact'], [sameAlias, 'alias']]) {
    if (!list.length) continue;
    const hit = pickSpec(list);
    if (hit.length === 1) return out(kind, hit[0], hit, 1);
    if (hit.length > 1) return out('nospec', null, hit, 1); // 規格が書かれていない（または同じ規格が2つ）
    // 品名は同じだが、書かれた規格がマスタに無い。違う規格を候補にしない（取引先に確かめる）
    return out('badspec', null, list, 0.9);
  }
  // 似ているもの（品名＋規格どうしで比べ、品名だけでも比べて高いほう）
  const scored = products.map((p) => {
    const byName = Math.max(dice(n, normText(p.name)), ...p.aliases.map((a) => dice(n, normText(a))));
    const specOk = !s || normSpec(p.spec) === s;
    return { p, score: specOk ? byName : byName * 0.85 };
  }).sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score >= SIMILAR) {
    return out('similar', scored[0].p, scored.filter((x) => x.score >= SIMILAR).slice(0, 3).map((x) => x.p), scored[0].score);
  }
  return out('none', null, [], scored[0]?.score ?? 0);
}

/**
 * 取引先マスタと照合する。一致は、名前か表記ゆれ（会社の敬称などを除いて）と同じときだけ。
 * 名前を含むだけ（「やまびこスーパー西店」「新月山ストア」など）は候補にする（別の会社かもしれないため）
 */
export function matchCustomer(name, customers) {
  const n = normText(name);
  if (!n) return { kind: 'none', customer: null, candidates: [] };
  for (const c of customers) {
    if ([c.name, ...c.aliases].map(normText).includes(n)) return { kind: 'exact', customer: c, candidates: [c] };
  }
  const contains = customers.filter((c) => [c.name, ...c.aliases].map(normText).some((k) => k.length >= 4 && n.includes(k)));
  if (contains.length) return { kind: 'similar', customer: contains[0], candidates: contains.slice(0, 3) };
  const scored = customers.map((c) => ({ c, score: Math.max(...[c.name, ...c.aliases].map((k) => dice(n, normText(k)))) })).sort((a, b) => b.score - a.score);
  if (scored[0].score >= SIMILAR) return { kind: 'similar', customer: scored[0].c, candidates: scored.filter((x) => x.score >= SIMILAR).slice(0, 3).map((x) => x.c) };
  return { kind: 'none', customer: null, candidates: [] };
}

const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const dayNum = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);

const ERAS = { 令和: 2018, R: 2018, 平成: 1988, H: 1988 };
const NEAR_DAYS = 183; // 年の無い日付は、今日の前後半年の中だけで決める

/**
 * 日付を読む。「2027-01-20」「2027/1/20」「2027年1月20日」「令和9年1月20日」「R9.1.20」「1/20」「1月20日」。
 * 曜日（「(水)」「水曜日」）と後ろの言葉（「午前着」など）は無視する。
 * 年が無いときは、今日に近いほうの年にする（前後半年の中に無ければ読めない）。読めなければ null
 */
export function parseOrderDate(s, todayIso) {
  const t = String(s ?? '').normalize('NFKC').trim()
    .replace(/\((?:[日月火水木金土](?:曜日?)?)\)/g, '')
    .replace(/[日月火水木金土]曜日?/g, '')
    .replace(/\s+/g, '');
  if (!t) return null;
  let m = t.match(/^(令和|平成|[RH])(\d{1,2}|元)[年./-](\d{1,2})[月./-](\d{1,2})日?(?!\d)/i);
  if (m) return iso(ERAS[m[1].toUpperCase()] + (m[2] === '元' ? 1 : +m[2]), +m[3], +m[4]);
  m = t.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?!\d)/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[/.月](\d{1,2})日?(?!\d)/);
  if (!m) return null;
  const y = +todayIso.slice(0, 4);
  const t0 = dayNum(todayIso);
  const cands = [y - 1, y, y + 1].map((yy) => iso(yy, +m[1], +m[2])).filter((d) => d && Math.abs(dayNum(d) - t0) <= NEAR_DAYS);
  cands.sort((a, b) => Math.abs(dayNum(a) - t0) - Math.abs(dayNum(b) - t0));
  return cands[0] ?? null;
}

const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * 注文書1枚を確かめる。
 * @param order {customer, customerCode?, orderDate, deliveryDate, conf:{customer,order_date,delivery_date}, lines:[{name, spec, qty, unit, unitPrice, amount, conf:{name,qty}, productCode?, confirmed?}]}
 *   productCode：人が選んだ（または照合で決まった）商品。confirmed：人が候補を確かめて選んだ
 * @returns {{header:{flags}, customer:{match, code}, orderDate, deliveryDate, lines:[{match, product, settled, flags, pieces, price, priceFrom, amount}]}}
 *   customer.code・settled：決まったものだけ。候補のままなら空・false（出力に候補のコードを入れないため）
 */
export function checkOrder(order, master, todayIso) {
  const byCode = new Map(master.products.map((p) => [p.code, p]));
  const header = [];
  const add = (list, field, level, message) => list.push({ field, level, message });

  // 取引先
  const cm = matchCustomer(order.customer, master.customers);
  // 決まった取引先：人が選んだか、マスタと一致したときだけ。候補（似ている）のままでは決めない
  const customerCode = order.customerCode || (cm.kind === 'exact' ? cm.customer.code : '');
  if (!order.customerCode) {
    if (cm.kind === 'none') add(header, 'customer', 'yellow', '取引先マスタにありません');
    else if (cm.kind === 'similar') add(header, 'customer', 'yellow', `取引先の候補：${cm.customer.name}（選んで確定してください）`);
  }
  if (order.conf?.customer === '低') add(header, 'customer', 'yellow', '発注元の読み取りに自信がありません');

  // 日付
  const od = parseOrderDate(order.orderDate, todayIso);
  if (!String(order.orderDate ?? '').trim()) add(header, 'orderDate', 'yellow', '発注日が空です');
  else if (!od) add(header, 'orderDate', 'yellow', '発注日を読めません');
  if (order.conf?.order_date === '低' && od) add(header, 'orderDate', 'yellow', '発注日の読み取りに自信がありません');
  const dd = parseOrderDate(order.deliveryDate, todayIso);
  if (!String(order.deliveryDate ?? '').trim()) add(header, 'deliveryDate', 'red', '納品日が空です（電話などで確かめてください）');
  else if (!dd) add(header, 'deliveryDate', 'red', '納品日を読めません');
  else if (dd < todayIso) add(header, 'deliveryDate', 'red', '納品日が過去の日付です');
  else if (od && dd < od) add(header, 'deliveryDate', 'red', '納品日が発注日より前です');
  if (order.conf?.delivery_date === '低' && dd) add(header, 'deliveryDate', 'yellow', '納品日の読み取りに自信がありません');

  // 明細
  const lines = order.lines.map((l) => {
    const flags = [];
    const m = matchProduct(l, master.products);
    const product = l.productCode ? byCode.get(l.productCode) ?? null : m.product;
    if (!l.productCode || !l.confirmed) {
      const specs = m.candidates.map((p) => p.spec).join('／');
      if (m.kind === 'empty' && !product) add(flags, 'name', 'yellow', '品名が空です（品名を入れるか、商品マスタの欄で選んでください）');
      else if (!product && m.kind === 'none') add(flags, 'name', 'yellow', '未登録の商品です（商品マスタにありません）');
      else if (m.kind === 'nospec' && !l.productCode) add(flags, 'name', 'yellow', `規格が書かれていません（${specs}）。選んでください`);
      else if (m.kind === 'badspec' && !l.productCode) add(flags, 'name', 'yellow', `規格（${m.spec}）がマスタにありません（${specs}）。取引先に確かめて選んでください`);
      else if ((m.kind === 'alias' || m.kind === 'similar') && !l.confirmed) add(flags, 'name', 'yellow', `表記ゆれの候補：${m.product.name}${m.product.spec ? ` ${m.product.spec}` : ''}（選んで確定してください）`);
    }
    if (l.conf?.name === '低') add(flags, 'name', 'yellow', '品名の読み取りに自信がありません');

    const qtyOk = isNum(l.qty) && l.qty > 0 && Number.isInteger(l.qty);
    if (!qtyOk) add(flags, 'qty', 'red', '数量が空・0・負の数・小数・数ではありません');
    if (l.conf?.qty === '低') add(flags, 'qty', 'yellow', '数量の読み取りに自信がありません');

    // 単位：個数（バラ）に直せるのは、単位が空・マスタと同じ・ケース（入数が分かる）のときだけ
    const unit = String(l.unit ?? '').normalize('NFKC').trim();
    let perUnit = 1; let unitKnown = true;
    if (unit && product && unit !== product.unit) {
      if (CASE_UNITS.test(unit)) {
        perUnit = product.caseQty;
        add(flags, 'unit', 'yellow', `単位を確かめてください（1${unit}＝${product.caseQty}${product.unit}。${qtyOk ? `${l.qty}${unit}＝${l.qty * perUnit}${product.unit}` : ''}）`.replace('。）', '）'));
      } else {
        unitKnown = false;
        add(flags, 'unit', 'yellow', `単位（${unit}）がマスタ（${product.unit}）と違います。個数に直せません`);
      }
    } else if (unit && !product && CASE_UNITS.test(unit)) {
      unitKnown = false;
      add(flags, 'unit', 'yellow', 'ケースの入数が分かりません（商品マスタの欄で商品を選んでください）');
    }
    const pieces = qtyOk && unitKnown ? l.qty * perUnit : null;

    // 単価・金額の欄に、数でないものが入っている（人が打ち間違えた）
    if (typeof l.unitPrice === 'number' && !isNum(l.unitPrice)) add(flags, 'unitPrice', 'red', '単価が数ではありません');
    if (typeof l.amount === 'number' && !isNum(l.amount)) add(flags, 'amount', 'red', '金額が数ではありません');
    // 単価：注文書にあればそれを使い、マスタと比べる。無ければマスタの単価
    // （単位がマスタと違って直せないときは、マスタの単価を使わない）
    let price = null; let priceFrom = '';
    if (isNum(l.unitPrice)) {
      price = l.unitPrice; priceFrom = '注文書';
      if (product && unitKnown) {
        const expected = product.price * perUnit;
        if (l.unitPrice !== expected) add(flags, 'unitPrice', 'yellow', `単価がマスタ（${yen(expected)}）と違います`);
      }
    } else if (product && unitKnown) {
      price = product.price * perUnit; priceFrom = 'マスタ';
    }
    // 検算：数量×単価と、注文書の金額。単価が書かれていなければ、マスタの単価で計算した額と比べる
    if (isNum(l.amount) && isNum(l.qty) && isNum(l.unitPrice) && l.qty * l.unitPrice !== l.amount) {
      add(flags, 'amount', 'red', `数量×単価（${yen(l.qty * l.unitPrice)}）が金額（${yen(l.amount)}）と合いません`);
    } else if (isNum(l.amount) && !isNum(l.unitPrice) && qtyOk && price != null && l.qty * price !== l.amount) {
      add(flags, 'amount', 'yellow', `金額（${yen(l.amount)}）が、マスタの単価で計算した額（${yen(l.qty * price)}）と違います`);
    }
    // 金額を計算で作るのは、数量が正しく、個数に直せるときだけ（負や小数の数量で金額を作らない）
    const amount = isNum(l.amount) ? l.amount : (pieces != null && price != null ? l.qty * price : null);
    // settled：商品が決まった（人が選んだか、品名と規格がマスタと一致）。出力の商品コードは、決まったときだけ入れる
    const settled = Boolean(l.productCode && product) || (!l.productCode && m.kind === 'exact');
    return { match: m, product, settled, flags, pieces, perUnit, price, priceFrom, amount };
  });

  // 同じ商品が2行（決まった商品どうしだけ。候補のままの行は比べない）
  const seen = new Map();
  lines.forEach((r, i) => { if (r.settled && r.product) { const k = r.product.code; seen.set(k, [...(seen.get(k) || []), i]); } });
  for (const idx of seen.values()) if (idx.length > 1) for (const i of idx) lines[i].flags.push({ field: 'row', level: 'yellow', message: '同じ商品が2行以上あります（重複の疑い）' });

  return { header: { flags: header }, customer: { match: cm, code: customerCode }, orderDate: od, deliveryDate: dd, lines };
}

export const worst = (flags) => (flags.some((f) => f.level === 'red') ? 'red' : flags.some((f) => f.level === 'yellow') ? 'yellow' : null);
export const levelAt = (flags, field) => worst(flags.filter((f) => f.field === field));
