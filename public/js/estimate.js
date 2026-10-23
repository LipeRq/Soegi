// 「御社の場合」の試算（計算だけ。画面は estimate-ui.js）。
// 既定値はすべて仮置きで、画面で変えられる。結果は試算であり約束ではない（持ち帰り1枚にも必ず書く）。
// 料金は pricing.js の1か所から取る。
import { MENUS, TRIAL, pricingText } from './pricing.js';

export const DISCLAIMER = '試算です。約束ではありません。お試しの1ヶ月で、御社の数字を測ります。';

/** その作業をする方の1時間の値段（札の候補）。既定は 5,000円 */
export const HOUR_VALUES = [
  { value: 1500, label: '1,500円', note: '事務の方' },
  { value: 3000, label: '3,000円', note: '' },
  { value: 5000, label: '5,000円', note: '社長' },
  { value: 8000, label: '8,000円', note: '' },
];
export const DEFAULT_HOUR_VALUE = 5000;

/** 浮いた時間の使い道。業種を選ぶと候補が出る */
export const INDUSTRIES = {
  construction: { label: '工務店・建設', uses: ['現場の巡回', '施主へのフォロー', '見積の提出を早める', '営業訪問'] },
  food: { label: '食品加工・製造', uses: ['取引先の訪問', '新商品', '衛生・品質の見直し', '若手の指導'] },
  lodging: { label: '宿泊', uses: ['接客', '食事の工夫', '口コミ返信', '直接予約を増やす取り組み'] },
  accounting: { label: '税理士・会計事務所', uses: ['顧問先との面談', '経営の助言', '新規顧問の獲得'] },
  care: { label: '介護・サービス', uses: ['利用者と向き合う時間', '職員との面談', 'シフトの見直し'] },
  other: { label: 'その他', uses: [] },
};

const pct = { min: 0, max: 100, step: 5, unit: '%' };

/**
 * デモごとの試算の定義。
 * inputs：画面の入力（既定値は仮置き）。hours(v)：月に浮く時間（0未満もそのまま返す。丸めと0の扱いは calcEstimate）
 * payback：年間費用を「1件あたりの金額」で割る試算（宿・チャットボット）
 */
export const DEMOS = {
  receipt: {
    name: '経理：レシート → Excel', menu: 'manual', industry: 'accounting',
    inputs: [
      { key: 'count', label: '月のレシート・領収書の枚数', unit: '枚', def: 100, min: 0, max: 100000, step: 10 },
      { key: 'before', label: '1枚の手入力にかかる時間', unit: '分', def: 3, min: 0, max: 60, step: 0.5 },
      { key: 'after', label: '導入後の1枚の時間（確かめるだけ）', unit: '分', def: 1, min: 0, max: 60, step: 0.5 },
    ],
    hours: (v) => (v.count * (v.before - v.after)) / 60,
    measures: ['1枚あたりの入力時間', '要確認になった割合', '月末に入力が終わる日'],
  },
  attendance: {
    name: '労務：打刻データ → 残業の集計', menu: 'manual', industry: 'care',
    inputs: [
      { key: 'count', label: '毎月、集計する人数', unit: '人', def: 20, min: 0, max: 10000, step: 1 },
      { key: 'perPerson', label: '1人分の手計算にかかる時間', unit: '分', def: 15, min: 0, max: 240, step: 1 },
      { key: 'after', label: '導入後の確認の時間（全員分）', unit: '分', def: 60, min: 0, max: 6000, step: 10 },
    ],
    hours: (v) => (v.count * v.perPerson - v.after) / 60,
    measures: ['集計にかかった時間', '45時間を超えそうだった人数と、月中に気づけた回数'],
  },
  shift: {
    name: '労務：シフト表のチェック', menu: 'manual', industry: 'care',
    inputs: [
      { key: 'count', label: '毎月、確かめるシフト表の数（部署・ユニット）', unit: '表', def: 3, min: 0, max: 1000, step: 1 },
      { key: 'before', label: '1つのシフト表を目で確かめる時間', unit: '分', def: 120, min: 0, max: 1440, step: 10 },
      { key: 'after', label: '導入後の1つの時間（直すところを見るだけ）', unit: '分', def: 20, min: 0, max: 1440, step: 5 },
    ],
    hours: (v) => (v.count * (v.before - v.after)) / 60,
    measures: ['1つのシフト表を確かめる時間', '見つかった不足・連勤・ぶつかりの件数', 'シフトを出したあとの組み直しの回数'],
  },
  order: {
    name: '受注：FAX・紙の注文書 → 受注データ', menu: 'manual', industry: 'food',
    inputs: [
      { key: 'count', label: '月に届く注文書（FAX・紙）の枚数', unit: '枚', def: 200, min: 0, max: 100000, step: 10 },
      { key: 'before', label: '1枚を受注データに打ち込む時間', unit: '分', def: 5, min: 0, max: 60, step: 0.5 },
      { key: 'after', label: '導入後の1枚の時間（確かめるだけ）', unit: '分', def: 1.5, min: 0, max: 60, step: 0.5 },
    ],
    hours: (v) => (v.count * (v.before - v.after)) / 60,
    measures: ['1枚あたりの入力時間', '要確認になった明細の割合', '数量・商品の打ち間違いの件数'],
  },
  report: {
    name: '日報：音声 → 報告書', menu: 'manual', industry: 'construction',
    inputs: [
      { key: 'count', label: '月に書く日報の本数（全員分）', unit: '本', def: 100, min: 0, max: 100000, step: 10 },
      { key: 'before', label: '1本を書く（打つ・書き写す）時間', unit: '分', def: 15, min: 0, max: 120, step: 1 },
      { key: 'after', label: '導入後の1本の時間（話して、確かめるだけ）', unit: '分', def: 5, min: 0, max: 120, step: 1 },
    ],
    hours: (v) => (v.count * (v.before - v.after)) / 60,
    measures: ['1本あたりの時間', '聞き返しになった項目の数', '安全に関わる内容を、その日のうちに共有できた回数'],
  },
  knowledge: {
    name: '社内ナレッジ検索', menu: 'knowledge', industry: 'food',
    inputs: [
      { key: 'asks', label: '社長・ベテランが1日に聞かれる回数', unit: '回', def: 6, min: 0, max: 500, step: 1 },
      { key: 'minutes', label: '1回の説明にかかる時間', unit: '分', def: 5, min: 0, max: 120, step: 1 },
      { key: 'days', label: '月の稼働日', unit: '日', def: 20, min: 0, max: 31, step: 1 },
      { key: 'rate', label: '聞かれる時間のうち減る割合（仮置き）', def: 50, ...pct },
    ],
    asked: (v) => (v.asks * v.minutes * v.days) / 60,
    askedLabel: '聞かれている時間（月）',
    hours: (v) => ((v.asks * v.minutes * v.days) / 60) * (v.rate / 100),
    measures: ['質問の件数', '根拠つきで答えられた割合', '「見当たりません」になった質問'],
  },
  foreign: {
    name: '外国人スタッフ向け（社内ナレッジ検索）', menu: 'knowledge', industry: 'food',
    inputs: [
      { key: 'staff', label: '外国人スタッフの人数', unit: '人', def: 6, min: 0, max: 1000, step: 1 },
      { key: 'minutes', label: '1人に1日説明している時間', unit: '分', def: 10, min: 0, max: 240, step: 1 },
      { key: 'days', label: '月の稼働日', unit: '日', def: 20, min: 0, max: 31, step: 1 },
      { key: 'rate', label: '説明の時間のうち減る割合（仮置き）', def: 50, ...pct },
    ],
    asked: (v) => (v.staff * v.minutes * v.days) / 60,
    askedLabel: '説明している時間（月）',
    hours: (v) => ((v.staff * v.minutes * v.days) / 60) * (v.rate / 100),
    measures: ['外国語の質問の件数', '夜・休日の質問の件数', '「必ず確認」を出した件数'],
  },
  inn: {
    name: '宿泊施設の多言語対応', menu: 'inn', industry: 'lodging',
    inputs: [
      { key: 'mails', label: '外国語の問い合わせ（月の通数）', unit: '通', def: 30, min: 0, max: 10000, step: 1 },
      { key: 'before', label: '1通の返信にかかる時間', unit: '分', def: 15, min: 0, max: 240, step: 1 },
      { key: 'after', label: '導入後の1通の時間（確かめるだけ）', unit: '分', def: 5, min: 0, max: 240, step: 1 },
      { key: 'booking', label: '直接予約1組の売上', unit: '円', def: 80000, min: 0, max: 10000000, step: 1000 },
    ],
    hours: (v) => (v.mails * (v.before - v.after)) / 60,
    payback: { key: 'booking', label: '年間費用の元が取れる直接予約', unit: '組' },
    measures: ['問い合わせ件数', '1通の時間', '返信までの時間', '予約に至った件数'],
  },
  chatbot: {
    name: 'Webサイトに置くチャットボット', menu: 'chatbot', industry: 'construction',
    inputs: [
      { key: 'profit', label: '1件の成約の粗利', unit: '円', def: 200000, min: 0, max: 100000000, step: 10000 },
    ],
    hours: null, // 時間は試算しない（夜・休日の件数をお試しで測る）
    payback: { key: 'profit', label: '年間費用の元が取れる成約', unit: '件' },
    measures: ['質問の件数と内容', '夜・休日の件数', '相談・見積依頼に進んだ件数'],
  },
};

export const defaultValues = (key) => Object.fromEntries(DEMOS[key].inputs.map((i) => [i.key, i.def]));

const round1 = (n) => Math.round(n * 10) / 10;

/** 年間費用（1年目）＝ 初期（無ければ0）＋ 月額×12 */
export function annualCost(menuKey) {
  const m = MENUS[menuKey];
  return (m.initial || 0) + m.monthly * 12;
}

/** 画面の入力を数にそろえる（空・数でない値は既定値、範囲の外は端に寄せる） */
export function normalize(key, raw = {}) {
  const out = {};
  for (const i of DEMOS[key].inputs) {
    const n = Number(String(raw[i.key] ?? '').replace(/[,，\s円]/g, ''));
    out[i.key] = raw[i.key] === '' || raw[i.key] == null || !Number.isFinite(n) ? i.def : Math.min(i.max, Math.max(i.min, n));
  }
  return out;
}

/**
 * 試算する。
 * @returns {{hours:number|null, negative:boolean, asked:number|null, monthlyValue:number|null, monthlyFee:number,
 *   annualCost:number, breakEvenHours:number, payback:{count:number,label:string,unit:string}|null, verdict:string}}
 */
export function calcEstimate(key, rawValues, hourValueRaw = DEFAULT_HOUR_VALUE) {
  const d = DEMOS[key];
  const v = normalize(key, rawValues);
  const hourValue = Number(hourValueRaw) > 0 ? Number(hourValueRaw) : DEFAULT_HOUR_VALUE;
  const menu = MENUS[d.menu];
  const annual = annualCost(d.menu);
  let hours = null; let negative = false; let monthlyValue = null;
  if (d.hours) {
    const raw = d.hours(v);
    negative = raw < 0;
    hours = negative ? 0 : round1(raw);
    // 画面に出す時間（小数1桁）から金額を出す。見た人が掛け算して同じ数になるように
    monthlyValue = Math.round(hours * hourValue);
  }
  const payback = d.payback && v[d.payback.key] > 0
    ? { count: Math.ceil(annual / v[d.payback.key]), label: d.payback.label, unit: d.payback.unit }
    : null;
  const breakEvenHours = round1(menu.monthly / hourValue);
  let verdict = 'none';
  if (monthlyValue != null) {
    if (monthlyValue >= menu.monthly * 1.05) verdict = 'over';
    else if (monthlyValue >= menu.monthly * 0.95) verdict = 'even';
    else if (monthlyValue >= menu.monthly / 2) verdict = 'near';
    else verdict = 'under';
  }
  return {
    values: v, hourValue, hours, negative, asked: d.asked ? round1(d.asked(v)) : null,
    monthlyValue, monthlyFee: menu.monthly, annualCost: annual, breakEvenHours,
    shortHours: hours == null ? null : round1(Math.max(0, breakEvenHours - hours)),
    payback, verdict,
  };
}

const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const man = (n) => (n % 10000 === 0 ? `${(n / 10000).toLocaleString('ja-JP')}万円` : yen(n));

export function verdictText(key, r) {
  const fee = `月額${man(r.monthlyFee)}`;
  if (r.verdict === 'none') {
    return r.payback ? `年に${r.payback.count}${r.payback.unit}の成約で、1年目の費用（${man(r.annualCost)}）の元が取れる目安です。` : '';
  }
  const tail = r.payback ? `直接予約なら年に${r.payback.count}${r.payback.unit}で、1年目の費用（${man(r.annualCost)}）の元が取れる目安です。` : '';
  switch (r.verdict) {
    case 'over': return `時間の削減だけで、${fee}を上回る目安です。${tail}`;
    case 'even': return `時間の削減だけで、ちょうど${fee}に届く目安です。${tail}`;
    case 'near': return `あと月${r.shortHours}時間の削減で${fee}に届く目安です。${tail || 'ミスの手直しや、お客さまを待たせる時間など、お金に直結する数字も一緒に測ると判断しやすくなります。'}`;
    default: return `時間の削減だけでは、${fee}に届かない目安です。${tail || '無理におすすめはしません。作業量が多い別の業務がないか、一緒に探しましょう。'}`;
  }
}

/**
 * 持ち帰り1枚の中身（文字だけ）。画面の部品とテストの両方が使う。
 * @param state {key, values, hourValue, industry, use, date}
 */
export function buildTakeaway(state) {
  const d = DEMOS[state.key];
  const r = calcEstimate(state.key, state.values, state.hourValue);
  const assumptions = d.inputs.map((i) => [i.label, i.unit === '円' ? yen(r.values[i.key]) : `${r.values[i.key].toLocaleString('ja-JP')}${i.unit}`]);
  if (d.hours) assumptions.push(['その作業をする方の1時間の値段', yen(r.hourValue)]);
  const results = [];
  if (r.asked != null) results.push([d.askedLabel, `${r.asked}時間`]);
  if (r.hours != null) {
    results.push(['月に浮く時間（試算）', `${r.hours}時間`]);
    results.push(['金額に換算すると（試算）', `月 ${yen(r.monthlyValue)}`]);
    results.push([`${MENUS[d.menu].name}の月額`, `月 ${man(r.monthlyFee)}`]);
    results.push(['月額の元が取れる時間', `月 ${r.breakEvenHours}時間`]);
  }
  if (r.payback) results.push([r.payback.label, `年に${r.payback.count}${r.payback.unit}（1年目の費用 ${man(r.annualCost)}）`]);
  return {
    title: '御社の場合（試算）',
    date: state.date,
    demoName: d.name,
    industry: INDUSTRIES[state.industry]?.label ?? '',
    disclaimer: DISCLAIMER,
    assumptions,
    results,
    verdict: verdictText(state.key, r),
    negativeNote: r.negative ? '導入後の時間が今より長くなっているため、浮く時間は0として計算しました。' : '',
    use: String(state.use ?? '').trim().slice(0, 100),
    measures: d.measures,
    pricing: pricingText(d.menu),
    trial: `${TRIAL.name} ${man(TRIAL.price)}（${TRIAL.text}）`,
    contact: { site: 'https://withsoegi.jp/', tel: '080-9018-2777', mail: 'info@withsoegi.jp' },
  };
}
