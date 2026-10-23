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
// 現場の日常の言葉（KY活動・無事故・事故防止・落下防止・熱中症対策 など）は、危険の報告ではないので、先に除く
const SAFETY_WORDS = /ヒヤリ|ひやり|ヒヤッ|ひやっ|ヒヤヒヤ|ひやひや|転落|落下|転倒|転んだ|転びそう|滑っ|すべっ|つまず|踏み外|けが|怪我|ケガ|負傷|出血|切り傷|[指手足顔腕]を切っ|切ってしまっ|挟ま|挟ん|はさま|はさん|ぶつけ|刺さ|感電|漏電|熱中症|事故|危な|あぶな|危うく|あやうく|危険|ぐらつ|ぐらぐら|外れそう|落ちそう|崩れ|倒れそう|倒れた|救急|骨折|打撲|やけど|火傷|痛め|痛い|誤嚥|ふらつ|ふらふら|めまい|具合が悪|気分が悪|吐き|体調不良|急変|虐待|暴力|行方不明/g;
const BENIGN = /KY活動|ＫＹ活動|危険予知|無事故|無災害|事故ゼロ|事故防止|事故を防|落下防止|転落防止|転倒防止|けが防止|ケガ防止|怪我防止|熱中症対策|熱中症予防|熱中症防止|安全(靴|帯|第一|確認|点検)|ヒヤリハット(マップ|の共有|集)|(事故|けが|怪我|ケガ|危険|危ない所|異常)(は|も)?(ありません|なし|ない|無し)/g;

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
    if (span === 0) return null; // 開始と終了が同じ時刻は、入っていないのと同じ
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

const NONE = /^(なし|無し|特になし|特に無し|ない|特にない|ありません|特にありません|異常なし|問題なし)[。.！!]*$/;

/** 安全に関わる語（話した言葉・作業・気づきの中）。見つけた語を返す（画面に「検出した語」として見せ、人が確かめられるように） */
export function safetyWords(f, spoken = '') {
  const text = [spoken, f.notes, ...(f.work ?? [])].join('\n').normalize('NFKC').replace(BENIGN, ' ');
  return [...new Set(text.match(SAFETY_WORDS) ?? [])];
}

/** 「危ない所」に、なしでない言葉が入っているか */
export const hasHazard = (f) => { const h = String(f.hazards ?? '').trim(); return Boolean(h) && !NONE.test(h.normalize('NFKC')); };

/** 安全に関わるか：「危ない所」に書いてある、または決まった語がある（見逃しより、出しすぎのほうを選ぶ） */
export const isSafety = (f, spoken = '') => hasHazard(f) || safetyWords(f, spoken).length > 0;

/** 日報（テキスト）。足りない項目は「（未入力）」のまま出す（推測で埋めない）。安全の固定の文は先頭 */
export function formatReport(f, spoken = '') {
  const lines = [];
  if (isSafety(f, spoken)) { const w = safetyWords(f, spoken); lines.push(`※ ${SAFETY_NOTICE}${w.length ? `（見つけた語：${w.slice(0, 4).join('・')}）` : ''}`, ''); }
  lines.push(`【日報】${formatDate(f.date) || UNFILLED}`);
  lines.push(`現場：${String(f.site ?? '').trim() || UNFILLED}`);
  const work = (f.work ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
  lines.push('作業内容：');
  if (work.length) lines.push(...work.map((w) => `・${w}`)); else lines.push(`　${UNFILLED}`);
  lines.push(`人数：${has.people(f) ? `${f.people}人` : UNFILLED}`);
  lines.push(`時間：${formatHours(f) ?? UNFILLED}`);
  lines.push(`気づき・危ない所：${[hasHazard(f) ? f.hazards : '', f.notes].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ／ ') || 'なし'}`);
  lines.push(`明日の予定：${String(f.tomorrow ?? '').trim() || UNFILLED}`);
  return lines.join('\n');
}

export const SHORT_MAX = 300;

const cut = (t, n) => { const c = Array.from(t); return c.length <= n ? t : `${c.slice(0, Math.max(0, n - 1)).join('')}…`; };

/**
 * LINE に貼れる短い形（300文字まで）。長いときは、作業内容から先に詰める（気づき・明日の予定は残す）。
 * それでも入らなければ、気づき → 明日の予定の順に詰める。切るときは文字の途中（絵文字など）で切らない
 */
export function formatShort(f, spoken = '', max = SHORT_MAX) {
  const d = /^\d{4}-(\d{2})-(\d{2})$/.exec(f.date ?? '');
  const clean = (x) => String(x ?? '').trim();
  const parts = {
    head: `${isSafety(f, spoken) ? '⚠安全に関わる内容あり ' : ''}【日報】${d ? `${+d[1]}/${+d[2]}` : UNFILLED}`,
    site: clean(f.site) || UNFILLED,
    work: (f.work ?? []).map(clean).filter(Boolean).join('、') || UNFILLED,
    time: `${has.people(f) ? `${f.people}人` : UNFILLED} ${formatHours(f) ?? UNFILLED}`,
    watch: [hasHazard(f) ? f.hazards : '', f.notes].map(clean).filter(Boolean).join('／'),
    tomorrow: clean(f.tomorrow) || UNFILLED,
  };
  const build = () => [parts.head, parts.site, parts.work, parts.time, parts.watch && `気づき：${parts.watch}`, `明日：${parts.tomorrow}`].filter(Boolean).join('｜');
  for (const key of ['work', 'watch', 'tomorrow']) {
    const over = Array.from(build()).length - max;
    if (over <= 0) break;
    parts[key] = cut(parts[key], Math.max(8, Array.from(parts[key]).length - over));
  }
  return cut(build(), max);
}
