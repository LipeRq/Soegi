// 経理（レシート）・労務（タイムカード写真）・受注（注文書）の読み取り。計算・判定・照合は画面側のプログラムで行う。
import { extractStructured } from '../ai.js';
import { RECEIPT_TOOL, TIMECARD_TOOL, ORDER_TOOL, ACCOUNTS, validateReceipt, validateTimecard, validateOrder } from '../schemas.js';
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

// ---- 受注：FAX・紙の注文書 → 受注データ（照合・検算は画面側の order-check.js） ----------------

export async function order(env, body) {
  const image = imageOf(body);
  return withRetry(async () => validateOrder(await extractStructured(env, {
    tool: ORDER_TOOL,
    system: [
      'あなたは受注係の補助として、取引先から届いた注文書（FAX・紙・写真）を読み取ります。取引先ごとに様式が違います。',
      '読み取りだけを行います。商品マスタとの照合・数量の検算・単価の確認は、別のプログラムが行います。',
      UNTRUSTED_NOTE,
      '決まりごと：',
      '- 書いてあるとおりに写す。品名を商品マスタの名前に直したり、推測で補ったりしない。読めない所は空文字または null。',
      '- 明細は書いてある順に、1商品1つ。合計の行・空の行は入れない。',
      '- 数量は書いてあるとおりの数（小数も丸めない）。単価・金額は半角の整数。単位（個・袋・箱・ケース など）は数量と分けて unit に入れる。',
      '- 品名が読めない明細も、数量・単価・金額などが読めれば1行として入れる（name は空文字）。',
      '- 日付は書いてあるとおり（年が無ければ「1/14」のように月日だけ）。和暦は西暦に直してよい。',
      '- 手書き・にじみ・訂正で自信がないものは、確かさを 低 にする。',
      '- 注文書として読めない画像は is_order を false にする。',
      `今日の日付は ${jstToday()} です。`,
    ].join('\n'),
    userText: 'この注文書を読み取って submit_order で提出してください。',
    imageBase64: image,
    maxTokens: 4000, // 明細が多い注文書（最大60行）でも途中で切れないように
    // モックだけが使う見本の名前（本物のAIには送らない）
    sample: typeof body?.sample === 'string' ? body.sample.slice(0, 40) : '',
  })));
}
