// 無料相談のお申し込み（withsoegi.jp のフォームから）。入力はメールで届けるだけで、サーバーには保存しない。
// 送り先は秘密の設定（INQUIRY_TO）。メールの送信は Cloudflare の send_email（Email Routing で確認済みの宛先だけ送れる）。
import { HttpError } from '../http.js';
import { allowPerDay } from '../guard.js';

export const INQUIRY_PER_DAY = 5;
export const PHONE = '080-9018-2777';
const TIMES = { am: '午前（9〜12時）', noon: '昼（12〜15時）', pm: '夕方（15〜19時）', any: 'いつでも' };
const METHODS = { online: 'オンライン', visit: 'お伺い（山形県内）', phone: 'お電話' };
const MAX_SLOTS = 3;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/[\r\n\t]+/g, ' ');
const jstDate = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);

/** 入力を検証して、メールの本文に使う形にする。おかしければ HttpError(400)。迷惑メール用の隠し欄が入っていたら、送ったことにして捨てる（null） */
export function validateInquiry(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, '入力の形が正しくありません');
  if (clean(body.website, 100)) return null; // 人間には見えない欄。入っていたらロボット
  const name = oneLine(body.name, 40);
  if (!name) throw new HttpError(400, 'お名前を入力してください');
  const company = oneLine(body.company, 60);
  const phone = oneLine(body.phone, 30);
  const email = oneLine(body.email, 100);
  if (!phone && !email) throw new HttpError(400, '電話番号かメールアドレスのどちらかを入力してください');
  if (phone && !/^[0-9０-９+\-－ー()（）\s]{8,20}$/.test(phone)) throw new HttpError(400, '電話番号の形が正しくありません');
  if (email && !/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(email)) throw new HttpError(400, 'メールアドレスの形が正しくありません');
  const method = Object.hasOwn(METHODS, body.method) ? body.method : 'online';
  const today = jstDate(0); const last = jstDate(45);
  const slots = (Array.isArray(body.slots) ? body.slots : []).slice(0, MAX_SLOTS).map((s) => {
    const date = String(s?.date ?? '');
    if (!date) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, '希望の日付の形が正しくありません');
    if (date <= today || date > last) throw new HttpError(400, '希望の日付は、明日から45日以内で選んでください');
    const time = Object.hasOwn(TIMES, s?.time) ? s.time : 'any';
    return { date, time };
  }).filter(Boolean);
  const note = clean(body.note, 600);
  if (body.agree !== true) throw new HttpError(400, '「個人情報の使いみち」への同意にチェックを入れてください');
  return { name, company, phone, email, method, slots, note };
}

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const slotText = (s) => {
  const d = new Date(`${s.date}T00:00:00+09:00`);
  return `${s.date.replace(/-/g, '/')}（${WEEK[new Date(d.getTime() + 9 * 3600_000).getUTCDay()]}） ${TIMES[s.time]}`;
};

export function inquiryBody(d) {
  return [
    '【無料相談のお申し込み】withsoegi.jp のフォームから届きました。',
    '',
    `お名前：${d.name}`,
    `会社名：${d.company || '（未入力）'}`,
    `電話：${d.phone || '（未入力）'}`,
    `メール：${d.email || '（未入力）'}`,
    `ご希望の方法：${METHODS[d.method]}`,
    '',
    'ご希望の日時：',
    ...(d.slots.length ? d.slots.map((s, i) => `  第${i + 1}希望　${slotText(s)}`) : ['  （未入力。こちらからご連絡して決めます）']),
    '',
    '困っていること・ご相談の内容：',
    d.note || '（未入力）',
    '',
    '— このメールは、フォームの入力を転送したものです。サーバーには保存していません。',
  ].join('\n');
}

const b64 = (s) => { const bytes = new TextEncoder().encode(s); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); };
const wrap = (s) => s.match(/.{1,76}/g)?.join('\r\n') ?? '';
const encWord = (s) => `=?UTF-8?B?${b64(s)}?=`;

/** メール1通分の生の文面（UTF-8・base64）。ヘッダーに入れる値は、検証済みのものだけ */
export function rawMail({ from, to, replyTo, subject, text }) {
  const id = `<${crypto.randomUUID()}@${from.split('@')[1]}>`;
  return [
    `From: ${encWord('ソエギ お問い合わせフォーム')} <${from}>`,
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encWord(subject)}`,
    `Message-ID: ${id}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
    '',
  ].join('\r\n');
}

export async function inquiry(env, body, ip) {
  const d = validateInquiry(body);
  if (d === null) return { sent: true }; // ロボットには、成功したように見せる
  if (!env.MAIL || !env.INQUIRY_TO) throw new HttpError(503, `お申し込みの受付は準備中です。お手数ですが、お電話（${PHONE}）でご連絡ください`);
  const day = await allowPerDay(env, 'inquiry', ip, INQUIRY_PER_DAY);
  if (!day.ok) throw new HttpError(429, `本日の受付の上限に達しました。お電話（${PHONE}）でご連絡ください`);
  const from = env.INQUIRY_FROM || 'inquiry@withsoegi.jp';
  const tos = String(env.INQUIRY_TO).split(',').map((x) => x.trim()).filter((x) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(x));
  if (!tos.length) throw new HttpError(503, `お申し込みの受付は準備中です。お手数ですが、お電話（${PHONE}）でご連絡ください`);
  const subject = `【無料相談】${d.name}${d.company ? `（${d.company}）` : ''}さんからお申し込み`;
  const text = inquiryBody(d);
  const EmailMessage = env.__EmailMessage ?? (await import('cloudflare:email')).EmailMessage;
  // 送り先ごとに1通。どれか1つでも届けば成功（本文はログに出さない）
  const results = await Promise.allSettled(tos.map((to) => env.MAIL.send(new EmailMessage(from, to, rawMail({ from, to, replyTo: d.email || '', subject, text })))));
  if (!results.some((r) => r.status === 'fulfilled')) throw new HttpError(502, `送信できませんでした。お手数ですが、お電話（${PHONE}）でご連絡ください`);
  return { sent: true };
}
