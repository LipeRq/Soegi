// 経理（レシート）と労務（タイムカード写真）の読み取り。計算・判定は画面側のプログラムで行う。
import { extractStructured } from '../ai.js';
import { RECEIPT_TOOL, TIMECARD_TOOL, ACCOUNTS, validateReceipt, validateTimecard } from '../schemas.js';
import { HttpError, withRetry, UNTRUSTED_NOTE, jstToday } from '../http.js';

function imageOf(body) {
  const image = typeof body?.image === 'string' ? body.image.replace(/^data:image\/jpeg;base64,/, '') : '';
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) throw new HttpError(400, '画像（JPEG）が必要です');
  return image;
}

export async function receipt(env, body) {
  const image = imageOf(body);
  return withRetry(async () => validateReceipt(await extractStructured(env, {
    tool: RECEIPT_TOOL,
    system: [
      'あなたは経理事務の補助として、レシート・領収書の画像から項目を読み取ります。',
      '読み取りと下書きだけを行います。最終的な判断は人が行います。',
      UNTRUSTED_NOTE,
      '決まりごと：',
      '- 書かれていない項目を推測で埋めない。読めない項目は空文字または null にする。',
      '- 金額は税込の円（整数）。和暦の日付は西暦に直す。',
      '- 10%対象・8%対象の金額と消費税額は、レシートに書かれている場合だけ入れる。',
      `- 勘定科目は次の中から1つだけ選ぶ：${ACCOUNTS.join('／')}。理由は1行で。`,
      '- 各項目の確かさを 高・中・低 で答える。手書きや不鮮明で自信がないものは 低。',
      '- レシート・領収書として読めない画像は is_receipt を false にする。',
      `今日の日付は ${jstToday()} です（年が書かれていない日付の補完にだけ使う）。`,
    ].join('\n'),
    userText: 'このレシートを読み取って submit_receipt で提出してください。',
    imageBase64: image,
  })));
}

export async function timecard(env, body) {
  const image = imageOf(body);
  const period = typeof body?.period === 'string' && /^\d{4}-\d{2}$/.test(body.period) ? body.period : '';
  const v = await withRetry(async () => validateTimecard(await extractStructured(env, {
    tool: TIMECARD_TOOL,
    system: [
      'あなたは労務事務の補助として、タイムカード・手書きの出勤簿の画像から出退勤の記録を読み取ります。',
      '読み取りだけを行います。残業時間などの計算は別のプログラムが行うので、計算しないでください。',
      UNTRUSTED_NOTE,
      '決まりごと：',
      '- 時刻は 24時間表記の HH:MM。書かれていない・読めない時刻は空文字にする。',
      '- 休みの日（記録のない日）は entries に含めない。',
      '- 休憩の時間が書かれていなければ break_min は null にする（推測しない）。',
      period ? `- 対象は ${period} です。日付は ${period}-DD の形で答える。` : '- 年月が分かれば YYYY-MM-DD、分からなければ日だけを答える。',
    ].join('\n'),
    userText: 'この出勤簿を読み取って submit_timecard で提出してください。',
    imageBase64: image,
  })));
  // 日だけ返ってきた場合は、指定された年月で補う
  v.entries = v.entries.map((e) => (period && /^\d{1,2}$/.test(e.date) ? { ...e, date: `${period}-${e.date.padStart(2, '0')}` } : e));
  return v;
}
