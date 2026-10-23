// 月次レポートのコメント（AIは数字を書かない）。集計した数字・顧客名・商品名の「事実の一覧」だけを受け取る（売上の明細は届かない）。
import { extractStructured } from '../ai.js';
import { MONTHLY_TOOL, validateMonthlyComment } from '../schemas.js';
import { HttpError, withRetry, UNTRUSTED_NOTE } from '../http.js';
import { renderComment } from '../../public/js/monthly-comment.js';

const MAX_FACTS = 30;

function cleanFacts(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, '事実の一覧がありません');
  if (raw.length > MAX_FACTS) throw new HttpError(400, `事実は${MAX_FACTS}個までです`);
  const ids = new Set();
  return raw.map((f) => {
    const id = typeof f?.id === 'string' && /^f\d{1,2}$/.test(f.id) ? f.id : null;
    if (!id || ids.has(id) || typeof f.label !== 'string' || typeof f.value !== 'string') throw new HttpError(400, '事実の形が正しくありません');
    ids.add(id);
    return { id, label: f.label.replace(/[\r\n]/g, ' ').slice(0, 40), value: f.value.replace(/[\r\n]/g, ' ').slice(0, 80) };
  });
}

export async function monthlyComment(env, body) {
  const facts = cleanFacts(body?.facts);
  const v = await withRetry(async () => validateMonthlyComment(await extractStructured(env, {
    tool: MONTHLY_TOOL,
    system: [
      'あなたは経営者向けの月次レポートに添える、3行のコメントを書きます。',
      UNTRUSTED_NOTE,
      '決まりごと：',
      '- 下の「事実の一覧」だけを使う。一覧に無いことは書かない。',
      '- **数字（アラビア数字・全角数字）を1文字も書かない。** 数字・金額・％・名前は、{f3} のように事実の番号で指す（プログラムが値を埋める）。「3つ」「2社」のような数も書かない。',
      '- 原因を言い切らない。「〜の可能性があります」「〜かもしれません」まで。「〜が原因です」「〜のためです」と書かない。',
      '- 効果や将来の数字を約束しない。3行とも、1行80文字以内の、やさしい日本語で。',
      '- 1行目は全体の様子、2行目は顧客や商品の偏り、3行目は確かめたほうがよい点。',
    ].join('\n'),
    userText: `事実の一覧：\n${facts.map((f) => `${f.id}：${f.label}＝${f.value}`).join('\n')}`,
    maxTokens: 700,
  })));
  const { lines, dropped } = renderComment(v.lines, facts);
  return { lines, dropped };
}
