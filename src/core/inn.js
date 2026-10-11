// デモB：宿の多言語対応。返信は「下書き」。宿の情報に無いことは書かせず、
// 要確認の点はAIの挙げたものに加えて、プログラムでも決まった語から必ず足す。
import { langKey } from './lang.js';

/** AIに渡す宿の情報。[id] で項目を指せるようにする */
export function buildInnContext(inn) {
  return [`宿の名前：${inn.name}`, `概要：${inn.about}`, ...inn.items.map((i) => `[${i.id}] ${i.label}：${i.text}`)].join('\n');
}

// 問い合わせの中にあれば、必ず「要確認」に出す点（宿の情報だけでは答えが決まらないこと）
const RULES = [
  { re: /アレルギ|過敏|allerg|알레르기|알러지/i, point: 'アレルギーの具体的な対応（使う食材・調理場の状況）', reason: '宿の情報では「相談」までしか決まっていません。安全は約束できません' },
  { re: /泊まりたい|宿泊したい|予約|空室|空き|入住|訂房|預訂|空房|book|reserv|availab|vacan|예약|빈방|묵고/i, point: '空室の確認', reason: '日付と人数に空きがあるかは、宿の情報にはありません' },
  { re: /料金|値段|いくら|価格|價格|费用|費用|多少錢|price|cost|rate|how much|요금|가격|얼마/i, point: '料金', reason: '宿泊料金は宿の情報にありません' },
  { re: [/樹氷|樹冰|juhyo|snow monster|ice monster|rime|수빙/i, /ライトアップ|夜|night|light.?up|晚|라이트업|야간|밤/i], point: '樹氷ライトアップの日程', reason: '年によって変わるため、宿では確定の情報を出せません' },
  { re: /送迎|迎え|pick.?up|接送|接駁|픽업|송영/i, point: '送迎の時間（到着の時刻）', reason: '送迎は到着前の電話が必要です。時刻を確かめてください' },
];

const matches = (re, t) => (Array.isArray(re) ? re : [re]).every((x) => x.test(String(t ?? '')));

// 返信の日本語訳に、宿が約束できないことを約束する表現がないか
const PROMISE_RE = /保証します|お約束します|安全です|問題ありません|大丈夫です|必ず(除去|対応|ご用意|見られ)|完全に除去/;

export function finalizeInnReply(inn, v, inquiry) {
  const ids = new Set(inn.items.map((i) => i.id));
  const texts = [inquiry, v.inquiry_ja];
  const needsCheck = [];
  const add = (point, reason, source) => {
    if (needsCheck.some((n) => n.point === point)) return;
    needsCheck.push({ point, reason, source });
  };
  for (const r of RULES) if (texts.some((t) => matches(r.re, t))) add(r.point, r.reason, 'rule');
  for (const n of v.needs_check) {
    // AIの挙げた点のうち、ルールで足した点と同じ話題のものは足さない
    if (RULES.some((r) => matches(r.re, n.point) && needsCheck.some((x) => x.point === r.point))) continue;
    add(n.point, n.reason, 'ai');
  }
  const warnings = [];
  if (PROMISE_RE.test(v.reply_ja)) warnings.push('返信の中に、宿が約束できないことを約束している表現がないか確かめてください。');
  const unknownIds = v.used_info_ids.filter((id) => !ids.has(id));
  if (unknownIds.length) warnings.push('宿の情報に無い項目を根拠にしようとした箇所がありました。返信の内容を確かめてください。');
  return {
    language: langKey(v.language),
    inquiryJa: v.inquiry_ja,
    reply: v.reply,
    replyJa: v.reply_ja,
    needsCheck,
    usedInfo: v.used_info_ids.filter((id) => ids.has(id)).map((id) => ({ id, label: inn.items.find((i) => i.id === id).label })),
    warnings,
  };
}

/** よくある質問：宿の情報に無い項目に頼った問いは外す */
export function finalizeInnFaq(inn, v) {
  const ids = new Set(inn.items.map((i) => i.id));
  const items = v.items.filter((it) => it.info_ids.length && it.info_ids.every((id) => ids.has(id)));
  return { items, dropped: v.items.length - items.length };
}
