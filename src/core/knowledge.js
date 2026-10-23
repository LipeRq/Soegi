// デモA：社内ナレッジ検索。資料をAIに渡し、答えと根拠（資料のどの箇所か）を返させる。
// AIの言う「根拠」はそのまま信じず、プログラムで資料と照合する（引用の文が本当にその箇所にあるか）。
import { fixed, EASY, langKey, TRANSLATED_JA } from './lang.js';

export const CATEGORIES = ['有給・休み', '遅刻・欠勤', '休憩・勤務時間', '衛生', '安全・けが', '機械・エラー', '見積・単価', '出荷', '作業手順', 'その他'];

/** AIに渡す資料の本文。[doc_id#section_id] で箇所を指せるようにする */
export function buildDocsContext(docs) {
  return docs.map((d) => [
    `### 資料 ${d.id}：${d.title}`,
    ...d.sections.map((s) => `[${d.id}#${s.id}] ${s.heading}\n${s.text}`),
  ].join('\n')).join('\n\n');
}

/** 照合のための正規化（全角半角・空白の違いを無視） */
export const normalizeForMatch = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/[。．.]+$/, '');

function quoteInText(quote, text) {
  const q = normalizeForMatch(quote);
  if (q.length < 4) return false;
  const t = normalizeForMatch(text);
  if (t.includes(q)) return true;
  // 「…」で省略された引用は、各部分が順に含まれていればよい
  const parts = q.split(/…|\.\.\./).filter((p) => p.length >= 4);
  if (parts.length < 2) return false;
  let pos = 0;
  for (const p of parts) {
    const i = t.indexOf(p, pos);
    if (i < 0) return false;
    pos = i + p.length;
  }
  return true;
}

/** 引用を資料と照合する。存在しない資料・箇所・文は捨てる */
export function verifyCitations(docs, citations) {
  const valid = []; let invalid = 0;
  const seen = new Set();
  for (const c of citations ?? []) {
    const d = docs.find((x) => x.id === c.doc_id);
    const s = d?.sections.find((x) => x.id === c.section_id);
    if (!d || !s || !quoteInText(c.quote, s.text)) { invalid++; continue; }
    const key = `${d.id}#${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ docId: d.id, sectionId: s.id, title: d.title, heading: s.heading, quote: String(c.quote).trim(), text: s.text, tags: d.tags ?? [] });
  }
  return { valid, invalid };
}

// 安全・衛生・体調に関わる質問かどうか（AIの判断に加えて、プログラムでも必ず見る）
const SAFETY_RE = /けが|怪我|ケガ|切っ|切れ|切り傷|血|やけど|火傷|熱い|体調|発熱|熱が|下痢|吐|気分|頭痛|手袋|衛生|消毒|手洗|異物|安全|カバー|機械|エラー|ノズル|殺菌|薬品|洗剤|アレルギー|倒れ|転ん|危な|injur|cut|burn|sick|fever|glove|hygien|safety|machine|error|luka|sarung tangan|sakit|demam|găng tay|bị thương|bỏng|ốm|sốt|an toàn|vệ sinh/i;
// 労務・在留資格の判断に踏み込む質問
const LABOR_RE = /在留|ビザ|査証|資格の変更|転職|帰国|給料の計算|給与の計算|残業代|割増|解雇|クビ|労災の認定|visa|residence status|salary calculation|overtime|時間外手当|最低賃金|overtime pay|thị thực|lương tăng ca|izin tinggal|gaji lembur/i;

export const isSafetyRelated = (...texts) => texts.some((t) => SAFETY_RE.test(String(t ?? '')));
export const isLaborJudgment = (...texts) => texts.some((t) => LABOR_RE.test(String(t ?? '')));

/**
 * AIの答えを、画面に出す形に仕上げる。根拠が確かめられなければ「見当たりません」に置き換える。
 * @param docs 資料
 * @param v validateKnowledge 済みのAIの答え
 * @param question 元の質問
 */
export function finalizeKnowledgeAnswer(docs, v, question) {
  const lang = langKey(v.language);
  const isJa = lang === 'ja';
  const { valid, invalid } = verifyCitations(docs, v.citations);
  const found = v.found && valid.length > 0;
  const notes = [];
  if (v.found && !valid.length) notes.push('AIが示した根拠を資料の中で確かめられなかったため、答えを出していません。');
  else if (invalid) notes.push(`資料の中で確かめられなかった根拠を${invalid}件、表示から外しました。`);

  const answer = found ? v.answer : fixed('notFound', lang);
  const easyJa = isJa ? '' : (found ? v.easy_japanese : EASY.notFound);
  const answerJa = found ? (v.answer_ja || (isJa ? v.answer : '')) : fixed('notFound', 'ja');

  const requireConfirm = v.safety_related || isSafetyRelated(question, v.question_ja) || (found && valid.some((c) => c.tags.includes('safety')));
  const laborNotice = isLaborJudgment(question, v.question_ja);

  return {
    language: lang,
    isJapanese: isJa,
    questionJa: isJa ? question : v.question_ja,
    found,
    answer,
    answerJa,
    easyJa,
    citations: found ? valid.map(({ tags, ...c }) => c) : [],
    category: CATEGORIES.includes(v.category) ? v.category : 'その他',
    requireConfirm,
    confirmText: requireConfirm ? fixed('confirm', lang) : '',
    confirmEasy: requireConfirm && !isJa ? EASY.confirm : '',
    confirmJa: requireConfirm ? fixed('confirm', 'ja') : '',
    laborNotice,
    laborText: laborNotice ? fixed('labor', lang) : '',
    laborEasy: laborNotice && !isJa ? EASY.labor : '',
    translatedNote: isJa ? '' : fixed('translated', lang),
    translatedNoteJa: isJa ? '' : TRANSLATED_JA,
    notes,
  };
}
