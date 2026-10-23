import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED, emptyFields, formatDate, formatHours, missingFields, isSafety, safetyWords, formatReport, formatShort, SAFETY_NOTICE, UNFILLED, SHORT_MAX,
} from '../public/js/report-format.js';
import { validateReport } from '../src/schemas.js';
import { report } from '../src/demos/report.js';
import worker from '../src/worker.js';

const MOCK = { AI_PROVIDER: 'mock' };
const EX1 = '今日は外壁塗装の足場を組みました。職人3人です。2階ベランダの手すりがぐらついていて、ヒヤリとしました。明日は下塗りの予定です。';
const EX2 = '今日は午後、山本さんのお宅に訪問して、入浴の介助と掃除をしました。2人で、2時間くらいです。';
const full = () => ({ ...emptyFields(), date: '2026-10-23', site: '田中邸', work: ['足場の組み立て'], people: 3, start: '08:00', end: '17:00', tomorrow: '下塗り' });

test('日付・時間の表示', () => {
  assert.equal(formatDate('2026-10-23'), '2026年10月23日（金）');
  assert.equal(formatDate('2026-02-30'), '');
  assert.equal(formatDate(''), '');
  assert.equal(formatHours({ start: '08:00', end: '17:00', hours: null }), '8:00〜17:00（9時間）');
  assert.equal(formatHours({ start: '22:00', end: '06:30', hours: null }), '22:00〜6:30（8時間30分）');
  assert.equal(formatHours({ start: '', end: '', hours: 2 }), '2時間');
  assert.equal(formatHours({ start: '08:00', end: '', hours: null }), null);
  assert.equal(formatHours({ start: '08:00', end: '08:00', hours: null }), null); // 同じ時刻は、入っていないのと同じ
});

test('必須の項目：空なら、決まった質問が出る。埋まれば出ない', () => {
  assert.deepEqual(REQUIRED.map((r) => r.field), ['date', 'site', 'work', 'people', 'hours', 'tomorrow']);
  assert.equal(missingFields(full()).length, 0);
  assert.deepEqual(missingFields(emptyFields()).map((m) => m.field), ['date', 'site', 'work', 'people', 'hours', 'tomorrow']);
  const f = { ...full(), start: '', end: '' };
  assert.deepEqual(missingFields(f).map((m) => m.question), ['作業は何時から何時まででしたか？（または何時間でしたか？）']);
  assert.equal(missingFields({ ...f, hours: 2 }).length, 0);
  assert.equal(missingFields({ ...full(), people: 0 }).length, 1);
  assert.equal(missingFields({ ...full(), people: 2.5 }).length, 1);
  assert.equal(missingFields({ ...full(), work: ['', '  '] }).length, 1);
  assert.equal(missingFields({ ...full(), site: '   ' }).length, 1);
});

test('安全に関わる内容：「危ない所」があるか、決まった語があれば、先頭に固定の文', () => {
  assert.equal(isSafety(full()), false);
  assert.equal(isSafety({ ...full(), hazards: '手すりがぐらついていた' }), true);
  for (const w of ['ヒヤリとした', '転落しそうになった', '利用者さんが転倒', '指を切った', '熱中症の疑い', '感電', '救急車を呼んだ', '体調不良']) assert.equal(isSafety(full(), w), true, w);
  assert.equal(isSafety({ ...full(), notes: '足場から落下しかけた' }), true);
  assert.equal(isSafety(full(), '今日は天気がよく、作業は順調でした'), false);
  // 見つけた語を見せる（人が確かめられるように）
  assert.deepEqual(safetyWords(full(), 'ヒヤリとして、足を踏み外した'), ['ヒヤリ', '踏み外']);
  assert.match(formatReport(full(), 'ヒヤリとした'), /見つけた語：ヒヤリ/);
  // 「なし」は危ない所に数えない。現場の日常の語（KY活動・無事故・防止・対策）は、危険の報告ではない
  assert.equal(isSafety({ ...full(), hazards: 'なし' }), false);
  assert.equal(isSafety({ ...full(), hazards: '特になし。' }), false);
  for (const t of ['朝礼でKY活動（危険予知）を実施しました', '無事故・無災害で終了しました', '事故防止のため、コーンを置きました', '在庫が切れていたので買い足しました', '養生テープを切って貼りました', '落下防止ネットを設置', '熱中症対策で水分を配りました', 'ケガ防止の手袋を支給', '事故はありませんでした', 'けがはなし']) assert.equal(isSafety(full(), t), false, t);
  // 見逃し：「危ない」を含まない言い方
  for (const t of ['足を踏み外した', '頭をぶつけた', '指をはさんだ', '転びそうになった', '落ちそうになった', '手すりが外れそうでした', '漏電', '腰を痛めた', '具合が悪くなった', 'ふらふらしていた', 'ひやひやした', '危うく落ちるところ']) assert.equal(isSafety(full(), t), true, t);
  assert.ok(formatReport({ ...full(), hazards: 'x' }).startsWith(`※ ${SAFETY_NOTICE}`));
  assert.ok(!formatReport(full()).includes(SAFETY_NOTICE));
});

test('日報の文：プログラムの型に埋める。足りない項目は（未入力）のまま（推測で埋めない）', () => {
  assert.equal(formatReport(full()), ['【日報】2026年10月23日（金）', '現場：田中邸', '作業内容：', '・足場の組み立て', '人数：3人', '時間：8:00〜17:00（9時間）', '気づき・危ない所：なし', '明日の予定：下塗り'].join('\n'));
  const e = formatReport(emptyFields());
  assert.equal(e.split(UNFILLED).length - 1, 6);
  assert.match(e, /気づき・危ない所：なし/);
});

test('LINE に貼れる短い形：300文字まで。長ければ「…」で切る。安全の印は先頭', () => {
  const s = formatShort({ ...full(), hazards: '手すりがぐらついた' });
  assert.equal(s, '⚠安全に関わる内容あり 【日報】10/23｜田中邸｜足場の組み立て｜3人 8:00〜17:00（9時間）｜気づき：手すりがぐらついた｜明日：下塗り');
  assert.ok(s.length <= SHORT_MAX);
  // 長いときは、作業内容から詰める：気づき・明日の予定は残る（「…」で切るのは、詰めきれないときだけ）
  const long = formatShort({ ...full(), work: ['あ'.repeat(280)], hazards: '手すりがぐらついた' });
  assert.ok(long.length <= SHORT_MAX);
  assert.ok(long.includes('気づき：手すりがぐらついた') && long.endsWith('明日：下塗り') && long.includes('…｜'));
  const huge = formatShort({ ...full(), work: ['い'.repeat(400)], hazards: 'あ'.repeat(300), tomorrow: 'う'.repeat(300) });
  assert.ok(Array.from(huge).length <= SHORT_MAX);
  assert.ok(!/[\ud800-\udbff]$/.test(formatShort({ ...full(), work: ['😀'.repeat(400)] })));
  assert.ok(formatShort(emptyFields()).includes(UNFILLED));
});

test('検証：AIの答えの形を整える（日付・時刻・人数・時間数）。壊れた形は断る', () => {
  const v = validateReport({ date: '2026/10/23', site: ' 田中邸 ', work: ['a', '', 'b'], people: '3', start: '8:00', end: '17時30', hours: '9', hazards: 'h', notes: 'n', tomorrow: 't', questions: [{ field: 'hours', question: 'q' }, { field: 'x', question: '' }, null] });
  assert.deepEqual(v, { date: '2026-10-23', site: '田中邸', work: ['a', 'b'], people: 3, start: '08:00', end: '17:30', hours: 9, hazards: 'h', notes: 'n', tomorrow: 't', questions: [{ field: 'hours', question: 'q' }] });
  assert.equal(validateReport({ start: '22:00', end: '25:00' }).end, ''); // 24時以降は読み取れなかったことにする
  const bad = validateReport({ date: '2026-02-30', work: [], people: -1, start: '25:99', hours: 99, questions: [] });
  assert.equal(bad.date, ''); assert.equal(bad.people, null); assert.equal(bad.start, ''); assert.equal(bad.hours, null);
  assert.equal(validateReport({ people: 2.5 }).people, null);
  assert.throws(() => validateReport('x'), /schema/);
  assert.throws(() => validateReport({ work: 'oops' }), /schema/);
});

test('例の2つ：抜けた項目が質問として出る。安全の固定の文は、話した言葉から', async () => {
  const a = await report(MOCK, { text: EX1 });
  assert.equal(a.fields.site, '田中邸');
  assert.equal(a.fields.people, 3);
  assert.deepEqual(a.missing.map((m) => m.field), ['hours']);
  assert.equal(a.missing[0].question, '作業は何時から何時まででしたか？（または何時間でしたか？）');
  assert.equal(a.safety, true);
  const b = await report(MOCK, { text: EX2 });
  assert.deepEqual(b.missing.map((m) => m.field), ['tomorrow']);
  assert.equal(b.fields.hours, 2);
  assert.deepEqual(b.extraQuestions.map((q) => q.field), ['other']); // 必須以外のAIの質問は足す（必須の質問は、プログラムが出すので重ねない）
  assert.equal(b.safety, false);
  // AI が「危ない所」を空で返しても、話した言葉に決まった語があれば安全の文を出す
  assert.equal((await report(MOCK, { text: `${EX2} ご利用者さんが少しふらつきました。` })).safety, true);
});

test('入力の検証と経路（パスワード必須）', async () => {
  await assert.rejects(report(MOCK, { text: '' }), (e) => e.status === 400);
  await assert.rejects(report(MOCK, { text: 'あ'.repeat(1501) }), (e) => e.status === 400);
  await assert.rejects(report(MOCK, { text: ['x'] }), (e) => e.status === 400);
  const env = { ...MOCK, DEMO_PASSCODE: 'ためし' };
  const post = (pass) => worker.fetch(new Request('https://x.test/api/report', { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-demo-pass': encodeURIComponent(pass) } : {}) }, body: JSON.stringify({ text: EX1 }) }), env);
  assert.equal((await post('')).status, 401);
  const ok = await (await post('ためし')).json();
  assert.equal(ok.ok, true);
  assert.equal(ok.data.fields.site, '田中邸');
});
