// 労務デモ：打刻データ → 残業の集計。CSVはブラウザの中だけで計算する（AIも通信も使わない）。
// 写真（副）だけ、AIで読み取って表にし、確認・修正してから同じ計算に渡す。
import {
  requireAuth, api, h, clear, downloadBlob, XLSX_MIME, stamp, pool, setStep,
} from './common.js';
import { mountEstimate } from './estimate-ui.js';
import { defaultValues } from './estimate.js';
import { toJpeg } from './image.js';
import { decodeCsvBytes, parseCsv, guessColumns, toRecords } from './csv.js';
import {
  calculate, DEFAULT_SETTINGS, LIMITS, STATUS_TEXT, WEEKDAY_LABELS, fmtHM, fmtClock,
} from './overtime.js';
import { buildAttendanceWorkbook } from './attendance-xlsx.js';
import { checkTimecards, breakInfo, toCalcRecord, compareRuns, levelOf as levelAtTc, worstOf as worstTc } from './timecard-check.js';
import { reduced, countUp, stagger, replay, flash, onVisible } from './motion.js';

requireAuth();
const $ = (id) => document.getElementById(id);

// 手計算なら1人あたり何分か（仮置き）。上の「手計算なら約」と下の「御社の場合」で同じ値を使う
let minutesPerPerson = defaultValues('attendance').perPerson;
let elapsedMs = null;
let manualStat = null; // 「手計算なら約」の数字と入力欄（御社の場合から値が変わったときに直す）
const est = mountEstimate($('estimate'), {
  keys: ['attendance'],
  onChange: (_, v) => { if (v.perPerson !== minutesPerPerson) manualStat?.setMinutes(v.perPerson); },
});

const FIELDS = [['name', '氏名'], ['date', '日付'], ['start', '出勤'], ['end', '退勤'], ['breakMin', '休憩（分）']];
const STATUS_BADGE = { yellow: '黄', orange: '橙', red: '赤' };
// 横棒の印に添える短い言葉（色の名前だけでは伝わりにくいので、何時間の線を越えたかも書く。数字は判定と同じ LIMITS から作る）
const STATUS_SHORT = { yellow: `${LIMITS.yellowOver / 60}時間超`, orange: `${LIMITS.orange / 60}時間以上`, red: `${LIMITS.red / 60}時間以上` };
// 「動きを減らす」設定の人には、なめらかなスクロールもしない
const scrollBehavior = () => (reduced() ? 'auto' : 'smooth');

let csvRows = null; // 読み込んだCSV（見出しを含む）
let mapping = null;
let photoRecords = []; // 写真から読み取った行
let source = 'csv';
let result = null;
let periodKey = null;
let selectedName = null;

// ---- 締め日の選択肢 ----------------------------------------------------------------

const closeSel = $('s-close');
closeSel.append(h('option', { value: 'end', selected: true }, '月末'));
for (let d = 5; d <= 28; d += 1) closeSel.append(h('option', { value: String(d) }, `${d}日`));

// ---- タブ ---------------------------------------------------------------------------

function setTab(which) {
  source = which;
  $('tab-csv').setAttribute('aria-selected', String(which === 'csv'));
  $('tab-photo').setAttribute('aria-selected', String(which === 'photo'));
  $('pane-csv').hidden = which !== 'csv';
  $('pane-photo').hidden = which !== 'photo';
  updateCalcState();
}
$('tab-csv').addEventListener('click', () => setTab('csv'));
$('tab-photo').addEventListener('click', () => setTab('photo'));

// ---- CSV ----------------------------------------------------------------------------

function loadCsvBuffer(buf, label) {
  const rows = parseCsv(decodeCsvBytes(buf));
  if (rows.length < 2) { alert('データの行が見つかりませんでした。'); return; }
  csvRows = rows;
  mapping = guessColumns(rows[0]);
  $('csvinfo').textContent = `${label}：${rows.length - 1}行を読み込みました。列の対応を確認してください。`;
  renderMapping();
  stagger($('preview').tBodies[0]); // 読み込んだ行が、上から順に入ってくる
  if (!$('mapbox').hidden) flash($('csvinfo')); // 読み込み直したときは、変わった所を光らせる
  $('mapbox').hidden = false;
  updateCalcState();
}

function renderMapping() {
  const grid = clear($('mapgrid'));
  for (const [key, label] of FIELDS) {
    const sel = h('select', { onchange: (e) => { mapping[key] = Number(e.target.value); renderPreview(); updateCalcState(); } },
      h('option', { value: '-1' }, key === 'breakMin' ? '（なし：既定値を使う）' : '（選択してください）'),
      csvRows[0].map((name, i) => h('option', { value: String(i), selected: mapping[key] === i }, name || `列${i + 1}`)));
    grid.append(h('label', {}, label, sel));
  }
  renderPreview();
}

function renderPreview() {
  const t = clear($('preview'));
  t.append(h('thead', {}, h('tr', {}, FIELDS.map(([, l]) => h('th', {}, l)))));
  const body = h('tbody');
  for (const r of csvRows.slice(1, 6)) {
    body.append(h('tr', {}, FIELDS.map(([k]) => h('td', {}, mapping[k] >= 0 ? (r[mapping[k]] ?? '') : ''))));
  }
  t.append(body);
}

$('csvfile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) loadCsvBuffer(await f.arrayBuffer(), f.name);
});
$('sample').addEventListener('click', async () => {
  const res = await fetch('/sample/attendance-sample-2026-09.csv');
  loadCsvBuffer(await res.arrayBuffer(), 'サンプル（架空の5人×2026年9月）');
});

// ---- 写真（副） ---------------------------------------------------------------------
// AIは読むだけ。表の確かめ（赤・黄）は timecard-check.js、集計は overtime.js（直す前と直した後を同じ計算で並べる）

const MAX_PHOTOS = 10;
const READ_LABELS = { pending: '待ち', reading: '読み取り中', done: '済', error: '読めず' };
let photoFiles = []; // [{file, name, sample, state}]
let photoOriginal = []; // AIが読んだまま（直す前）。行を直しても変えない
let tcSamples = [];
let photoReading = false;
const tcLoading = new Set();
const lastMonth = new Date(); lastMonth.setDate(1); lastMonth.setMonth(lastMonth.getMonth() - 1);
$('period').value = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
const pmsg = (t) => { $('ptext').textContent = t; };
const ymLabel = (v) => `${+v.slice(0, 4)}年${+v.slice(5, 7)}月`;

/** @param focusAfter 外したあとにキーボードの位置を移す先（無ければ「写真を選ぶ」） */
function renderPhotoFiles(focusAfter = null) {
  const box = clear($('pfiles'));
  photoFiles.forEach((f, i) => box.append(h('li', { dataset: { state: f.state || '' } },
    h('span', {}, f.sample ? `見本：${f.name}` : f.name),
    f.state ? h('span', { class: 'pst' }, READ_LABELS[f.state]) : null,
    h('button', {
      type: 'button', class: 'link', 'aria-label': `${f.name}を外す`, disabled: photoReading,
      onclick: () => { photoFiles = photoFiles.filter((x) => x !== f); renderPhotoFiles(i); },
    }, '外す'))));
  $('readphotos').disabled = photoFiles.length === 0 || photoReading;
  $('photofile').disabled = photoReading;
  for (const b of $('tc-samples').querySelectorAll('button.sample')) {
    b.setAttribute('aria-pressed', String(photoFiles.some((x) => x.sample === b.dataset.id)));
    b.disabled = photoReading;
  }
  const all = $('tc-samples').querySelector('.sample-all');
  if (all) { all.hidden = tcSamples.every((x) => photoFiles.some((y) => y.sample === x.id)); all.disabled = photoReading; }
  // 外したあと：次の「外す」か、無ければ「写真を選ぶ」へ（ページの先頭に飛ばない）
  if (focusAfter != null) {
    const btns = box.querySelectorAll('button');
    (btns[Math.min(focusAfter, btns.length - 1)] ?? $('photofile')).focus();
  }
}

async function addTcSample(s) {
  if (photoReading || tcLoading.has(s.id) || photoFiles.some((x) => x.sample === s.id)) return;
  if (photoFiles.length >= MAX_PHOTOS) { pmsg(`1回に読み取れるのは${MAX_PHOTOS}枚までです`); return; }
  tcLoading.add(s.id);
  try {
    const res = await fetch(`/samples/timecards/${s.file}`);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    if (!photoFiles.some((x) => x.sample === s.id)) photoFiles.push({ file: new File([blob], s.file, { type: 'image/jpeg' }), name: s.label.replace(/：.*$/, ''), sample: s.id });
    // 見本は 2026年9月分。年月を変えたときは、黙って変えずに知らせる
    if ($('period').value !== s.period) {
      $('period').value = s.period;
      pmsg(`見本に合わせて、対象の年月を${ymLabel(s.period)}にしました`);
      if (photoRecords.length) refreshPhoto();
    } else pmsg('');
  } catch {
    pmsg('見本を読み込めませんでした。再読み込みしてお試しください');
  } finally {
    tcLoading.delete(s.id);
  }
  renderPhotoFiles();
}

/** 見本の札は1回だけ作る（押すたびに作り直すと、キーボードの位置が外れるため）。押すと入る・もう一度押すと外れる */
async function loadTcSamples() {
  try {
    const res = await fetch('/samples/timecards/samples.json');
    tcSamples = res.ok ? (await res.json()).samples : [];
  } catch { tcSamples = []; }
  const box = clear($('tc-samples'));
  for (const s of tcSamples) {
    box.append(h('button', {
      type: 'button', class: 'sample', 'aria-pressed': 'false', dataset: { id: s.id },
      onclick: () => {
        if (tcLoading.has(s.id) || photoReading) return;
        const cur = photoFiles.find((x) => x.sample === s.id);
        if (cur) { photoFiles = photoFiles.filter((x) => x !== cur); renderPhotoFiles(); } else addTcSample(s);
      },
    },
    h('img', { src: `/samples/timecards/${s.file}`, alt: '', loading: 'lazy' }),
    h('span', { class: 'sample-name' }, s.label.replace(/：.*$/, ''), h('small', {}, s.label.replace(/^.*?：/, ''))),
    h('span', { class: `badge ${s.kind === '印字' ? 'gray' : 'yellow'}` }, s.kind)));
  }
  if (tcSamples.length) {
    box.append(h('button', {
      type: 'button', class: 'link sample-all',
      onclick: async () => {
        for (const s of tcSamples) if (!photoFiles.some((x) => x.sample === s.id)) await addTcSample(s);
        $('readphotos').focus(); // このボタンは隠れるので、次に押す「読み取る」へ
      },
    }, '見本を3枚とも入れる'));
  }
  renderPhotoFiles();
}
loadTcSamples();

$('photofile').addEventListener('change', (e) => {
  const room = MAX_PHOTOS - photoFiles.length;
  const picked = [...e.target.files].filter((f) => f.type.startsWith('image/'));
  for (const f of picked.slice(0, room)) photoFiles.push({ file: f, name: f.name, sample: '' });
  pmsg(picked.length > room ? `1回に読み取れるのは${MAX_PHOTOS}枚までです` : '');
  e.target.value = '';
  renderPhotoFiles();
});

/** AIの答え（1日分）→ 画面の行 */
const fromEntry = (name, e) => ({
  name, date: e.date, start: e.start, end: e.end, out: e.out ?? '', back: e.back ?? '', breakMin: e.break_min ?? '',
  startAlt: e.start_alt ?? '', endAlt: e.end_alt ?? '', conf: { start: '高', end: '高', out: '高', back: '高', ...(e.conf ?? {}) }, note: e.note ?? '',
});

$('readphotos').addEventListener('click', async () => {
  if (photoReading || !photoFiles.length) return;
  // 読み取り中は、写真を足す・外す・もう一度読むを止める（あとから古い結果が表を上書きしないように）
  photoReading = true;
  const files = [...photoFiles];
  files.forEach((f) => { f.state = 'pending'; });
  renderPhotoFiles();
  $('pprog').hidden = false;
  let done = 0; const failed = [];
  const out = new Array(files.length);
  const upd = () => { $('pbar').style.width = `${(done / files.length) * 100}%`; pmsg(`${done} / ${files.length} 枚を読み取りました`); };
  upd();
  await pool(files, 3, async (f, i) => {
    f.state = 'reading'; renderPhotoFiles();
    try {
      const { base64 } = await toJpeg(f.file);
      out[i] = await api('/api/timecard', { image: base64, period: $('period').value, sample: f.sample });
      f.state = 'done';
    } catch (e) { failed.push(`${f.name}：${e.message}`); f.state = 'error'; }
    done++; upd(); renderPhotoFiles();
  });
  // 読み取りのたびに、表を作り直す（前の結果に足さない。足すと同じ日が2行になる）
  photoRecords = [];
  for (const d of out) if (d) for (const e of d.entries) photoRecords.push(fromEntry(d.employee_name, e));
  photoOriginal = photoRecords.map((r) => structuredClone(r));
  photoReading = false;
  $('pprog').hidden = true;
  const msgs = [];
  if (failed.length) msgs.push(`読み取れなかった写真：${failed.join(' ／ ')}`);
  if (!photoRecords.length) msgs.push('読み取れた行がありません。写真を確かめるか、下の「＋ 行を追加」で手で入れてください');
  pmsg(msgs.join('。') || `${files.length}枚を読み取りました`);
  renderPhotoFiles();
  renderPhotoRows();
});

const PHOTO_COLS = [['name', '氏名', 120], ['date', '日付', 116], ['start', '出勤', 76], ['out', '外出', 76], ['back', '戻り', 76], ['end', '退勤', 76], ['breakMin', '休憩（分）', 70]];
const CONF_FIELDS = ['start', 'end', 'out', 'back'];

/** 二重打刻の欄の、もう1つの時刻を消す（人が決めた）。選ぶボタンもその場で外す */
function resolveAlt(r, key, cell) {
  if (key === 'start') r.startAlt = ''; else r.endAlt = '';
  r.conf[key] = '高';
  cell.querySelector('.alts')?.remove();
}

/** @param focus {row, key}：作り直したあとに、キーボードの位置を移す欄 */
function renderPhotoRows(focus = null) {
  $('photobox').hidden = false;
  const body = clear($('photorows'));
  photoRecords.forEach((r, i) => {
    const td = (key, label, w) => {
      const cell = h('td', { dataset: { label, f: key } });
      const input = h('input', {
        type: 'text', value: r[key] ?? '', 'aria-label': `${i + 1}行目の${label}`, style: { minWidth: `${w}px` },
        inputMode: key === 'breakMin' ? 'numeric' : undefined,
        oninput: (e) => {
          r[key] = e.target.value;
          // 人が直した時刻は、読み取りの自信のなさの印を消す。二重打刻の欄を手で直したら、それで決まり
          if (CONF_FIELDS.includes(key)) r.conf[key] = '高';
          if ((key === 'start' && r.startAlt) || (key === 'end' && r.endAlt)) resolveAlt(r, key, cell);
          refreshPhoto();
        },
      });
      cell.append(input);
      // 二重打刻：どちらの時刻にするかを、人が選ぶ（作り直さずに、その場で入れる）
      const alt = key === 'start' ? r.startAlt : key === 'end' ? r.endAlt : '';
      if (alt) {
        cell.append(h('span', { class: 'alts', role: 'group', 'aria-label': `${label}の二重打刻` },
          [r[key], alt].filter(Boolean).map((t) => h('button', {
            type: 'button', class: 'small',
            onclick: () => { r[key] = t; input.value = t; resolveAlt(r, key, cell); input.focus(); refreshPhoto(); },
          }, `${t} にする`))));
      }
      if (key === 'breakMin') cell.append(h('small', { class: 'calc' }));
      return cell;
    };
    body.append(h('tr', {},
      ...PHOTO_COLS.map(([k, label, w]) => td(k, label, w)),
      h('td', { class: 'rowflag', dataset: { label: '確かめる点', f: 'row' } }, h('div', { class: 'flags' })),
      h('td', { class: 'nolabel' }, h('button', {
        type: 'button', class: 'small', 'aria-label': `${i + 1}行目を削除`,
        onclick: () => { photoRecords.splice(i, 1); renderPhotoRows({ row: i, key: 'name' }); },
      }, '削除'))));
  });
  applyPhotoFilter();
  refreshPhoto();
  if (focus) {
    const rows = [...$('photorows').children].filter((tr) => !tr.hidden);
    const tr = rows[Math.min(focus.row, rows.length - 1)];
    (tr?.querySelector(`td[data-f=${focus.key}] input`) ?? $('addrow')).focus();
  }
}
$('addrow').addEventListener('click', () => {
  photoRecords.push({ name: photoRecords.at(-1)?.name ?? '', date: '', start: '', end: '', out: '', back: '', breakMin: '', startAlt: '', endAlt: '', conf: { start: '高', end: '高', out: '高', back: '高' }, note: '' });
  renderPhotoRows();
  $('photorows').lastElementChild?.querySelector('input')?.focus();
});

const checkOpts = () => ({ period: $('period').value, closeDay: readSettings().closeDay });

/**
 * 「確かめる点のある行だけ出す」：表を作ったとき・印を変えたときだけ絞る
 * （直してOKになった行は、その場では消さない。消えると、どこを直したか分からなくなるため）
 */
function applyPhotoFilter() {
  const only = $('onlyflagged').checked;
  const checks = checkTimecards(photoRecords, checkOpts());
  [...$('photorows').children].forEach((tr, i) => {
    const r = photoRecords[i];
    if (checks[i]?.flags.length) r.keep = true; // 一度出した行は、直してOKになっても出したままにする
    tr.hidden = only && !r.keep;
  });
}
$('onlyflagged').addEventListener('change', () => { applyPhotoFilter(); refreshPhoto(); });

const statusWord = (st) => (st && st !== 'none' ? `${STATUS_BADGE[st]}（${STATUS_SHORT[st]}）` : 'なし');

/** 入力のたびに確かめ直して、色と指摘、直す前→直した後だけ書き換える（入力欄は作り直さない） */
function refreshPhoto() {
  const checks = checkTimecards(photoRecords, checkOpts());
  const only = $('onlyflagged').checked;
  let red = 0; let yellow = 0;
  [...$('photorows').children].forEach((tr, i) => {
    const r = photoRecords[i]; const c = checks[i];
    if (!r || !c) return;
    // あとから赤・黄になった行は、絞っていても出す（隠れたままにしない）
    if (c.flags.length) { r.keep = true; if (only) tr.hidden = false; }
    for (const td of tr.querySelectorAll('td[data-f]')) {
      if (td.dataset.f === 'row') continue;
      const lv = levelAtTc(c.flags, td.dataset.f);
      td.classList.toggle('red', lv === 'red'); td.classList.toggle('yellow', lv === 'yellow');
    }
    // 休憩の決まり方を、その場に出す（戻り−外出で計算したときだけ「戻り−外出」と書く）
    const bi = breakInfo(r);
    tr.querySelector('small.calc').textContent = bi.source === 'outback' ? `${bi.value}分（戻り−外出）` : bi.source === 'default' ? `空なら既定の${readSettings().defaultBreakMin}分` : '';
    const box = clear(tr.querySelector('.flags'));
    for (const f of c.flags) box.append(h('span', { class: `flag ${f.level}` }, f.message));
    if (!c.flags.length) box.append(h('span', { class: 'badge ok' }, 'OK'));
    const w = worstTc(c.flags);
    if (w === 'red') red++; else if (w === 'yellow') yellow++;
  });
  const shown = [...$('photorows').children].filter((tr) => !tr.hidden).length;
  $('psummary').textContent = `${photoRecords.length}行：要確認（赤）${red}行／注意（黄）${yellow}行${shown < photoRecords.length ? `（いま出しているのは${shown}行）` : ''}`;
  renderPhotoDiff();
  updateCalcState();
}

/**
 * 直す前（AIが読んだまま）→ 直した後（いまの表）。時間外と判定を、人×集計期間ごとに、同じ計算エンジンで並べる。
 * 表は作り直さず、変わった所だけ書き換える。読み上げは、変わった人の短い文だけ
 */
function renderPhotoDiff() {
  const box = $('photodiff');
  const rows = compareRuns(photoOriginal, photoRecords, readSettings());
  if (!rows.length) { clear(box); box.hidden = true; return; }
  box.hidden = false;
  let body = box.querySelector('tbody');
  if (!body) {
    body = h('tbody');
    clear(box).append(
      // 判定は目安（安全の表示）。表より先に、動かさずに出す
      h('p', { class: 'notice plain' }, '判定は目安です。法的な判断は、社労士の先生にご確認ください。'),
      h('p', { class: 'small-note' }, '表を直すたびに、同じ計算で集計し直します（AIは計算しません）。'),
      h('table', { class: 'diff' },
        h('thead', {}, h('tr', {}, h('th', {}, '氏名・月'), h('th', {}, '時間外（直す前 → 直した後）'), h('th', {}, '判定（直す前 → 直した後）'))),
        body),
      h('p', { class: 'sr', 'aria-live': 'polite', id: 'photodiff-live' }));
  }
  const hm = (x) => (x ? fmtHM(x.overMin) : '—');
  const multi = new Set(rows.map((x) => x.period)).size > 1;
  const keep = new Set();
  const spoken = [];
  for (const x of rows) {
    const key = `${x.name}|${x.period}`;
    keep.add(key);
    const changed = hm(x.before) !== hm(x.after) || x.before?.status !== x.after?.status;
    const texts = [multi ? `${x.name}（${x.label}）` : x.name, `${hm(x.before)} → ${hm(x.after)}`, `${statusWord(x.before?.status)} → ${statusWord(x.after?.status)}`];
    let tr = [...body.children].find((t) => t.dataset.key === key);
    if (!tr) {
      tr = h('tr', { dataset: { key } },
        h('td', { dataset: { label: '' } }), h('td', { class: 'num', dataset: { label: '時間外（直す前 → 直した後）' } }), h('td', { dataset: { label: '判定（直す前 → 直した後）' } }, h('span'), h('b', { class: 'chg' })));
      body.append(tr);
    }
    const [c1, c2, c3] = tr.children;
    const before = `${c2.textContent}|${c3.firstChild.textContent}`;
    c1.textContent = texts[0]; c2.textContent = texts[1]; c3.firstChild.textContent = texts[2];
    c3.lastChild.textContent = changed ? '変わりました' : '';
    tr.classList.toggle('changed', changed);
    if (tr.dataset.seen && before !== `${texts[1]}|${texts[2]}`) { flash(tr); spoken.push(`${texts[0]}：時間外 ${texts[1]}、判定 ${texts[2]}`); }
    tr.dataset.seen = '1';
  }
  for (const tr of [...body.children]) if (!keep.has(tr.dataset.key)) tr.remove();
  if (spoken.length) $('photodiff-live').textContent = spoken.join('。');
}

// 設定（所定労働時間・休憩・締め日など）・対象の年月を変えたら、確かめ直す
for (const id of ['s-sched', 's-break', 's-holiday', 's-close', 'period']) {
  $(id).addEventListener('change', () => { if (photoRecords.length) { applyPhotoFilter(); refreshPhoto(); } });
}

// ---- 計算 ---------------------------------------------------------------------------

function currentRecords() {
  if (source === 'photo') return photoRecords.map(toCalcRecord);
  if (!csvRows) return [];
  return toRecords(csvRows, mapping, true);
}

function updateCalcState() {
  const ready = source === 'csv'
    ? csvRows && mapping.name >= 0 && mapping.date >= 0 && mapping.start >= 0 && mapping.end >= 0
    : photoRecords.length > 0;
  $('calc').disabled = !ready;
  $('calc-hint').textContent = ready ? '' : (source === 'csv' ? '先にCSVを選んでください（氏名・日付・出勤・退勤の列が必要です）' : '先に写真を読み取ってください');
}

function readSettings() {
  const sched = Number($('s-sched').value); const br = Number($('s-break').value);
  return {
    scheduledMin: Number.isFinite(sched) && sched > 0 ? Math.round(sched * 60) : DEFAULT_SETTINGS.scheduledMin,
    defaultBreakMin: Number.isFinite(br) && br >= 0 ? Math.round(br) : DEFAULT_SETTINGS.defaultBreakMin,
    holidayWeekday: Number($('s-holiday').value),
    closeDay: closeSel.value === 'end' ? 'end' : Number(closeSel.value),
  };
}

$('calc').addEventListener('click', () => {
  const t0 = performance.now();
  result = calculate(currentRecords(), readSettings());
  elapsedMs = performance.now() - t0;
  $('result').hidden = false;
  $('step3').hidden = false;

  setStep(2);
  if (!result.periods.length) {
    periodKey = null;
    renderErrors();
    clear($('bars')); clear($('summary-table')); clear($('detail')); clear($('stats')); clear($('who')); $('detail-title').textContent = '';
    $('chart').hidden = true; $('daily').hidden = true;
    $('export').disabled = true;
    $('step3').hidden = true;

    return;
  }
  $('export').disabled = false;
  $('chart').hidden = false; $('daily').hidden = false;
  const sel = clear($('period-select'));
  result.periods.forEach((p) => sel.append(h('option', { value: p.key }, p.label)));
  // 人数の多い期間を既定に
  periodKey = result.periods.reduce((a, b) => (b.people.length >= a.people.length ? b : a)).key;
  sel.value = periodKey;
  $('period-label').hidden = result.periods.length < 2;
  selectedName = null;
  render();
  $('result').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
});
$('period-select').addEventListener('change', (e) => { periodKey = e.target.value; selectedName = null; render(); });

const period = () => result.periods.find((p) => p.key === periodKey);

function renderErrors() {
  const box = clear($('errors'));
  if (!result.errors.length) return;
  const hard = result.errors.filter((e) => !e.warning).length;
  box.append(h('div', { class: 'notice' },
    `${hard ? `${hard}行は読み取れず、計算に入れていません。` : ''}${result.errors.length - hard ? `${result.errors.length - hard}件の注意があります。` : ''}`,
    h('ul', { class: 'errs' }, result.errors.slice(0, 20).map((e) => h('li', {}, `${e.row}行目：${e.message}`))),
    result.errors.length > 20 ? `ほか${result.errors.length - 20}件` : null));
}

function renderStats(p) {
  const box = clear($('stats'));
  // 数字は0から数え上げる。終わりの表示は、数え上げない場合とまったく同じ文字になる。
  // Text ノードにも textContent があるので、単位の <small> を消さずに数字だけを動かせる
  const exact = (to) => (n) => (n === to ? String(to) : String(Math.round(n)));
  const num = (to) => { const t = document.createTextNode('0'); countUp(t, to, { format: exact(to) }); return t; };
  const stat = (label, value, unit, cls = '', extra = null) => h('div', { class: `stat ${cls}` }, h('span', {}, label), h('b', {}, value, h('small', {}, unit)), extra);
  const near = p.people.filter((x) => x.status !== 'none').length;
  const manual = num(p.people.length * minutesPerPerson);
  const mins = h('input', {
    type: 'number', min: '0', max: '240', step: '1', value: String(minutesPerPerson), inputMode: 'numeric', 'aria-label': '1人分の手計算の分',
    onchange: (e) => { setMinutes(est.set('attendance', 'perPerson', Math.max(0, Number(e.target.value) || 0))); },
  });
  // 表を作り直さず、変わった数字だけを前の値から動かす（ほかの数字まで数え直すと、何が変わったか分からなくなる）
  function setMinutes(n) {
    const before = p.people.length * minutesPerPerson;
    minutesPerPerson = n;
    mins.value = String(n);
    const to = p.people.length * minutesPerPerson;
    countUp(manual, to, { from: before, format: exact(to) });
    flash(manual.parentElement);
  }
  manualStat = { setMinutes };
  box.append(
    stat('集計した人数', num(p.people.length), '人', 'quiet'),
    stat('打刻の行数', num(p.people.reduce((t, x) => t + x.days.length, 0)), '行', 'quiet'),
    // 「プログラムなら／手計算なら」を1つの面に並べて、比べて読めるようにする。かかった時間は測ったままを出す（動かさない）
    h('div', { class: 'vs' },
      stat('計算にかかった時間', elapsedMs < 1000 ? '1秒未満' : (elapsedMs / 1000).toFixed(1), elapsedMs < 1000 ? '' : '秒', 'good'),
      stat('手計算なら約', manual, '分', '', h('em', {}, h('span', { class: 'nw' }, '1人 ', mins, ' 分'), '（仮置き）'))),
    // 上限に近い人の数は、安全の表示なので数え上げない（0 → 1 → 2 と増えると、横棒の印とずれる）。はじめから本当の数を出す
    stat('上限に近い人（黄・橙・赤）', String(near), '人', near ? 'warn' : ''),
  );
  stagger(box);
}

function render() {
  renderErrors();
  const p = period();
  renderStats(p);
  selectedName = selectedName ?? p.people[0]?.name;
  renderBars(p);
  renderSummary(p);
  renderWho(p);
  renderDetail(p);
}

// 横棒は、見える所に来てから伸ばす（スマホでは計算の直後は画面の外にあるため。見えない所で伸び終わると意味がない）
let stopWaitingBars = () => {};
function playBars(box, counts) {
  stopWaitingBars();
  const go = () => { box.classList.remove('wait'); replay(box); counts.forEach((f) => f()); };
  const r = box.getBoundingClientRect();
  if (reduced() || (r.top < window.innerHeight && r.bottom > 0)) { go(); return; }
  box.classList.add('wait'); // 伸びる前の形で待つ（数字と判定の印は、待っている間も出ている）
  stopWaitingBars = onVisible(box, go, { threshold: 0 });
}

function renderBars(p) {
  const max = Math.max(LIMITS.red * 1.08, ...p.people.map((x) => x.overPlusHolidayMin));
  const pct = (m) => `${(m / max) * 100}%`;
  const axis = clear($('axis'));
  for (const [m, label] of [[0, '0'], [LIMITS.yellowOver, '45h'], [LIMITS.orange, '80h'], [LIMITS.red, '100h']]) {
    axis.append(h('span', { style: { left: pct(m) } }, label));
  }
  const box = clear($('bars'));
  // 棒の背景の色分け（style.css の .track）を、点線・目盛りと同じ位置に合わせる。目盛りの幅は人によって変わるので毎回入れる
  box.style.setProperty('--z45', pct(LIMITS.yellowOver));
  box.style.setProperty('--z80', pct(LIMITS.orange));
  box.style.setProperty('--z100', pct(LIMITS.red));
  const counts = [];
  p.people.forEach((x, n) => {
    const order = Math.min(n, 12); // 上から順に伸びる。人数が多いときは、13人目から先は待たせない
    const seg = (cls, m, title) => {
      const el = h('div', { class: `seg grow ${cls}`, style: { width: pct(m) }, title });
      el.style.setProperty('--i', String(order));
      return el;
    };
    // 棒が伸びるのに合わせて、時間の数字も数え上げる（終わりは fmtHM の表示と同じ）。
    // 黄・橙・赤の人は、印が先に出ているので数え上げない（印より小さい数字が並ぶのを避ける）
    const hm = (min) => {
      const t = document.createTextNode(fmtHM(min));
      if (x.status === 'none') counts.push(() => countUp(t, min, { duration: 900 + order * 70, format: (v) => fmtHM(Math.round(v)) }));
      return t;
    };
    const track = h('div', { class: 'track' },
      seg(`hol ${x.status}`, x.overPlusHolidayMin, '休日労働を含む'),
      seg(x.status, x.overMin),
      h('span', { class: 'mark m45', style: { left: pct(LIMITS.yellowOver) } }),
      h('span', { class: 'mark m80', style: { left: pct(LIMITS.orange) } }),
      h('span', { class: 'mark m100', style: { left: pct(LIMITS.red) } }));
    box.append(h('button', {
      type: 'button', class: `bar-row ${x.status}`, dataset: { name: x.name }, 'aria-pressed': String(x.name === selectedName),
      onclick: () => { select(x.name); revealDetail(); },
    },
    h('span', { class: 'bar-name' }, x.name),
    track,
    h('span', { class: 'bar-val' },
      h('span', { class: 'hm' }, '時間外 ', hm(x.overMin), x.holidayMin ? [' ＋ 休日 ', hm(x.holidayMin)] : null, ' '),
      x.status !== 'none' ? h('span', { class: `badge ${x.status}` }, STATUS_BADGE[x.status], h('small', {}, STATUS_SHORT[x.status])) : null,
      x.streakFlag ? h('span', { class: 'badge streak' }, `${x.maxStreak}連勤`) : null)));
  });
  playBars(box, counts);
}

// ---- 人を選ぶ（横棒からも、日別表の上の名前からも選べる） -----------------------------

function select(name) {
  selectedName = name;
  // 横棒は作り直さない（作り直すと、押すたびに全部の棒が伸び直してしまう）。選んだ印だけを付け替える
  for (const b of document.querySelectorAll('#bars .bar-row, #who button')) b.setAttribute('aria-pressed', String(b.dataset.name === name));
  const who = $('who');
  const chip = who.querySelector('[aria-pressed=true]');
  if (chip && (chip.offsetLeft < who.scrollLeft || chip.offsetLeft + chip.offsetWidth > who.scrollLeft + who.clientWidth)) who.scrollLeft = chip.offsetLeft - 8;
  renderDetail(period());
  flash($('detail-title')); // 日別表が入れ替わったことを、見出しを光らせて知らせる
}

/** 日別表を見える所へ。すでに画面の上半分に見えているときは動かさない */
function revealDetail() {
  const el = $('daily');
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight * 0.5) return;
  el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

function renderWho(p) {
  const box = clear($('who'));
  for (const x of p.people) {
    box.append(h('button', { type: 'button', dataset: { name: x.name }, 'aria-pressed': String(x.name === selectedName), onclick: () => select(x.name) },
      x.name, x.status !== 'none' ? h('span', { class: `badge ${x.status}` }, STATUS_BADGE[x.status]) : null));
  }
}

function renderSummary(p) {
  const t = clear($('summary-table'));
  t.append(h('thead', {}, h('tr', {}, ['氏名', '出勤日数', '実労働', '時間外', '深夜', '休日労働', '時間外＋休日', '週40h超（参考）', '連続勤務', '判定'].map((l, i) => h('th', { class: i && i < 9 ? 'num' : '' }, l)))));
  const body = h('tbody');
  for (const x of p.people) {
    const td = (label, v, cls = '') => h('td', { dataset: { label }, class: cls }, v);
    body.append(h('tr', {},
      td('氏名', x.name), td('出勤日数', `${x.workDays}日`, 'num'), td('実労働', fmtHM(x.workMin), 'num'), td('時間外', fmtHM(x.overMin), 'num'),
      td('深夜', fmtHM(x.nightMin), 'num'), td('休日労働', fmtHM(x.holidayMin), 'num'), td('時間外＋休日', fmtHM(x.overPlusHolidayMin), 'num'),
      td('週40h超（参考）', fmtHM(x.weeklyOverMin), 'num'),
      td('連続勤務', x.streakFlag ? h('span', { class: 'badge streak' }, `${x.maxStreak}日（6日以上）`) : `${x.maxStreak}日`, 'num'),
      td('判定', x.status === 'none' ? '—' : h('span', { class: `badge ${x.status}` }, STATUS_TEXT[x.status]))));
  }
  t.append(body);
}

function renderDetail(p) {
  const x = p.people.find((q) => q.name === selectedName) ?? p.people[0];
  const t = clear($('detail'));
  if (!x) { $('detail-title').textContent = ''; return; }
  $('detail-title').textContent = `${x.name} さんの日別（${p.label}）`;
  t.append(h('thead', {}, h('tr', {}, ['日付', '曜日', '出勤', '退勤', '休憩', '実労働', '時間外', '深夜', '休日労働', '備考'].map((l) => h('th', {}, l)))));
  const body = h('tbody');
  for (const d of x.days) {
    const notes = [d.crossesMidnight ? '日またぎ' : '', d.isHoliday ? '法定休日' : '', d.breakDefaulted ? '休憩は既定値' : '', d.streak >= 6 ? `${d.streak}連勤の一部` : ''].filter(Boolean).join('・');
    const td = (label, v, cls = '') => h('td', { dataset: { label }, class: cls }, v);
    body.append(h('tr', { class: d.isHoliday ? 'holiday' : '' },
      td('日付', d.date), td('曜日', WEEKDAY_LABELS[d.weekday]), td('出勤', fmtClock(d.start)), td('退勤', `${d.end >= 1440 ? '翌' : ''}${fmtClock(d.end)}`),
      td('休憩', `${d.breakMin}分`), td('実労働', fmtHM(d.workMin)), td('時間外', d.overMin ? fmtHM(d.overMin) : '—'),
      td('深夜', d.nightMin ? fmtHM(d.nightMin) : '—'), td('休日労働', d.holidayMin ? fmtHM(d.holidayMin) : '—'), td('備考', notes)));
  }
  t.append(stagger(body, 10)); // 日ごとの行が、上から順に入ってくる
}

// ---- Excel --------------------------------------------------------------------------

$('export').addEventListener('click', async () => {
  if (!window.ExcelJS) { alert('Excelの部品を読み込めませんでした。再読み込みしてお試しください。'); return; }
  const wb = buildAttendanceWorkbook(window.ExcelJS, period(), result.settings);
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), `残業の集計_${period().key.replace('-', '')}_${stamp()}.xlsx`);
  setStep(4);
});

updateCalcState();
setStep(1);
