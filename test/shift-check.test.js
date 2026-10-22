import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import {
  checkShift, checkSymbols, parseHopes, readShiftTable, detectPeriod, monthDays, toMin, DEFAULT_SYMBOLS, DEFAULT_NEEDS,
} from '../public/js/shift-check.js';
import { sheetRows, cellValue, buildShiftWorkbook } from '../public/js/shift-xlsx.js';
import { decodeCsvBytes, parseCsv } from '../public/js/csv.js';

const PERIOD = '2026-11'; // 1日は日曜。3日・23日は祝日
const N = 30;
// 10日で一回り（どの日も 早2・日1・遅2・夜1・明1・休3 になり、必要な人数をちょうど満たす）
const PATTERN = ['早', '早', '日', '休', '遅', '遅', '夜', '明', '休', '休'];
const base = () => ({
  period: PERIOD,
  people: Array.from({ length: 10 }, (_, i) => ({ name: `職員${i + 1}`, cells: Array.from({ length: N }, (_, d) => PATTERN[(d + ((3 * i) % 10)) % 10]) })),
});
const run = (grid, settings = {}) => checkShift(grid, settings);
const kinds = (r) => r.problems.map((p) => p.kind);
const at = (grid, pi, day) => grid.people[pi].cells[day - 1];
const put = (grid, pi, day, v) => { grid.people[pi].cells[day - 1] = v; };

test('問題のない表は、何も出ない', () => {
  const r = run(base());
  assert.deepEqual(r.problems, []);
  assert.equal(r.cellFlags.size, 0);
  assert.ok(r.people.every((p) => p.holidays === 9 && p.maxStreak === 3 && p.nights === 3 && p.workDays === 18 && p.afters === 3));
});

test('人が足りない：1時間ごとに数えて、同じ不足が続いた時間をまとめる', () => {
  const g = base();
  // 12日（木）の遅番を1人、有給にする → 16時は 日1＋遅1＝2（必要3）、17時は 日1＋遅1＝2（必要2で足りる）、18〜22時は 遅1（必要2）
  const pi = g.people.findIndex((p) => at({ people: [p] }, 0, 12) === '遅');
  put(g, pi, 12, '有');
  const r = run(g);
  assert.deepEqual(r.shortages.map((s) => [s.day, s.band, s.from, s.to, s.short]), [[12, 'day', 16, 17, 1], [12, 'evening', 18, 22, 1]]);
  assert.equal(r.problems[0].text, '12日（木） 昼の16〜17時：必要3人に2人（1人不足）');
  assert.equal(r.problems[1].text, '12日（木） 夕の18〜22時：必要2人に1人（1人不足）');
  assert.deepEqual(r.dayFlags.get(12), { level: 'red', short: 1, text: '不足1' });
  assert.deepEqual(r.bandCount.get('12|evening'), { min: 1, need: 2 });
  assert.ok(r.problems.every((p) => p.level === 'red'));
});

test('人が足りない：夜勤は翌朝まで数える（夜の帯は 22〜翌7時）。土日祝は別の人数', () => {
  const g = base();
  const pi = g.people.findIndex((p) => at({ people: [p] }, 0, 10) === '夜');
  put(g, pi, 10, '休'); put(g, pi, 11, '休'); // 夜勤を外す（明けも休みに）
  const r = run(g);
  const night = r.shortages.find((s) => s.band === 'night');
  assert.deepEqual([night.day, night.from, night.to, night.short], [10, 22, 31, 1]);
  assert.match(night.text, /夜の22〜翌7時/);
  // 土曜（14日）の早番を日勤にする → 朝は1人。昼は土日祝の必要2人なので足りる
  const g2 = base();
  const e = g2.people.findIndex((p) => at({ people: [p] }, 0, 14) === '早');
  put(g2, e, 14, '日');
  assert.deepEqual(run(g2).shortages.map((s) => [s.day, s.band, s.short]), [[14, 'morning', 1]]);
  // 祝日（3日・火）も土日祝の人数：日勤が休みでも、昼は 早2（16時は 遅2）で足りる。平日なら 9〜13時と16〜17時が不足
  const g3 = base();
  const d = g3.people.findIndex((p) => at({ people: [p] }, 0, 3) === '日');
  put(g3, d, 3, '休');
  assert.deepEqual(run(g3).shortages, []);
  assert.deepEqual(run(g3, { holidays: [] }).shortages.map((s) => [s.day, s.band, s.from, s.to]), [[3, 'day', 9, 13], [3, 'day', 16, 17]]);
});

test('人数は、その1時間ずっといる人だけ数える（30分の勤務は数えない）', () => {
  const g = { period: PERIOD, people: [{ name: 'A', cells: Array(N).fill('短') }] };
  const symbols = [...DEFAULT_SYMBOLS, { code: '短', name: '短時間', start: '07:30', end: '09:00', kind: 'work' }];
  const needs = { weekday: { morning: 1, day: 0, evening: 0, night: 0 }, holiday: { morning: 1, day: 0, evening: 0, night: 0 } };
  const r = run(g, { symbols, needs, rules: { minHolidays: 0, maxStreak: 99 } });
  assert.deepEqual(r.shortages.filter((s) => s.day === 2).map((s) => [s.from, s.to]), [[7, 8]]);
});

test('連勤：上限を超えた続きを1つの問題に。夜勤明けは数えないが切れない。休日・有給で切れる', () => {
  const g = base();
  // 職員1：11日〜20日 は 早 早 日 休 遅 遅 夜 明 休 休。14日の休を日勤に → 11〜17日の7連勤（明の18日は数えない）
  put(g, 0, 14, '日');
  let r = run(g);
  const s = r.problems.find((p) => p.kind === 'streak');
  assert.equal(s.text, '職員1さん：11日〜17日に7日の勤務が続きます（7連勤。上限5日）');
  assert.deepEqual(r.cellFlags.get('0|16'), [{ level: 'yellow', kind: 'streak', text: '6連勤' }]);
  assert.deepEqual(r.cellFlags.get('0|17'), [{ level: 'yellow', kind: 'streak', text: '7連勤' }]);
  assert.equal(r.people[0].maxStreak, 7);
  // 夜勤明けをはさむ：15日 遅、16日 遅、17日 夜、18日 明、19日 を早番 → 夜勤明けは切れない（上限3日で確かめる）
  const g2 = base();
  put(g2, 0, 19, '早');
  r = run(g2, { rules: { maxStreak: 3 } });
  const s2 = r.problems.filter((p) => p.kind === 'streak');
  assert.equal(s2.length, 1);
  assert.equal(s2[0].text, '職員1さん：15日〜19日に4日の勤務が続きます（4連勤・間の夜勤明けは数えていません。上限3日）');
  assert.deepEqual(r.cellFlags.get('0|19').map((f) => f.text), ['4連勤']);
  // 有給で切れる
  const g3 = base();
  put(g3, 0, 14, '日'); put(g3, 0, 15, '有');
  assert.ok(!kinds(run(g3)).includes('streak'));
  // 上限を変えられる
  assert.ok(!kinds(run(g, { rules: { maxStreak: 7 } })).includes('streak'));
});

test('月の休日数：休日（休・公）だけを数える。有給・夜勤明けは数えない', () => {
  const g = base();
  put(g, 0, 9, '有'); // 休 → 有
  const r = run(g);
  assert.equal(r.people[0].holidays, 8);
  assert.equal(r.people[0].leaves, 1);
  const p = r.problems.find((x) => x.kind === 'holidays');
  assert.equal(p.text, '職員1さん：月の休日が8日です（下限9日。有給・夜勤明けは数えません）');
  assert.equal(p.day, null);
  put(g, 0, 9, '公');
  assert.ok(!kinds(run(g)).includes('holidays'));
});

test('希望休：勤務の日は赤、夜勤明けは黄、休みなら何も出ない。シフト表にいない氏名は黄', () => {
  const g = base();
  const hopes = [{ name: '職員1', day: 1 }, { name: '職員1', day: 8 }, { name: '職員1', day: 9 }, { name: '職員 99', day: 3 }];
  const r = run(g, { hopes });
  assert.deepEqual(r.problems.map((p) => [p.level, p.kind, p.day]), [['red', 'hope', 1], ['yellow', 'hopeafter', 8], ['yellow', 'hopename', null]]);
  assert.equal(r.problems[0].text, '職員1さん 1日（日）：希望休の日に「早」（早番）が入っています');
  assert.equal(r.people[0].conflicts, 1);
  assert.deepEqual(r.cellFlags.get('0|1'), [{ level: 'red', kind: 'hope', text: '希望休' }]);
  // 氏名の空白・全角半角は無視して比べる
  assert.equal(run(g, { hopes: [{ name: '職員１', day: 1 }] }).problems[0].kind, 'hope');
});

test('勤務と勤務の間：11時間未満は黄（参考）。遅番→早番は9時間、遅番→日勤はちょうど11時間で出ない', () => {
  const g = base();
  // 職員1：5日 遅、6日 遅 → 6日を早番に
  put(g, 0, 6, '早');
  let r = run(g);
  const p = r.problems.find((x) => x.kind === 'interval');
  assert.equal(p.text, '職員1さん 6日（金）：前の「遅」の終わりから9時間で「早」です（11時間未満・参考）');
  assert.deepEqual(r.cellFlags.get('0|6').map((f) => f.text), ['間9時間']);
  const g2 = base();
  put(g2, 0, 6, '日');
  r = run(g2);
  assert.ok(!kinds(r).includes('interval'));
  assert.ok(!kinds(run(g, { rules: { minRestHours: 8 } })).includes('interval'));
});

test('夜勤のあと：次の日が休日なら黄（丸1日の休みにならない）。前の日が夜勤でない夜勤明けも黄', () => {
  const g = base();
  put(g, 0, 8, '休'); // 7日 夜 → 8日 休
  let r = run(g);
  assert.deepEqual(kinds(r), ['nightoff']);
  assert.match(r.problems[0].text, /夜勤の次の日が「休」です/);
  const g2 = base();
  put(g2, 0, 4, '明'); // 3日は日勤
  r = run(g2);
  assert.ok(kinds(r).includes('orphan'));
  // 1日の夜勤明けは、前の月が表に無いので確かめない
  const g3 = base();
  put(g3, 0, 1, '明');
  assert.ok(!kinds(run(g3)).includes('orphan'));
});

test('記号：表に無い記号は赤（人数に数えない）。空は黄で、人ごとに1つにまとめる', () => {
  const g = base();
  put(g, 0, 2, '研'); put(g, 1, 5, ''); put(g, 1, 6, ' ');
  const r = run(g);
  const u = r.problems.find((p) => p.kind === 'unknown');
  assert.equal(u.level, 'red');
  assert.match(u.text, /記号「研」が記号の表にありません/);
  const b = r.problems.filter((p) => p.kind === 'blank');
  assert.equal(b.length, 1);
  assert.match(b[0].text, /職員2さん：記号が空の日があります（5・6日）/);
  // 全角・空白はそろえて読む
  const g2 = base();
  put(g2, 0, 1, ' 早 ');
  assert.deepEqual(run(g2).problems, []);
  // 記号の表を足せば、数える
  const g3 = base();
  put(g3, 0, 2, '研');
  const symbols = [...DEFAULT_SYMBOLS, { code: '研', name: '研修', start: '07:00', end: '16:00', kind: 'work' }];
  assert.deepEqual(run(g3, { symbols }).problems, []);
});

test('一覧の並び：赤 → 黄、日付順。日の無いもの（休日数）は後ろ', () => {
  const g = base();
  put(g, 0, 9, '有'); put(g, 0, 6, '早'); put(g, 2, 2, '研');
  const r = run(g);
  assert.deepEqual(r.problems.map((p) => p.level), [...r.problems.filter((p) => p.level === 'red').map(() => 'red'), ...r.problems.filter((p) => p.level === 'yellow').map(() => 'yellow')]);
  assert.equal(r.problems.at(-1).kind, 'holidays');
});

test('記号の表を確かめる', () => {
  assert.deepEqual(checkSymbols(DEFAULT_SYMBOLS), []);
  const errs = checkSymbols([...DEFAULT_SYMBOLS, { code: '早', name: '', start: '', end: '', kind: 'off' }, { code: '', kind: 'off' }, { code: 'X', start: '9時', end: '', kind: 'work' }, { code: 'Y', start: '09:00', end: '09:00', kind: 'work' }]);
  assert.deepEqual(errs.map((e) => e.field), ['code', 'code', 'start', 'end', 'end']);
  assert.match(errs[0].text, /記号「早」が2つあります（1行目と9行目/);
  assert.equal(toMin('24:00'), 1440);
  assert.equal(toMin('7:05'), 425);
  assert.equal(toMin('25:00'), null);
});

test('祝日：土日祝の人数を使う。祝日の表は変えられる', () => {
  const d = monthDays(PERIOD);
  assert.equal(d[0].weekday, '日');
  assert.equal(d[2].isHoliday, true);
  assert.equal(d[2].type, 'holiday');
  assert.equal(monthDays(PERIOD, [])[2].type, 'weekday');
});

test('希望休の貼り付けを読む', () => {
  const { list, errors } = parseHopes('佐藤 花子,11/9\n加藤　誠,2026/11/3\n\n渡辺 翔\t20\n田中 健太 19日\n高橋,5,12、20\n佐藤 花子,9\n山本,12/1\n中村,31\n小林', PERIOD);
  assert.deepEqual(list, [
    { name: '佐藤 花子', day: 9 }, { name: '加藤 誠', day: 3 }, { name: '渡辺 翔', day: 20 }, { name: '田中 健太', day: 19 },
    { name: '高橋', day: 5 }, { name: '高橋', day: 12 }, { name: '高橋', day: 20 },
  ]);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^8行目「山本,12\/1」を読めません/);
});

test('表から読む：見出しの行（氏名＋日付）、曜日の行・人数の行・空の行は読み飛ばす', () => {
  const rows = [
    ['2026年11月 勤務表'],
    ['', ''],
    ['職員番号', '氏名', ...Array.from({ length: N - 1 }, (_, i) => `${i + 1}日`)],
    ['', '曜日', ...monthDays(PERIOD).map((d) => d.weekday)],
    ['1', '佐藤　花子', ...Array(N).fill('早')],
    ['2', '鈴木 一郎', '遅', ...Array(N - 2).fill('休')],
    ['', '早の人数', ...Array(N).fill(2)],
    ['', '退職', ...Array(N).fill('')],
  ];
  const { grid, errors, notes } = readShiftTable(rows, PERIOD);
  assert.deepEqual(errors, ['日付の列が無い日があります：30日（空として扱います）']);
  assert.deepEqual(grid.people.map((p) => p.name), ['佐藤 花子', '鈴木 一郎']);
  assert.equal(grid.people[1].cells[29], '');
  assert.equal(notes.length, 2);
  assert.equal(detectPeriod(rows), '2026-11');
  // 日付の見出し：11/1・2026/11/1・Excel の日付（Date）
  const r2 = readShiftTable([['氏名', '11/1', '2026/11/2', new Date(Date.UTC(2026, 10, 3)), '12/4'], ['A', '早', '日', '遅', '夜']], PERIOD);
  assert.deepEqual(r2.grid.people[0].cells.slice(0, 4), ['早', '日', '遅', '']);
  assert.equal(detectPeriod([['氏名', new Date(Date.UTC(2026, 10, 1))]]), '2026-11');
  assert.match(readShiftTable([['A', 'B']], PERIOD).errors[0], /見出しの行/);
  assert.match(readShiftTable([['氏名', 'x']], PERIOD).errors[0], /日付の列が見つかりません/);
});

// ---- 見本（scripts/gen-shift-sample.mjs）：わざと入れた問題がすべて見つかり、それ以外は出ない ----

const SAMPLE = JSON.parse(readFileSync('public/samples/shift/samples.json', 'utf8'));
const EXPECTED = [
  ['red', 'short', '12日（木） 昼の16〜17時：必要3人に2人（1人不足）'],
  ['red', 'short', '12日（木） 夕の18〜22時：必要2人に1人（1人不足）'],
  ['red', 'short', '14日（土） 朝の7〜9時：必要2人に1人（1人不足）'],
  ['red', 'hope', '渡辺 翔さん 20日（金）：希望休の日に「遅」（遅番）が入っています'],
  ['yellow', 'streak', '小林 さくらさん：17日〜23日に7日の勤務が続きます（7連勤。上限5日）'],
  ['yellow', 'hopeafter', '田中 健太さん 19日（木）：希望休の日が夜勤明けです（前の日に夜勤が入っています）'],
  ['yellow', 'interval', '加藤 誠さん 19日（木）：前の「遅」の終わりから9時間で「早」です（11時間未満・参考）'],
  ['yellow', 'holidays', '小林 さくらさん：月の休日が8日です（下限9日。有給・夜勤明けは数えません）'],
];
const checkSample = (rows) => {
  const { grid, errors } = readShiftTable(rows, SAMPLE.period);
  assert.deepEqual(errors, []);
  assert.equal(grid.people.length, 10);
  const hopes = parseHopes(SAMPLE.hopes, SAMPLE.period);
  assert.deepEqual(hopes.errors, []);
  return { grid, hopes: hopes.list, result: checkShift(grid, { hopes: hopes.list }) };
};

test('見本（CSV）：わざと入れた8件がすべて見つかり、それ以外は出ない', () => {
  const rows = parseCsv(decodeCsvBytes(readFileSync(`public/samples/shift/${SAMPLE.csv}`)));
  const { result } = checkSample(rows);
  assert.deepEqual(result.problems.map((p) => [p.level, p.kind, p.text]), EXPECTED);
});

test('見本（Excel）：題名から年月を読み、人数の集計の行（数式）を読み飛ばして、同じ8件', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(`public/samples/shift/${SAMPLE.xlsx}`);
  const rows = sheetRows(wb.worksheets[0]);
  assert.equal(detectPeriod(rows), '2026-11');
  const { notes } = readShiftTable(rows, SAMPLE.period);
  assert.match(notes[0], /早の人数・日の人数・遅の人数・夜の人数/);
  const { result } = checkSample(rows);
  assert.deepEqual(result.problems.map((p) => [p.level, p.kind, p.text]), EXPECTED);
});

test('Excel を読む：数式は結果、リッチテキストは文字だけ', () => {
  assert.equal(cellValue({ formula: 'A1', result: 3 }), 3);
  assert.equal(cellValue({ richText: [{ text: '早' }, { text: '番' }] }), '早番');
  assert.equal(cellValue({ text: '日', hyperlink: 'x' }), '日');
  assert.equal(cellValue(null), '');
  assert.equal(cellValue({ error: '#N/A' }), '');
});

test('結果の Excel：一覧・人ごと・色を付けたシフト表・使った設定', async () => {
  const rows = parseCsv(decodeCsvBytes(readFileSync(`public/samples/shift/${SAMPLE.csv}`)));
  const { grid, hopes, result } = checkSample(rows);
  const settings = { symbols: DEFAULT_SYMBOLS, needs: DEFAULT_NEEDS, rules: { maxStreak: 5, minHolidays: 9, minRestHours: 11 }, hopes };
  const wb = buildShiftWorkbook(ExcelJS, { grid, result, settings, title: SAMPLE.facility });
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['一覧', '人ごと', 'シフト表', '使った設定']);
  const list = wb.getWorksheet('一覧');
  assert.equal(list.getCell('A2').value, '要確認');
  assert.equal(list.getCell('E2').value, EXPECTED[0][2]);
  assert.equal(list.getCell('A9').value, '注意');
  const per = wb.getWorksheet('人ごと');
  const kob = per.getRow(10);
  assert.deepEqual(kob.values.slice(1, 12), ['小林 さくら', 19, 8, 0, 3, 3, 7, 1, 0, 0, 0]);
  assert.equal(kob.getCell(3).fill.fgColor.argb, 'FFFFF2B3');
  const sh = wb.getWorksheet('シフト表');
  // 12日の見出しは赤（人が足りない）。渡辺さん（6人目＝4+6 行目）の20日は赤で「希望休」のメモ
  assert.equal(sh.getRow(2).getCell(13).fill.fgColor.argb, 'FFF6C9C4');
  const w = sh.getRow(9).getCell(21);
  assert.equal(w.value, '遅');
  assert.equal(w.fill.fgColor.argb, 'FFF6C9C4');
  assert.match(String(w.note), /希望休/);
  // 時間帯の人数の行：12日の夕は1人で赤
  let evening = null;
  sh.eachRow((row) => { if (/^夕/.test(String(row.getCell(1).value))) evening = row; });
  assert.equal(evening.getCell(13).value, 1);
  assert.equal(evening.getCell(13).fill.fgColor.argb, 'FFF6C9C4');
  // 書き出して読み戻せる
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf);
  assert.equal(back.worksheets.length, 4);
});
