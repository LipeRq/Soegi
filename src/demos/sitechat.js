// デモC：サイトのチャットボット。サイトに書いてある内容だけで答える。
// 同じIPから1日30回まで、1回300文字まで。会話の履歴は画面側が持ち、直近の数往復だけ送ってもらう（保存しない）。
import { extractStructured } from '../ai.js';
import { SITE_TOOL, validateSiteAnswer } from '../schemas.js';
import { HttpError, withRetry, UNTRUSTED_NOTE } from '../http.js';
import { buildSiteContext, finalizeSiteAnswer, innToSections } from '../core/sitebot.js';
import { allowPerDay } from '../guard.js';
import { pricingKnowledge } from '../../public/js/pricing.js';
import bot from '../../public/data/sitebot.json' with { type: 'json' };
import inn from '../../public/data/yukiakari.json' with { type: 'json' };

export const CHAT_MAX = 300;
export const CHAT_PER_DAY = 30;
const HISTORY_TURNS = 6;

/** 料金と宿の情報を差し込んだ、プロフィールごとの知識 */
export function loadProfiles() {
  const out = {};
  for (const [key, p] of Object.entries(bot.profiles)) {
    const sections = p.sections === '__INN__'
      ? innToSections(inn)
      : p.sections.map((s) => (s.text === '__PRICING__' ? { ...s, text: pricingKnowledge() } : s));
    out[key] = { ...p, key, sections };
  }
  return out;
}
const PROFILES = loadProfiles();

function systemFor(p) {
  return [
    `あなたは「${p.name}」のサイトの案内係です。サイトを見に来た方の質問に、下の「サイトの内容」だけを使って答えます。`,
    UNTRUSTED_NOTE,
    '決まりごと：',
    '- サイトの内容に書いてあることだけで答える。書いていないことは found を false にする（推測で答えない）。',
    '- 質問と同じ言語で、3〜5文で、丁寧に答える。金額・時間などの数字はサイトの内容のとおりに書く。',
    '- できないこと・お引き受けしないことは、はっきり「お引き受けしていません」と伝える。',
    '- 効果や結果を約束しない（「◯時間減ります」などと言わない）。',
    '- 相談・問い合わせに進むと役立つ質問なら suggest_consult を true にする。',
    '- 名前・電話番号・住所などの個人情報を聞き出さない。',
    `- link_ids には関係するページの id を、次の中から選ぶ：${Object.keys(p.links).join(', ')}`,
    '',
    '# サイトの内容',
    buildSiteContext(p),
  ].join('\n');
}

const cleanHistory = (h) => (Array.isArray(h) ? h : [])
  .filter((m) => m && (m.role === 'user' || m.role === 'bot') && typeof m.text === 'string')
  .slice(-HISTORY_TURNS)
  .map((m) => `${m.role === 'user' ? '訪問者' : '案内係'}：${m.text.slice(0, 600)}`);

export async function siteChat(env, body, ip) {
  const p = PROFILES[body?.profile] ?? PROFILES.soegi;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) throw new HttpError(400, '質問を入力してください');
  if (message.length > CHAT_MAX) throw new HttpError(400, `${CHAT_MAX}文字までにしてください`);
  const day = await allowPerDay(env, 'chat', ip, CHAT_PER_DAY);
  if (!day.ok) throw new HttpError(429, '本日の質問の上限に達しました。お電話かメールでお問い合わせください');
  const history = cleanHistory(body.history);
  const v = await withRetry(async () => validateSiteAnswer(await extractStructured(env, {
    tool: SITE_TOOL,
    system: systemFor(p),
    userText: `${history.length ? `これまでの会話：\n${history.join('\n')}\n\n` : ''}今回の質問：${message}`,
    maxTokens: 1200,
  })));
  return finalizeSiteAnswer(p, v);
}
