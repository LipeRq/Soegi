// 音声日報：話した言葉（文字）から、日報の項目を取り出す。文字だけが届く（音声は届かない）。日報の文はプログラム（report-format.js）が作る。
import { extractStructured } from '../ai.js';
import { REPORT_TOOL, validateReport } from '../schemas.js';
import { HttpError, withRetry, UNTRUSTED_NOTE, jstToday } from '../http.js';
import { missingFields, isSafety, REQUIRED } from '../../public/js/report-format.js';

export const REPORT_MAX = 1500;

export async function report(env, body) {
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) throw new HttpError(400, '話した内容を入れてください');
  if (text.length > REPORT_MAX) throw new HttpError(400, `${REPORT_MAX}文字までにしてください`);
  const today = jstToday();
  const v = await withRetry(async () => validateReport(await extractStructured(env, {
    tool: REPORT_TOOL,
    system: [
      'あなたは現場の日報の補助として、話した内容（音声を文字にしたもの。言い間違い・「えー」・言い直しを含む）から、日報の項目を取り出します。',
      '項目を取り出すだけで、日報の文は書きません。',
      UNTRUSTED_NOTE,
      '決まりごと：',
      '- 話に出てこない項目を、推測で埋めない。空文字・空の配列・null のままにして、questions に聞き返す質問を入れる。',
      '- 作業内容は、話した言葉のまま短い項目に分ける。数字（人数・時刻）は話したとおり。「3人」「朝8時から夕方5時」→ people=3, start=08:00, end=17:00。',
      '- 危ない所・ヒヤリとしたこと・けが・体調の急変は hazards に。そのほかの気づきは notes に。',
      '- 個人の名前（利用者・お客さま）は、話した言葉のまま site などに入れてよいが、住所・電話番号は入れない。',
      `今日の日付は ${today} です（「今日」はこの日付。「昨日」「明日」は前後の日付）。`,
    ].join('\n'),
    userText: `今日の日付：${today}\n話した内容：\n${text}`,
    maxTokens: 1500,
  })));
  const { questions, ...fields } = v;
  // 必須の項目が空なら、AIが質問を出さなくても、決まった質問を出す。AIの質問は、必須以外のものだけ足す
  const missing = missingFields(fields);
  const required = new Set(REQUIRED.map((r) => r.field));
  const extra = questions.filter((q) => !required.has(q.field) || q.field === 'other').slice(0, 3);
  return { fields, missing: missing.map((m) => ({ field: m.field, label: m.label, question: m.question })), extraQuestions: extra, safety: isSafety(fields, text) };
}
