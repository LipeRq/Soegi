// AIに返させるJSONの形（ツール呼び出しのJSON Schema）と、Worker側の検証。
// 検証に通らなければ呼び出し側（worker.js）が1回だけ再試行する。

export const ACCOUNTS = [
  '消耗品費', '事務用品費', '旅費交通費', '車両費（燃料）', '通信費',
  '会議費', '接待交際費', '福利厚生費', '新聞図書費', '雑費',
];
const LEVELS = ['高', '中', '低'];

const nullableInt = { type: ['integer', 'null'] };
const level = { type: 'string', enum: LEVELS };

export const RECEIPT_TOOL = {
  name: 'submit_receipt',
  description: '画像のレシート・領収書から読み取った内容を提出する',
  schema: {
    type: 'object',
    properties: {
      is_receipt: { type: 'boolean', description: 'レシート・領収書として読めるか' },
      date: { type: 'string', description: 'YYYY-MM-DD。和暦は西暦に直す。読めなければ空文字' },
      payee: { type: 'string', description: '支払先（店名・会社名）。読めなければ空文字' },
      total: { ...nullableInt, description: '税込の合計金額（円）' },
      amount_10: { ...nullableInt, description: '10%対象の金額（税込）。書かれていなければ null' },
      amount_8: { ...nullableInt, description: '8%（軽減税率）対象の金額（税込）。書かれていなければ null' },
      tax_amount: { ...nullableInt, description: '消費税額の合計。書かれていなければ null' },
      invoice_no: { type: 'string', description: 'インボイス登録番号（T＋13桁）。無ければ空文字' },
      payment_method: { type: 'string', description: '現金／クレジット／電子マネー など。読めなければ空文字' },
      summary: { type: 'string', description: '品目の要約（30字以内）。読めなければ空文字' },
      account: { type: 'string', enum: ACCOUNTS, description: '勘定科目の候補' },
      account_reason: { type: 'string', description: '科目の候補にした理由（1行）' },
      confidence: {
        type: 'object',
        description: '項目ごとの読み取りの確かさ',
        properties: {
          date: level, payee: level, total: level, tax: level, invoice_no: level, account: level,
        },
        required: ['date', 'payee', 'total', 'tax', 'invoice_no', 'account'],
      },
    },
    required: [
      'is_receipt', 'date', 'payee', 'total', 'amount_10', 'amount_8', 'tax_amount',
      'invoice_no', 'payment_method', 'summary', 'account', 'account_reason', 'confidence',
    ],
  },
};

export const TIMECARD_TOOL = {
  name: 'submit_timecard',
  description: '画像のタイムカード・出勤簿から読み取った内容を提出する',
  schema: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: '氏名。読めなければ空文字' },
      entries: {
        type: 'array',
        description: '出勤した日ごとの記録（休みの日は含めない）',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'YYYY-MM-DD。年月が不明なら日だけを DD で' },
            start: { type: 'string', description: '出勤時刻 HH:MM（24時間表記）' },
            end: { type: 'string', description: '退勤時刻 HH:MM（24時間表記）' },
            break_min: { ...nullableInt, description: '休憩の分。書かれていなければ null' },
          },
          required: ['date', 'start', 'end', 'break_min'],
        },
      },
    },
    required: ['employee_name', 'entries'],
  },
};

// ---- 検証（崩れていたら throw） -------------------------------------------

const fail = (msg) => { throw new Error(`schema: ${msg}`); };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const toStr = (v) => (v == null ? '' : String(v).normalize('NFKC').trim());

function toIntOrNull(v, key) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) fail(key);
    return Math.round(v);
  }
  if (typeof v === 'string') {
    const n = Number(v.normalize('NFKC').replace(/[,，円¥￥\s]/g, ''));
    if (!Number.isFinite(n)) fail(key);
    return Math.round(n);
  }
  return fail(key);
}

function toDate(v) {
  const s = toStr(v).replace(/[/.]/g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toTime(v) {
  const s = toStr(v);
  const m = s.match(/^(\d{1,2})[:：時](\d{2})/);
  if (!m) return '';
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 47 || mi > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function validateReceipt(raw) {
  if (!isObj(raw)) fail('object');
  if (typeof raw.is_receipt !== 'boolean') fail('is_receipt');
  if (!isObj(raw.confidence)) fail('confidence');
  const conf = {};
  for (const k of ['date', 'payee', 'total', 'tax', 'invoice_no', 'account']) {
    const c = toStr(raw.confidence[k]);
    conf[k] = LEVELS.includes(c) ? c : '低';
  }
  const account = toStr(raw.account);
  const inv = toStr(raw.invoice_no).toUpperCase().replace(/[-\s]/g, '');
  return {
    is_receipt: raw.is_receipt,
    date: toDate(raw.date),
    payee: toStr(raw.payee),
    total: toIntOrNull(raw.total, 'total'),
    amount_10: toIntOrNull(raw.amount_10, 'amount_10'),
    amount_8: toIntOrNull(raw.amount_8, 'amount_8'),
    tax_amount: toIntOrNull(raw.tax_amount, 'tax_amount'),
    invoice_no: inv,
    payment_method: toStr(raw.payment_method),
    summary: toStr(raw.summary).slice(0, 60),
    account: ACCOUNTS.includes(account) ? account : '',
    account_reason: toStr(raw.account_reason).slice(0, 120),
    confidence: ACCOUNTS.includes(account) ? conf : { ...conf, account: '低' },
  };
}

export function validateTimecard(raw) {
  if (!isObj(raw)) fail('object');
  if (!Array.isArray(raw.entries)) fail('entries');
  if (raw.entries.length > 62) fail('entries length');
  const entries = raw.entries.map((e) => {
    if (!isObj(e)) fail('entry');
    return {
      date: toDate(e.date) || toStr(e.date).slice(0, 10),
      start: toTime(e.start),
      end: toTime(e.end),
      break_min: toIntOrNull(e.break_min, 'break_min'),
    };
  });
  return { employee_name: toStr(raw.employee_name).slice(0, 40), entries };
}
