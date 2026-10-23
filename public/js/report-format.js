// 音声日報：日報の型（プログラムが決める）。AIは話した言葉から項目を取り出すだけで、日報の文は書かない。
// 画面（直した値で文を作り直す）・サーバー（足りない項目の判定）・Excel の3つが同じ関数を使う。

/** 必須の項目：空なら、AIが質問を出さなくても決まった質問を出す */
export const REQUIRED = [
  { field: 'date', label: '日付', question: '日付はいつですか？' },
  { field: 'site', label: '現場・訪問先', question: '現場（訪問先）の名前は何ですか？' },
  { field: 'work', label: '作業内容', question: '今日の作業は何でしたか？' },
  { field: 'people', label: '人数', question: '何人で作業しましたか？' },
  { field: 'hours', label: '時間', question: '作業は何時から何時まででしたか？（または何時間でしたか？）' },
  { field: 'tomorrow', label: '明日の予定', question: '明日の予定は何ですか？' },
];

export const SAFETY_NOTICE = '安全に関わる内容があります。責任者に共有してください。';
export const UNFILLED = '（未入力）';

// 安全に関わる決まった語（AIが「危ない所」を空で返しても、プログラムが話した言葉から必ず見る）
const SAFETY_RE = /ヒヤリ|ひやり|ヒヤッ|ひやっ|転落|落下|転倒|転んだ|滑っ|すべっ|つまず|けが|怪我|ケガ|負傷|出血|切っ|切れ|挟ま|挟ん|感電|熱中症|事故|危な|あぶな|危険|ぐらつ|ぐらぐら|倒れ|救急|骨折|打撲|やけど|火傷|誤嚥|ふらつ|めまい|急変|体調不良|虐待|暴力|行方不明/;

export const emptyFields = () => ({ date: '', site: '', work: [], people: null, start: '', end: '', hours: null, hazards: '', notes: '', tomorrow: '' });

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 2026-10-23 → 2026年10月23日（金） */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1) return '';
  return `${+m[1]}年${+m[2]}月${+m[3]}日（${WEEK[d.getUTCDay()]}）`;
}

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : null; };
const hm = (min) => `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ''}`;

/** 時間の表示：開始・終了があれば「8:00〜17:00（9時間）」、実働だけなら「2時間」。無ければ null */
export function formatHours(f) {
  const s = toMin(f.start); const e = toMin(f.end);
  if (s != null && e != null) {
    const span = (e >= s ? e : e + 1440) - s;
    return `${f.start.replace(/^0/, '')}〜${f.end.replace(/^0/, '')}（${hm(span)}）`;
  }
  if (Number.isFinite(f.hours) && f.hours > 0) return `${f.hours}時間`;
  return null;
}

const has = {
  date: (f) => Boolean(formatDate(f.date)),
  site: (f) => Boolean(String(f.site ?? '').trim()),
  work: (f) => Array.isArray(f.work) && f.work.some((x) => String(x ?? '').trim()),
  people: (f) => Number.isInteger(f.people) && f.people > 0,
  hours: (f) => formatHours(f) != null,
  tomorrow: (f) => Boolean(String(f.tomorrow ?? '').trim()),
};

/** 空の必須項目 → 決まった質問 */
export const missingFields = (f) => REQUIRED.filter((r) => !has[r.field](f));

/** 安全に関わるか：「危ない所」に書いてある、または話した言葉・作業・気づきに決まった語がある */
export function isSafety(f, spoken = '') {
  if (String(f.hazards ?? '').trim()) return true;
  return SAFETY_RE.test([spoken, f.notes, ...(f.work ?? [])].join('\n'));
}

/** 日報（テキスト）。足りない項目は「（未入力）」のまま出す（推測で埋めない）。安全の固定の文は先頭 */
export function formatReport(f, spoken = '') {
  const lines = [];
  if (isSafety(f, spoken)) lines.push(`※ ${SAFETY_NOTICE}`, '');
  lines.push(`【日報】${formatDate(f.date) || UNFILLED}`);
  lines.push(`現場：${String(f.site ?? '').trim() || UNFILLED}`);
  const work = (f.work ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  lines.push('作業内容：');
  if (work.length) lines.push(...work.map((w) => `・${w}`)); else lines.push(`　${UNFILLED}`);
  lines.push(`人数：${has.people(f) ? `${f.people}人` : UNFILLED}`);
  lines.push(`時間：${formatHours(f) ?? UNFILLED}`);
  lines.push(`気づき・危ない所：${[f.hazards, f.notes].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ／ ') || 'なし'}`);
  lines.push(`明日の予定：${String(f.tomorrow ?? '').trim() || UNFILLED}`);
  return lines.join('\n');
}

export const SHORT_MAX = 300;

/** LINE に貼れる短い形（300文字まで）。長ければ、作業内容を詰めて、最後に「…」 */
export function formatShort(f, spoken = '', max = SHORT_MAX) {
  const d = /^\d{4}-(\d{2})-(\d{2})$/.exec(f.date ?? '');
  const work = (f.work ?? []).map((x) => String(x ?? '').trim()).filter(Boolean).join('、');
  const parts = [
    `${isSafety(f, spoken) ? '⚠安全に関わる内容あり ' : ''}【日報】${d ? `${+d[1]}/${+d[2]}` : UNFILLED}`,
    String(f.site ?? '').trim() || UNFILLED,
    work || UNFILLED,
    `${has.people(f) ? `${f.people}人` : UNFILLED} ${formatHours(f) ?? UNFILLED}`,
  ];
  const watch = [f.hazards, f.notes].map((x) => String(x ?? '').trim()).filter(Boolean).join('／');
  if (watch) parts.push(`気づき：${watch}`);
  parts.push(`明日：${String(f.tomorrow ?? '').trim() || UNFILLED}`);
  const text = parts.join('｜');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
