// LINE で答える：署名の確認・イベントの読み取り・返信の組み立て（外に出さない純粋な関数）。
// 返すのは応答メッセージ（reply）だけ。プッシュは使わない。応答トークンは1回だけ・受け取ってから約1分以内に使う。

export const TEXT_MAX = 5000; // 1つのテキストメッセージの上限（LINE の仕様）
export const MAX_MESSAGES = 5; // 1回の返信に入れられるメッセージ数（LINE の仕様）
export const QUESTION_MAX = 300;
export const LINE_PER_DAY = 20;
export const LINE_ALL_PER_DAY = 1000; // アカウント全体の1日の上限（費用の歯止め）
export const SWITCH_PER_DAY = 100; // 切り替えの連打で KV の書き込みを使い切らせない
export const STALE_MS = 10 * 60 * 1000; // これより古い通知（再生）は捨てる

export const MODES = {
  inn: { label: '宿のデモ', text: '宿のデモ' },
  site: { label: 'ソエギの案内', text: 'ソエギの案内' },
};

const enc = new TextEncoder();
const toBytes = (x) => (typeof x === 'string' ? enc.encode(x) : new Uint8Array(x));
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

/**
 * 署名の確認：受け取った本文を加工せずに、チャネルシークレットで HMAC-SHA256 → base64 にして、x-line-signature と比べる（定数時間）。
 * @param rawBody 受け取ったままの本文（バイト列。文字列でも可）
 */
export async function verifyLineSignature(secret, rawBody, signature) {
  if (!secret || typeof signature !== 'string' || !signature) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = b64(await crypto.subtle.sign('HMAC', key, toBytes(rawBody)));
  const a = enc.encode(expected); const b = enc.encode(signature);
  // 長さが違っても、同じだけ比べる（早く終わらない）
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** 受け取ったイベントを、処理する形にする。グループ・ルームでは答えない。文字以外は「文字でどうぞ」 */
export function readEvents(body) {
  const out = [];
  for (const e of Array.isArray(body?.events) ? body.events : []) {
    if (!e || typeof e !== 'object' || typeof e.replyToken !== 'string' || !e.replyToken) continue;
    if (e.source?.type !== 'user' || typeof e.source.userId !== 'string') continue; // グループ・ルームでは答えない
    // 古すぎる通知は捨てる（盗まれた本文の再生を防ぐ）。時刻が無ければ見ない
    if (Number.isFinite(e.timestamp) && Math.abs(Date.now() - e.timestamp) > STALE_MS) continue;
    const id = typeof e.webhookEventId === 'string' ? e.webhookEventId.slice(0, 64) : '';
    if (e.type === 'follow') out.push({ kind: 'follow', replyToken: e.replyToken, userId: e.source.userId, eventId: id });
    else if (e.type === 'message' && e.message?.type === 'text' && typeof e.message.text === 'string') {
      out.push({ kind: 'text', replyToken: e.replyToken, userId: e.source.userId, text: e.message.text, eventId: id });
    } else if (e.type === 'message') out.push({ kind: 'other', replyToken: e.replyToken, userId: e.source.userId, eventId: id });
  }
  return out;
}

/** 「宿のデモ」「ソエギの案内」などの切り替えの言葉。それ以外は質問 */
export function parseCommand(text) {
  const t = String(text ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  if (/^(宿のデモ|宿|ゆきあかり荘?)$/.test(t)) return { type: 'mode', mode: 'inn' };
  if (/^(ソエギの案内|ソエギ|会社の案内|会社)$/.test(t)) return { type: 'mode', mode: 'site' };
  if (/^(ヘルプ|help|使い方|はじめ|メニュー)$/.test(t)) return { type: 'help' };
  return null;
}

/** モードの札（クイックリプライ。ラベルは20文字まで） */
export const modeQuickReply = () => ({
  items: Object.values(MODES).map((m) => ({ type: 'action', action: { type: 'message', label: m.label, text: m.text } })),
});

/** 最後のメッセージに、モードの札を付ける */
export function withQuickReply(messages) {
  const out = messages.slice(0, MAX_MESSAGES).map((m) => ({ ...m }));
  if (out.length) out[out.length - 1].quickReply = modeQuickReply();
  return out;
}

/** 5,000文字まで。文字の途中（絵文字など）では切らない */
export const textMessage = (text) => {
  const chars = Array.from(String(text));
  return { type: 'text', text: chars.length > TEXT_MAX ? `${chars.slice(0, TEXT_MAX - 1).join('')}…` : chars.join('') };
};

/** AIの答えの中の URL は、ソエギのサイトのもの以外は出さない（LINE では URL が自動でリンクになる） */
export const stripUrls = (t) => String(t).replace(/https?:\/\/[^\s\u3000）)」』、。]+/g, (u) => (/^https:\/\/(www\.)?withsoegi\.jp(\/|$)/.test(u) ? u : '（リンクは省略）'));

/** 最初のあいさつ（友だち追加）。何を送り、何を覚えるかを、先に正直に言う */
export function greeting(aiName) {
  return [
    textMessage([
      'ソエギのデモです。',
      `・入力した文章は保存しません。答えは外部のAI（${aiName}）が作ります。`,
      '・名前や電話番号は送らないでください。',
      '・「宿のデモ」か「ソエギの案内」かの選択だけ、24時間だけ覚えます（利用者IDは、そのまま残さずハッシュにします）。',
      '',
      '下の札で、試したいほうを選んでください。',
    ].join('\n')),
  ];
}

/** サイトのチャットボットの答え → LINE の文。「#」だけのリンクは出さない（LINE では開けない） */
export function siteAnswerMessages(a) {
  const links = (a.links ?? []).filter((l) => /^https?:\/\//.test(l.href));
  const consult = a.consult && /^https?:\/\//.test(a.consult.href) ? a.consult : null;
  const lines = [stripUrls(a.answer)];
  if (links.length) lines.push('', ...links.map((l) => `▶ ${l.label}\n${l.href}`));
  else if (consult && !a.found) lines.push('', `▶ ${consult.label}\n${consult.href}`);
  return [textMessage(lines.join('\n'))];
}

/** 宿の返信の下書き → LINE の文。「下書き」であること・確かめる点を、同じ文の中に必ず付ける */
export function innDraftMessages(r) {
  // 「下書き」の印は先頭（長い返信でも切れない）
  const lines = ['【デモ】これは、宿のスタッフが確認してから送る「下書き」です。', '', stripUrls(r.reply)];
  if (r.needsCheck?.length) lines.push('確かめる点：', ...r.needsCheck.slice(0, 4).map((n) => `・${n.point}`));
  if (r.warnings?.length) lines.push(...r.warnings.slice(0, 2).map((w) => `※${w}`));
  return [textMessage(lines.join('\n'))];
}

export const NOTICE = {
  other: '文字でお送りください。（スタンプ・写真・音声には答えられません）',
  tooLong: `質問は${QUESTION_MAX}文字までにしてください。`,
  limit: `本日の質問は${LINE_PER_DAY}回までです。続きはお電話かメールでお問い合わせください。`,
  failed: 'うまく答えられませんでした。少し時間をおいて、もう一度お試しください。',
  modeSet: { inn: 'モードを「宿のデモ」にしました。宿への問い合わせを、そのまま送ってください（例：送迎はありますか？）。答えは宿のスタッフが確認する前の「下書き」です。', site: 'モードを「ソエギの案内」にしました。ソエギについて聞いてみてください（例：料金はいくら？）。' },
};
