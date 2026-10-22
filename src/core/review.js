// 宿の口コミ返信：返信は「下書き」。AIは書くだけで、要確認はプログラムが決まった語・星の数から必ず足す。
//  星1〜2 →「必ず責任者が確認」（先頭に固定の文）／返金・補償の求め →「返金・補償は宿が決める」／
//  人名らしいもの →「返信に名前を書かない」（口コミの人名が下書きにも入っていれば警告）
//  下書きの見直し：反論・言い訳・断定に読める語／URL・料金（宣伝が多くないか）
import { langKey } from './lang.js';

export const REVIEW_MAX = 1000;
export const MUST_CHECK_TEXT = '星1〜2の口コミです。返信は必ず責任者が確認してから出してください。';

// 返金・補償の求め（日・英・中・韓）。全角英字などは NFKC でそろえてから見る
const REFUND_RE = /返金|払い戻|払戻|補償|賠償|弁償|返還|お詫びの品|割引してほ|(お金|代金|料金|宿泊代|宿泊料|宿泊料金|全額|代)[をは]?.{0,3}返(して|す|金|し)|refund|compensat|reimburs|money (back|returned)|pay (us )?back|free night|reembolso|remboursement|退款|退費|退錢|退钱|退還|退还|賠償|赔偿|補償|补偿|환불|보상|배상|돈을 돌려|돌려주/i;

const norm = (t) => String(t ?? '').normalize('NFKC');
const HAN = '\\u4e00-\\u9fff';
// 人名らしいもの（さん・様・氏・Mr./Ms.・-san・小姐・先生・女士・씨・님）。呼びかけ・役職・一般名詞は名前にしない
const JA_STOP = /^(皆|みな|各|同|当|貴|本|お客|客|神|奥|旦那|何|兄|姉|娘|息子|先生|女将|おかみ|大将|主人|店主|店|スタッフ|ホテル|オーナー|家族|友人|友達|同僚|子|ご|お)$|(者|長|員|手|人|主|館|宿)$/;
const ZH_STOP = /^(這位|那位|各位|諸位|位|櫃檯|櫃台|前台|前臺|服務|服務員|店員|老|女|男|您|你|貴|各|務員|人員)$|(人員|服務員|櫃檯|櫃台)$/;
const KO_STOP = /(마음|선생|사장|부모|하나|고객|손|주인|여러분|직원|대표|원장|팀장|실장|회장|부장|과장|교수|아버|어머)$/;
const NAME_RES = [
  { re: new RegExp(`(?<![${HAN}\\u30a1-\\u30fa])([${HAN}]{1,4}|[\\u30a1-\\u30faー]{2,8})\\s?(さん|様|さま|氏|くん|君)`, 'gu'), ok: (n) => !JA_STOP.test(n) },
  { re: /(?:Mr|Mrs|Ms|Miss|Mx|Dr|MR|MRS|MS|MISS|DR)\.?\s*([\p{Lu}一-鿿][\p{L}'’-]*)/gu, ok: () => true },
  { re: /\b([\p{Lu}][\p{L}]+)[- ]san\b/gu, ok: () => true },
  { re: new RegExp(`([${HAN}]{1,2})(小姐|先生|女士)`, 'g'), ok: (n) => !ZH_STOP.test(n), zh: true },
  { re: /([가-힣]{2,4})\s?(씨|님)/g, ok: (n) => !KO_STOP.test(n) },
];

/** 人名らしい語と、返信に入りうる書き方（中国語は「王小姐」のように称号つき） */
function findNameMatches(text) {
  const out = new Map();
  const t = norm(text);
  for (const { re, ok, zh } of NAME_RES) {
    for (const m of t.matchAll(re)) {
      if (!ok(m[1])) continue;
      const variants = zh ? [...m[1]].map((_, i) => m[1].slice(i) + m[2]) : [];
      out.set(m[1], [m[1], ...variants]);
    }
  }
  return out;
}

/** 文章の中の人名らしい語（「田中さん」「Ms. Tanaka」など）。名前の部分だけを返す */
export const findNames = (text) => [...findNameMatches(text).keys()];

/** 名前が下書きに入っているか。英字は大文字小文字を区別せず、単語の途中は数えない（Li と Lighting） */
const hasName = (draft, forms) => forms.some((f) => (/^[\p{L}'’-]+$/u.test(f) && /[A-Za-z]/.test(f)
  ? new RegExp(`(?<![\\p{L}])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(draft)
  : draft.includes(f)));

// 反論・言い訳・断定に読える語（返信の日本語訳を見る）。「誤解を招き申し訳ありません」のような謝りは当てない
const REBUT_RE = /しかし当館では|規定では|規約(では|により)|そのような(事実|こと)は(ありません|ございません)|事実(と|とは)(異なり|違い|相違)|事実無根|(当館|当旅館|弊館)(に|の)?(は)?(非|落ち度|責任|問題)[^。]{0,6}(ありません|ございません|ではありません)|(落ち度|非)は(ありません|ございません)|責任は(ありません|ございません|負いかねます)|お客様の(過失|勘違い|思い込み|誤解|間違い|ご利用方法)|ご指摘は当たりません|仕方(が)?(ありません|ございません)|致し方(ありません|ございません)|対応いたしかねます/;
const PROMO_RE = /https?:\/\/|www\.|[\w-]+\.(com|jp|net|tw|org|co)\b|[\w.-]+@[\w-]+\.\w+|[¥￥€£]\s?\d|\d[\d,]*\s?(円|元|万円|千円|만원|원)|(NT|US)?\$\s?\d|\b(TWD|JPY|USD|NTD)\s?\d|\d+\s?(yen|JPY|USD|TWD)\b/i;

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
  if (texts.some((t) => REFUND_RE.test(norm(t)))) add('返金・補償は宿が決める', 'お客さまが返金・補償を求めている可能性があります。下書きでは約束していません', 'rule');
  const found = findNameMatches(`${reviewText}\n${v.review_ja}`);
  const names = [...found.keys()];
  if (names.length) add('返信に名前を書かない', `口コミに人名らしい語があります（${names.slice(0, 3).join('・')}）。お客さま・スタッフの名前は返信に書きません`, 'rule');
  for (const n of v.needs_check) {
    if (needsCheck.some((x) => x.point === n.point)) continue;
    add(n.point, n.reason, 'ai');
  }

  const warnings = [];
  const draft = norm(`${v.reply}\n${v.reply_ja}`);
  const leaked = names.filter((n) => hasName(draft, found.get(n)));
  if (leaked.length) warnings.push(`口コミの人名（${leaked.join('・')}）が下書きにも入っています。返信から名前を消してください。`);
  if (REFUND_RE.test(draft)) warnings.push('返信に返金・補償に関わる言葉があります。約束になっていないか確かめてください（返金・補償は宿が決めます）。');
  if (REBUT_RE.test(norm(v.reply_ja))) warnings.push('返信が、反論・言い訳・断定に読める言い方になっていないか確かめてください（どこまで認めるかは、宿が決めます）。');
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
