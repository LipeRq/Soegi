// デモA：社内ナレッジ検索＋外国人スタッフ向け。資料は少ないので、全文を毎回AIに渡す（検索用のDBは作らない）。
import { extractStructured } from '../ai.js';
import { KNOWLEDGE_TOOL, validateKnowledge } from '../schemas.js';
import { HttpError, withRetry, UNTRUSTED_NOTE } from '../http.js';
import { buildDocsContext, finalizeKnowledgeAnswer } from '../core/knowledge.js';
import data from '../../public/data/sakuranbo.json' with { type: 'json' };

const MAX_QUESTION = 500;

// 資料の部分は毎回同じなので、先頭に置いてキャッシュが効くようにする
const SYSTEM = [
  `あなたは「${data.company.name}」の社内資料の案内係です。社長・事務・現場のリーダー・外国人スタッフからの質問に、下の資料だけを使って答えます。`,
  UNTRUSTED_NOTE,
  '決まりごと：',
  '- 資料に書いてあることだけで答える。推測や一般論で補わない。資料に答えが無ければ found を false にする。',
  '- 質問と同じ言語で answer を書く。answer_ja には同じ内容を日本語で書く。',
  '- 日本語以外の質問には、easy_japanese に「やさしい日本語」の答えも書く（1文を短く、むずかしい漢字の言葉は言いかえる、尊敬語・謙譲語を使わない、ひらがなを多めに、ことばの間に空白を入れてよい）。',
  '- 手順は番号付きで、資料の順番どおりに書く。数字（単価・時刻・日数など）は資料のとおりに書く。',
  '- citations には根拠にした箇所を入れる。doc_id と section_id は資料の [doc_id#section_id] のとおり。quote は資料の文を一字一句そのまま写す（言いかえない）。',
  '- 単価などを聞かれたら、どの見積書の何行目かを答えの中でも示す。「去年」は今日の日付の前の年。',
  '- 安全・衛生・けが・体調に関わる質問は safety_related を true にする。',
  '- 給料・残業代の計算、在留資格（ビザ）など労務・法律の判断はしない。就業規則に書いてあることを案内するまでにする。',
  '',
  '# 資料',
  buildDocsContext(data.docs),
].join('\n');

export async function knowledge(env, body) {
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question) throw new HttpError(400, '質問を入力してください');
  if (question.length > MAX_QUESTION) throw new HttpError(400, `質問は${MAX_QUESTION}文字までにしてください`);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const v = await withRetry(async () => validateKnowledge(await extractStructured(env, {
    tool: KNOWLEDGE_TOOL,
    system: SYSTEM,
    userText: `今日の日付：${today}\n質問：${question}`,
    maxTokens: 2500,
  })));
  return finalizeKnowledgeAnswer(data.docs, v, question);
}
