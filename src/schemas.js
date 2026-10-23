// AIに返させるJSONの形（ツール呼び出しのJSON Schema）と、Worker側の検証。
// 検証に通らなければ呼び出し側（worker.js）が1回だけ再試行する。

import { CATEGORIES } from './core/knowledge.js';

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
            start: { type: 'string', description: '出勤時刻 HH:MM（24時間表記）。読めなければ空文字' },
            end: { type: 'string', description: '退勤時刻 HH:MM（24時間表記）。読めなければ空文字' },
            out: { type: 'string', description: '外出の時刻 HH:MM。無ければ空文字' },
            back: { type: 'string', description: '戻りの時刻 HH:MM。無ければ空文字' },
            break_min: { ...nullableInt, description: '休憩の分（書かれていれば）。書かれていなければ null。外出・戻りから計算しない' },
            start_alt: { type: 'string', description: '出勤の欄に時刻が2つあるとき（二重打刻）の、もう1つの時刻。無ければ空文字' },
            end_alt: { type: 'string', description: '退勤の欄に時刻が2つあるとき（二重打刻）の、もう1つの時刻。無ければ空文字' },
            conf_start: { type: 'string', enum: ['高', '中', '低'], description: '出勤の読み取りの確かさ。手書きの修正・にじみ・二重打刻・読めないときは 低' },
            conf_end: { type: 'string', enum: ['高', '中', '低'], description: '退勤の読み取りの確かさ（決まりは出勤と同じ）' },
            conf_out: { type: 'string', enum: ['高', '中', '低'], description: '外出の確かさ（無ければ 高）' },
            conf_back: { type: 'string', enum: ['高', '中', '低'], description: '戻りの確かさ（無ければ 高）' },
            note: { type: 'string', description: '手書きの修正・二重打刻・にじみなど、その日の気づいたこと。無ければ空文字' },
          },
          required: ['date', 'start', 'end', 'out', 'back', 'break_min', 'start_alt', 'end_alt', 'conf_start', 'conf_end', 'conf_out', 'conf_back', 'note'],
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

/** 数（丸めない）。注文書の数量は、小数のままプログラムに渡して「数ではない」の赤にする */
function toNumOrNull(v, key) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.normalize('NFKC').replace(/[,，円¥￥\s]/g, '')) : NaN;
  if (!Number.isFinite(n)) fail(key);
  return n;
}

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
  // 科目は候補の一覧と照らす（全角かっこの「車両費（燃料）」が、文字をそろえたあとも一致するように）
  const account = ACCOUNTS.find((a) => a.normalize('NFKC') === toStr(raw.account).normalize('NFKC')) ?? '';
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
    account,
    account_reason: toStr(raw.account_reason).slice(0, 120),
    confidence: account ? conf : { ...conf, account: '低' },
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
      out: toTime(e.out),
      back: toTime(e.back),
      break_min: toIntOrNull(e.break_min, 'break_min'),
      start_alt: toTime(e.start_alt),
      end_alt: toTime(e.end_alt),
      // 確かさが無い・崩れているときは「低」（人に見てもらう側に倒す）
      conf: { start: lv(e.conf_start), end: lv(e.conf_end), out: e.out ? lv(e.conf_out) : '高', back: e.back ? lv(e.conf_back) : '高' },
      note: toStr(e.note).slice(0, 80),
    };
  });
  return { employee_name: toStr(raw.employee_name).slice(0, 40), entries };
}

// ---- 音声日報 ------------------------------------------------------------------------------

export const REPORT_TOOL = {
  name: 'submit_report',
  description: '話した内容から取り出した、日報の項目を提出する',
  schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD。「今日」は今日の日付に直す。話に無ければ空文字' },
      site: { type: 'string', description: '現場名・訪問先（例：田中邸、山本さん宅）。話に無ければ空文字' },
      work: { type: 'array', items: { type: 'string' }, description: '作業内容を、短い項目に分けたもの（話した言葉のまま）。話に無ければ空の配列' },
      people: { type: ['integer', 'null'], description: '作業した人数。話に無ければ null' },
      start: { type: 'string', description: '開始時刻 HH:MM（24時間）。話に無ければ空文字' },
      end: { type: 'string', description: '終了時刻 HH:MM（24時間）。話に無ければ空文字' },
      hours: { type: ['number', 'null'], description: '開始・終了が無く、作業した時間だけ話したときの時間数。話に無ければ null' },
      hazards: { type: 'string', description: '危ない所・ヒヤリとしたこと・けがなど。話に無ければ空文字' },
      notes: { type: 'string', description: 'そのほかの気づき（資材・天気・お客さまの様子など）。話に無ければ空文字' },
      tomorrow: { type: 'string', description: '明日の予定。話に無ければ空文字' },
      questions: {
        type: 'array',
        description: '話に無く、聞き返すべきこと（項目ごとに1つ）',
        items: { type: 'object', properties: { field: { type: 'string', enum: ['date', 'site', 'work', 'people', 'hours', 'tomorrow', 'hazards', 'other'] }, question: { type: 'string' } }, required: ['field', 'question'] },
      },
    },
    required: ['date', 'site', 'work', 'people', 'start', 'end', 'hours', 'hazards', 'notes', 'tomorrow', 'questions'],
  },
};

/** 日報の時刻は、その日の 0:00〜23:59（24時以降は読み取れなかったことにする） */
const dayTime = (v) => { const t = toTime(v); return t && Number(t.slice(0, 2)) < 24 ? t : ''; };

export function validateReport(raw) {
  if (!isObj(raw)) fail('object');
  const hours = raw.hours == null || raw.hours === '' ? null : Number(raw.hours);
  const people = raw.people == null || raw.people === '' ? null : Number(raw.people);
  return {
    date: toDate(raw.date),
    site: toStr(raw.site).slice(0, 80),
    work: arr(raw.work ?? [], 'work', 12).map((w) => toStr(w).slice(0, 120)).filter(Boolean),
    people: Number.isInteger(people) && people > 0 && people < 1000 ? people : null,
    start: dayTime(raw.start),
    end: dayTime(raw.end),
    hours: Number.isFinite(hours) && hours > 0 && hours <= 24 ? Math.round(hours * 10) / 10 : null,
    hazards: toStr(raw.hazards).slice(0, 300),
    notes: toStr(raw.notes).slice(0, 300),
    tomorrow: toStr(raw.tomorrow).slice(0, 200),
    questions: arr(raw.questions ?? [], 'questions', 10).filter(isObj).map((q) => ({ field: toStr(q.field).slice(0, 20), question: toStr(q.question).slice(0, 120) })).filter((q) => q.question),
  };
}

// ---- 月次レポートのコメント ------------------------------------------------------------------

export const MONTHLY_TOOL = {
  name: 'submit_monthly_comment',
  description: '月次レポートの3行のコメントを提出する。数字・名前は {f3} のような事実の番号で指す',
  schema: {
    type: 'object',
    properties: { lines: { type: 'array', items: { type: 'string' }, description: '3行。各行は80文字以内。数字（アラビア数字・全角数字）は書かず、{f番号} で指す' } },
    required: ['lines'],
  },
};

export function validateMonthlyComment(raw) {
  if (!isObj(raw)) fail('object');
  return { lines: arr(raw.lines, 'lines', 5).map((l) => (typeof l === 'string' ? l.slice(0, 300) : '')) };
}

// ---- デモA：社内ナレッジ検索 --------------------------------------------------------


export const KNOWLEDGE_TOOL = {
  name: 'submit_answer',
  description: '社内資料にもとづく答えを提出する',
  schema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: '質問の言語（ISO 639-1。例：ja, vi, id, en）' },
      question_ja: { type: 'string', description: '質問の日本語訳（日本語の質問ならそのまま）' },
      found: { type: 'boolean', description: '資料の中に答えがあれば true' },
      answer: { type: 'string', description: '質問と同じ言語の答え。資料に書いてあることだけ。手順は番号付き' },
      answer_ja: { type: 'string', description: '答えの日本語（ふつうの日本語）' },
      easy_japanese: { type: 'string', description: 'やさしい日本語の答え（短い文、むずかしい言葉は言いかえる。日本語の質問なら空文字）' },
      citations: {
        type: 'array',
        description: '根拠にした箇所。quote は資料の文をそのまま写す',
        items: {
          type: 'object',
          properties: {
            doc_id: { type: 'string' }, section_id: { type: 'string' },
            quote: { type: 'string', description: '資料からそのまま写した1〜2文' },
          },
          required: ['doc_id', 'section_id', 'quote'],
        },
      },
      safety_related: { type: 'boolean', description: '安全・衛生・けが・体調に関わる質問なら true' },
      category: { type: 'string', enum: CATEGORIES },
    },
    required: ['language', 'question_ja', 'found', 'answer', 'answer_ja', 'easy_japanese', 'citations', 'safety_related', 'category'],
  },
};

const str = (v, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : v == null ? '' : fail('string'));
const bool = (v, key) => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fail(key));
const arr = (v, key, max = 20) => (Array.isArray(v) ? v.slice(0, max) : v == null ? [] : fail(key));

export function validateKnowledge(raw) {
  if (!isObj(raw)) fail('object');
  return {
    language: str(raw.language, 20) || 'ja',
    question_ja: str(raw.question_ja, 600),
    found: bool(raw.found, 'found'),
    answer: str(raw.answer),
    answer_ja: str(raw.answer_ja),
    easy_japanese: str(raw.easy_japanese),
    citations: arr(raw.citations, 'citations', 6).map((c) => {
      if (!isObj(c)) fail('citation');
      return { doc_id: str(c.doc_id, 60), section_id: str(c.section_id, 60), quote: str(c.quote, 400) };
    }),
    safety_related: bool(raw.safety_related ?? false, 'safety_related'),
    category: str(raw.category, 20),
  };
}

// ---- デモB：宿の多言語対応 ----------------------------------------------------------

export const INN_REPLY_TOOL = {
  name: 'submit_inn_reply',
  description: '宿への問い合わせに対する、返信の下書きを提出する',
  schema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: '問い合わせの言語（例：zh-TW, en, ko, ja）' },
      inquiry_ja: { type: 'string', description: '問い合わせの日本語訳（スタッフ用）' },
      reply: { type: 'string', description: '問い合わせと同じ言語の、丁寧な返信の下書き' },
      reply_ja: { type: 'string', description: '返信の下書きの日本語訳（スタッフが中身を確かめるため）' },
      needs_check: {
        type: 'array',
        description: '送る前にスタッフが確かめる点（宿の情報に無いこと、決められないこと）',
        items: { type: 'object', properties: { point: { type: 'string' }, reason: { type: 'string' } }, required: ['point', 'reason'] },
      },
      used_info_ids: { type: 'array', items: { type: 'string' }, description: '返信に使った宿の情報の id' },
    },
    required: ['language', 'inquiry_ja', 'reply', 'reply_ja', 'needs_check', 'used_info_ids'],
  },
};

export function validateInnReply(raw) {
  if (!isObj(raw)) fail('object');
  const reply = str(raw.reply); const replyJa = str(raw.reply_ja);
  if (!reply || !replyJa) fail('reply');
  return {
    language: str(raw.language, 20),
    inquiry_ja: str(raw.inquiry_ja, 1500),
    reply, reply_ja: replyJa,
    needs_check: arr(raw.needs_check, 'needs_check', 10).map((n) => {
      if (!isObj(n)) fail('needs_check');
      return { point: str(n.point, 120), reason: str(n.reason, 200) };
    }).filter((n) => n.point),
    used_info_ids: arr(raw.used_info_ids, 'used_info_ids', 30).map((x) => str(x, 40)),
  };
}

// ---- 口コミ返信（宿） --------------------------------------------------------------------

export const POINT_KINDS = ['praise', 'complaint', 'request'];

export const INN_REVIEW_TOOL = {
  name: 'submit_inn_review',
  description: '宿への口コミに対する、返信の下書きを提出する',
  schema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: '口コミの言語（例：zh-TW, en, ko, ja）' },
      review_ja: { type: 'string', description: '口コミの日本語訳（スタッフ用）' },
      reply: { type: 'string', description: '口コミと同じ言語の、丁寧な返信の下書き。反論・言い訳をしない。お客さまの名前・スタッフの名前を書かない' },
      reply_ja: { type: 'string', description: '返信の下書きの日本語訳（スタッフが中身を確かめるため）' },
      points: {
        type: 'array',
        description: '口コミの指摘の一覧',
        items: {
          type: 'object',
          properties: { kind: { type: 'string', enum: POINT_KINDS, description: 'praise＝ほめ、complaint＝不満、request＝要望' }, text: { type: 'string', description: '日本語で1行' } },
          required: ['kind', 'text'],
        },
      },
      needs_check: {
        type: 'array',
        description: '送る前にスタッフが確かめる点（事実の確認が要ること、宿だけで決められないこと）',
        items: { type: 'object', properties: { point: { type: 'string' }, reason: { type: 'string' } }, required: ['point', 'reason'] },
      },
      used_info_ids: { type: 'array', items: { type: 'string' }, description: '返信に使った宿の情報の id' },
    },
    required: ['language', 'review_ja', 'reply', 'reply_ja', 'points', 'needs_check', 'used_info_ids'],
  },
};

export function validateInnReview(raw) {
  if (!isObj(raw)) fail('object');
  const reply = str(raw.reply); const replyJa = str(raw.reply_ja);
  if (!reply || !replyJa) fail('reply');
  return {
    language: str(raw.language, 20),
    review_ja: str(raw.review_ja, 3000),
    reply, reply_ja: replyJa,
    points: arr(raw.points ?? [], 'points', 12).map((p) => {
      if (!isObj(p)) fail('point');
      return { kind: POINT_KINDS.includes(p.kind) ? p.kind : 'complaint', text: str(p.text, 200) };
    }).filter((p) => p.text),
    needs_check: arr(raw.needs_check ?? [], 'needs_check', 10).map((n) => {
      if (!isObj(n)) fail('needs_check');
      return { point: str(n.point, 120), reason: str(n.reason, 200) };
    }).filter((n) => n.point),
    used_info_ids: arr(raw.used_info_ids ?? [], 'used_info_ids', 30).map((x) => str(x, 40)),
  };
}

const FAQ_LANGS = ['ja', 'zh', 'en', 'ko'];

export const INN_FAQ_TOOL = {
  name: 'submit_inn_faq',
  description: '宿のサイトに載せる、よくある質問を提出する',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'よくある質問（8問前後）',
        items: {
          type: 'object',
          properties: {
            info_ids: { type: 'array', items: { type: 'string' }, description: '答えに使った宿の情報の id' },
            ...Object.fromEntries(FAQ_LANGS.flatMap((l) => [[`q_${l}`, { type: 'string' }], [`a_${l}`, { type: 'string' }]])),
          },
          required: ['info_ids', ...FAQ_LANGS.flatMap((l) => [`q_${l}`, `a_${l}`])],
        },
      },
    },
    required: ['items'],
  },
};

export function validateInnFaq(raw) {
  if (!isObj(raw)) fail('object');
  const items = arr(raw.items, 'items', 12).map((it) => {
    if (!isObj(it)) fail('item');
    const out = { info_ids: arr(it.info_ids, 'info_ids', 10).map((x) => str(x, 40)) };
    for (const l of FAQ_LANGS) {
      out[`q_${l}`] = str(it[`q_${l}`], 300);
      out[`a_${l}`] = str(it[`a_${l}`], 1200);
      if (!out[`q_${l}`] || !out[`a_${l}`]) fail(`faq ${l}`);
    }
    return out;
  });
  if (!items.length) fail('items');
  return { items };
}

// ---- デモC：サイトのチャットボット ---------------------------------------------------

export const SITE_TOOL = {
  name: 'submit_site_answer',
  description: 'サイトの訪問者への答えを提出する',
  schema: {
    type: 'object',
    properties: {
      language: { type: 'string', description: '質問の言語（ISO 639-1）' },
      found: { type: 'boolean', description: 'サイトの内容で答えられれば true' },
      answer: { type: 'string', description: '質問と同じ言語の答え。3〜5文。サイトに書いてあることだけ' },
      link_ids: { type: 'array', items: { type: 'string' }, description: '答えに関係するページの id（一覧にあるものだけ）' },
      suggest_consult: { type: 'boolean', description: '相談・問い合わせへの案内が役立つなら true' },
      category: { type: 'string', description: '質問の種類（料金／進め方／対応範囲／会社のこと／その他 など、短く日本語で）' },
    },
    required: ['language', 'found', 'answer', 'link_ids', 'suggest_consult', 'category'],
  },
};

export function validateSiteAnswer(raw) {
  if (!isObj(raw)) fail('object');
  return {
    language: str(raw.language, 20),
    found: bool(raw.found, 'found'),
    answer: str(raw.answer, 1500),
    link_ids: arr(raw.link_ids, 'link_ids', 5).map((x) => str(x, 40)),
    suggest_consult: bool(raw.suggest_consult ?? false, 'suggest_consult'),
    category: str(raw.category, 30),
  };
}

// ---- 受注：FAX・紙の注文書 ------------------------------------------------------------

export const ORDER_TOOL = {
  name: 'submit_order',
  description: '画像の注文書（FAX・紙）から読み取った内容を提出する',
  schema: {
    type: 'object',
    properties: {
      is_order: { type: 'boolean', description: '注文書・発注書として読めるか' },
      customer: { type: 'string', description: '発注元（注文してきた会社・店）。読めなければ空文字' },
      order_date: { type: 'string', description: '発注日。書いてあるとおり（年が無ければ月日だけ）。無ければ空文字' },
      delivery_date: { type: 'string', description: '納品希望日。書いてあるとおり。無ければ空文字' },
      lines: {
        type: 'array',
        description: '明細（注文された商品ごとに1つ。書いてある順）',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '品名（書いてあるとおり。直さない）' },
            spec: { type: 'string', description: '規格・容量（150g など）。無ければ空文字' },
            qty: { type: ['number', 'null'], description: '数量。書いてあるとおり（小数も丸めない）。読めなければ null' },
            unit: { type: 'string', description: '単位（個・袋・箱・ケース など）。無ければ空文字' },
            unit_price: { type: ['integer', 'null'], description: '単価（円）。書いていなければ null' },
            amount: { type: ['integer', 'null'], description: '金額（円）。書いていなければ null' },
            conf_name: { type: 'string', enum: ['高', '中', '低'], description: '品名の読み取りの確かさ' },
            conf_qty: { type: 'string', enum: ['高', '中', '低'], description: '数量の読み取りの確かさ' },
          },
          required: ['name', 'spec', 'qty', 'unit', 'unit_price', 'amount', 'conf_name', 'conf_qty'],
        },
      },
      note: { type: 'string', description: '備考・連絡事項（書いてあるとおり）。無ければ空文字' },
      confidence: {
        type: 'object',
        properties: { customer: level, order_date: level, delivery_date: level },
        required: ['customer', 'order_date', 'delivery_date'],
      },
    },
    required: ['is_order', 'customer', 'order_date', 'delivery_date', 'lines', 'note', 'confidence'],
  },
};

const lv = (v) => (LEVELS.includes(toStr(v)) ? toStr(v) : '低');

export function validateOrder(raw) {
  if (!isObj(raw)) fail('object');
  if (typeof raw.is_order !== 'boolean') fail('is_order');
  if (!Array.isArray(raw.lines)) fail('lines');
  if (raw.lines.length > 60) fail('lines length');
  const conf = isObj(raw.confidence) ? raw.confidence : {};
  return {
    is_order: raw.is_order,
    customer: toStr(raw.customer).slice(0, 80),
    order_date: toStr(raw.order_date).slice(0, 30),
    delivery_date: toStr(raw.delivery_date).slice(0, 30),
    note: toStr(raw.note).slice(0, 300),
    confidence: { customer: lv(conf.customer), order_date: lv(conf.order_date), delivery_date: lv(conf.delivery_date) },
    lines: raw.lines.map((l) => {
      if (!isObj(l)) fail('line');
      return {
        name: toStr(l.name).slice(0, 80),
        spec: toStr(l.spec).slice(0, 30),
        qty: toNumOrNull(l.qty, 'qty'),
        unit: toStr(l.unit).slice(0, 10),
        unit_price: toIntOrNull(l.unit_price, 'unit_price'),
        amount: toIntOrNull(l.amount, 'amount'),
        conf_name: lv(l.conf_name),
        conf_qty: lv(l.conf_qty),
      };
    }).filter((l) => l.name || l.spec || l.qty != null || l.unit_price != null || l.amount != null), // 品名が読めない行も、何か書いてあれば残す（黙って消さない）
  };
}
