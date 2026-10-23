// デモA：「御社の資料で試す」。資料は画面の中で文字にしてから送られてくる（サーバーは何も持たない）。
// AI（Claude の引用機能）が示した根拠は、そのまま信じず、資料の文字と照合する。引用が1つも確かめられなければ「見当たりません」。
import { HttpError } from '../http.js';
import { fixed, EASY, langKey } from './lang.js';
import { isSafetyRelated, isLaborJudgment, normalizeForMatch } from './knowledge.js';

export const OWN_MAX_DOCS = 3;
export const OWN_MAX_CHARS = 50_000;
export const OWN_MAX_QUESTION = 500;
const MIN_QUOTE = 4;

/** 質問の言語を、文字の種類から大まかに決める（決まった文言を出す言語を選ぶだけ。AIの答えの言語は質問に合わせさせる） */
export function guessLang(text) {
  const t = String(text ?? '');
  if (/[぀-ヿ]/.test(t)) return 'ja';
  if (/[가-힣]/.test(t)) return 'ko';
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t)) return 'vi';
  if (/[一-鿿]/.test(t)) return 'ja';
  return 'en';
}

/** 画面から来た資料を確かめる。上限を超えたら、切らずに断る（黙って切ると、答えが無いのに「見当たりません」になる） */
export function normalizeOwnDocs(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, '資料を入れてください');
  if (raw.length > OWN_MAX_DOCS) throw new HttpError(400, `資料は${OWN_MAX_DOCS}つまでです`);
  const docs = raw.map((d, i) => {
    if (!d || typeof d.text !== 'string') throw new HttpError(400, `${i + 1}つ目の資料を読めませんでした`);
    const name = (typeof d.name === 'string' ? d.name.replace(/[\u0000-\u001f]/g, ' ').trim() : '').slice(0, 100) || `資料${i + 1}`;
    const text = d.text.replace(/\u0000/g, '');
    if (!text.trim()) throw new HttpError(400, `「${name}」に文字がありません`);
    return { name, text };
  });
  const total = docs.reduce((t, d) => t + d.text.length, 0);
  if (total > OWN_MAX_CHARS) {
    throw new HttpError(400, `資料の文字が多すぎます（合わせて${total.toLocaleString('ja-JP')}文字。上限は${OWN_MAX_CHARS.toLocaleString('ja-JP')}文字）。${docs.map((d) => `「${d.name}」${d.text.length.toLocaleString('ja-JP')}文字`).join('、')}。資料を減らしてお試しください`);
  }
  return docs;
}

export const normalizeOwnQuestion = (q) => {
  const question = typeof q === 'string' ? q.trim() : '';
  if (!question) throw new HttpError(400, '質問を入力してください');
  if (question.length > OWN_MAX_QUESTION) throw new HttpError(400, `質問は${OWN_MAX_QUESTION}文字までにしてください`);
  return question;
};

/** 引用の文が、その資料の中に本当にあるか。あれば位置（資料の文字の何文字目から何文字目まで）を返す */
function locate(doc, cite) {
  const quote = String(cite.cited_text ?? '');
  if (normalizeForMatch(quote).length < MIN_QUOTE) return null;
  const s = Number(cite.start_char_index); const e = Number(cite.end_char_index);
  if (Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && doc.text.slice(s, e) === quote) return { start: s, end: e, quote };
  const i = doc.text.indexOf(quote);
  if (i >= 0) return { start: i, end: i + quote.length, quote };
  // 空白・全角半角の違いだけなら、資料の中にあるものとみなす（位置は分からない）
  if (normalizeForMatch(doc.text).includes(normalizeForMatch(quote))) return { start: -1, end: -1, quote: quote.trim() };
  return null;
}

/**
 * AIの答え（文章＋引用）を、画面に出す形に仕上げる。
 * @param docs normalizeOwnDocs の結果
 * @param ai {text:string, citations:[{document_index, cited_text, start_char_index, end_char_index}], usage?}
 */
export function finalizeOwnAnswer(docs, ai, question) {
  const lang = guessLang(question);
  const valid = []; let invalid = 0;
  const seen = new Set();
  for (const c of ai.citations ?? []) {
    const doc = docs[c.document_index];
    const loc = doc ? locate(doc, c) : null;
    if (!loc) { invalid++; continue; }
    const key = `${c.document_index}:${loc.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ docIndex: c.document_index, docName: doc.name, quote: loc.quote, start: loc.start, end: loc.end });
  }
  const text = String(ai.text ?? '').trim();
  const found = Boolean(text) && valid.length > 0;
  const notes = [];
  // 引用が1つも付かなかった答え（資料に無い）には、注意は付けない。引用はあったが確かめられなかったときだけ知らせる
  if (text && !valid.length && invalid) notes.push('AIが示した根拠を資料の中で確かめられなかったため、答えを出していません。');
  else if (invalid) notes.push(`資料の中で確かめられなかった根拠を${invalid}件、表示から外しました。`);

  const isJa = lang === 'ja';
  const requireConfirm = isSafetyRelated(question, found ? text : '');
  const laborNotice = isLaborJudgment(question);
  return {
    language: lang,
    found,
    answer: found ? text : fixed('notFound', lang),
    easyJa: !found && !isJa ? EASY.notFound : '',
    citations: found ? valid : [],
    requireConfirm,
    confirmText: requireConfirm ? fixed('confirm', lang) : '',
    confirmEasy: requireConfirm && !isJa ? EASY.confirm : '',
    laborNotice,
    laborText: laborNotice ? fixed('labor', lang) : '',
    laborEasy: laborNotice && !isJa ? EASY.labor : '',
    docs: docs.map((d) => ({ name: d.name, chars: d.text.length })),
    usage: ai.usage ?? null,
    notes,
  };
}

export { langKey };
