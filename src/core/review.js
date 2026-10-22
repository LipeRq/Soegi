// 宿の口コミ返信：返信は「下書き」。AIは書くだけで、要確認はプログラムが決まった語・星の数から必ず足す。
//  星1〜2 →「必ず責任者が確認」（先頭に固定の文）／返金・補償の求め →「返金・補償は宿が決める」／
//  人名らしいもの →「返信に名前を書かない」（口コミの人名が下書きにも入っていれば警告）
//  下書きの見直し：反論・言い訳・断定に読める語／URL・料金（宣伝が多くないか）
import { langKey } from './lang.js';

export const REVIEW_MAX = 1000;
export const MUST_CHECK_TEXT = '星1〜2の口コミです。返信は必ず責任者が確認してから出してください。';

// 返金・補償の求め（日・英・中・韓）
const REFUND_RE = /返金|払い戻|払戻|補償|賠償|弁償|返還|お詫びの品|宿泊料.{0,6}(返|無料)|refund|compensat|reimburs|money back|give.{0,10}back.{0,10}money|退款|退費|退錢|賠償|補償|환불|보상|배상/i;

// 人名らしいもの（さん・様・Mr.・Ms.・小姐・씨・님 など）。「お客様」などの呼びかけは名前にしない
const NAME_RES = [
  { re: /([一-鿿ァ-ヺぁ-んー]{1,8})(さん|様|氏|くん|君)/g, ok: (n) => !/^[おご]/.test(n) && !/^(皆|みな|各|同|当|貴|本|お客|スタッフ|女将|おかみ|支配人|従業員)$/.test(n) },
  { re: /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+([A-Z][a-z]+)/g, ok: () => true, whole: false },
  { re: /([一-鿿]{1,3})(小姐|先生|女士)/g, ok: (n) => !/^(各|貴|諸|您|你)$/.test(n) },
  { re: /([가-힣]{1,4})\s?(씨|님)/g, ok: (n) => !/^(고객|손님|여러분|직원)$/.test(n) },
];

/** 文章の中の人名らしい語（「田中さん」「Ms. Tanaka」など）。名前の部分だけを返す */
export function findNames(text) {
  const out = new Set();
  const t = String(text ?? '').normalize('NFKC');
  for (const { re, ok } of NAME_RES) {
    for (const m of t.matchAll(re)) if (ok(m[1])) out.add(m[1]);
  }
  return [...out];
}

// 反論・言い訳・断定に読める語（返信の日本語訳を見る）
const REBUT_RE = /しかし当館では|当館では[^。]{0,24}(ありません|ございません|おりません)|規定では|そのような事実は|事実と異なります|誤解|勘違い|当館に(落ち度|問題)は|責任は(ありません|ございません|負いかねます)|ご指摘は当たりません|仕方(が)?ありません|致し方|やむを得/;
const PROMO_RE = /https?:\/\/|www\.|[¥￥]\s?\d|\d[\d,]*\s?円|(NT|US)?\$\s?\d|\d+\s?(yen|JPY|USD|TWD)\b/i;

/**
 * @param v validateInnReview の結果
 * @param stars 1〜5
 */
export function finalizeInnReview(inn, v, reviewText, stars) {
  const ids = new Set(inn.items.map((i) => i.id));
  const texts = [reviewText, v.review_ja];
  const needsCheck = [];
  const add = (point, reason, source) => {
    if (needsCheck.some((n) => n.point === point)) return;
    needsCheck.push({ point, reason, source });
  };
  const mustCheck = stars <= 2;
  if (mustCheck) add('責任者による確認', '星1〜2の口コミは、返信の中身を責任者が決めます', 'rule');
  if (texts.some((t) => REFUND_RE.test(String(t ?? '')))) add('返金・補償は宿が決める', 'お客さまが返金・補償を求めている可能性があります。下書きでは約束していません', 'rule');
  const names = findNames(`${reviewText}\n${v.review_ja}`);
  if (names.length) add('返信に名前を書かない', `口コミに人名らしい語があります（${names.slice(0, 3).join('・')}）。お客さま・スタッフの名前は返信に書きません`, 'rule');
  for (const n of v.needs_check) {
    if (needsCheck.some((x) => x.point === n.point)) continue;
    add(n.point, n.reason, 'ai');
  }

  const warnings = [];
  const draft = `${v.reply}\n${v.reply_ja}`.normalize('NFKC');
  const leaked = names.filter((n) => draft.includes(n));
  if (leaked.length) warnings.push(`口コミの人名（${leaked.join('・')}）が下書きにも入っています。返信から名前を消してください。`);
  if (REBUT_RE.test(v.reply_ja)) warnings.push('返信が、反論・言い訳・断定に読める言い方になっていないか確かめてください（どこまで認めるかは、宿が決めます）。');
  if (PROMO_RE.test(draft)) warnings.push('返信にURLや料金が入っています。宣伝が多くないか確かめてください。');
  if (v.used_info_ids.some((id) => !ids.has(id))) warnings.push('宿の情報に無い項目を根拠にしようとした箇所がありました。返信の内容を確かめてください。');

  return {
    language: langKey(v.language),
    stars,
    mustCheck,
    mustCheckText: mustCheck ? MUST_CHECK_TEXT : '',
    reviewJa: v.review_ja,
    reply: v.reply,
    replyJa: v.reply_ja,
    points: v.points,
    needsCheck,
    usedInfo: v.used_info_ids.filter((id) => ids.has(id)).map((id) => ({ id, label: inn.items.find((i) => i.id === id).label })),
    warnings,
  };
}
