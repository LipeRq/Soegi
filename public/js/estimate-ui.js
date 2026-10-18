// 「御社の場合」の画面の部品。入力 → 結果 → 浮いた時間の使い道 → 持ち帰り1枚（印刷）。
// 何も保存しない（入力は画面を閉じれば消える。localStorage も使わない）。計算は estimate.js。
import { h, clear, downloadBlob, XLSX_MIME, stamp } from './common.js';
import { buildRecordWorkbook } from './record-xlsx.js';
import { flash } from './motion.js';
import {
  DEMOS, INDUSTRIES, HOUR_VALUES, DEFAULT_HOUR_VALUE, DISCLAIMER, defaultValues, calcEstimate, verdictText, buildTakeaway,
} from './estimate.js';

const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const man = (n) => (n % 10000 === 0 ? `${(n / 10000).toLocaleString('ja-JP')}万円` : yen(n));
const today = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const QR_SRC = '/img/qr-withsoegi.svg';
let seq = 0;
let qrReady = null; // 持ち帰り1枚の QR。印刷の前に読み込んでおく（読み込む前に印刷すると白く抜けるため）
const preloadQr = () => {
  qrReady ??= new Promise((ok) => { const img = new Image(); img.onload = ok; img.onerror = ok; img.src = QR_SRC; });
  return qrReady;
};

/**
 * @param box 入れ物（section.card など）
 * @param opts {keys:['receipt'] | ['knowledge','foreign'], initialKey?, onChange?(key, values), extraActions?: Node[]}
 * @returns {{set(key, name, value): number, get(key), select(key)}}
 */
export function mountEstimate(box, opts) {
  const keys = opts.keys;
  const id = `est${++seq}`;
  const first = keys.includes(opts.initialKey) ? opts.initialKey : keys[0];
  const state = {
    key: first,
    values: Object.fromEntries(keys.map((k) => [k, defaultValues(k)])),
    hourValue: DEFAULT_HOUR_VALUE,
    industry: DEMOS[first].industry,
    industryChosen: false, // 人が業種を選んだら、札を切り替えても業種を変えない
    use: '',
  };
  preloadQr();

  box.classList.add('est');
  const inputsBox = h('div', { class: 'est-in' });
  const resBox = h('div', { class: 'est-res', 'aria-live': 'polite' });
  const useBox = h('div', { class: 'est-use' });
  const switcher = keys.length > 1
    ? h('div', { class: 'est-switch', role: 'group', 'aria-label': '試算する内容' },
      keys.map((k) => h('button', {
        type: 'button', 'aria-pressed': String(k === state.key), dataset: { key: k },
        onclick: () => selectKey(k),
      }, DEMOS[k].name.replace(/（.*$/, ''))))
    : null;
  const printBtn = h('button', { type: 'button', onclick: printTakeaway }, '持ち帰り1枚を印刷する');
  const recordBtn = h('button', { type: 'button', onclick: downloadRecord }, '1週間の記録表をダウンロード');
  const recordMsg = h('p', { class: 'small-note', role: 'status' });

  // append は null を「null」という文字にしてしまうので、無い部品は外してから入れる
  clear(box).append(...[
    h('h2', { id: `${id}-h` }, '御社の場合（試算）'),
    // 安全表示（約束ではない）は、入力より前に、動かさずに出す
    h('p', { class: 'notice' }, DISCLAIMER),
    switcher,
    h('div', { class: 'est-grid' }, inputsBox, resBox),
    useBox,
    h('div', { class: 'row est-actions' }, printBtn, recordBtn, ...(opts.extraActions ?? []),
      h('p', { class: 'small-note' }, 'PDFで残すときは、印刷の画面で、送り先（プリンター）の代わりに「PDF」を選んでください。名前は端末によって違います。入れた数字は保存しません（画面を閉じると消えます）。')),
    recordMsg,
  ].filter(Boolean));
  box.setAttribute('aria-labelledby', `${id}-h`);

  // ---- 入力 -------------------------------------------------------------------------

  const fields = {};
  function renderInputs() {
    const d = DEMOS[state.key];
    const v = state.values[state.key];
    clear(inputsBox);
    for (const i of d.inputs) {
      const input = h('input', {
        type: 'number', min: String(i.min), max: String(i.max), step: String(i.step), value: String(v[i.key]),
        inputMode: i.step < 1 ? 'decimal' : 'numeric', id: `${id}-${i.key}`,
        oninput: (e) => { v[i.key] = e.target.value; update(); opts.onChange?.(state.key, calcEstimate(state.key, v).values); },
        onchange: (e) => { const n = calcEstimate(state.key, v).values[i.key]; v[i.key] = n; e.target.value = String(n); },
      });
      fields[i.key] = input;
      inputsBox.append(h('label', { class: 'est-field', for: `${id}-${i.key}` }, i.label, h('span', { class: 'est-num' }, input, h('span', {}, i.unit))));
    }
    if (d.hours) {
      const free = h('input', {
        type: 'number', min: '100', max: '100000', step: '100', inputMode: 'numeric', 'aria-label': '1時間の値段を自由に入れる（円）',
        value: HOUR_VALUES.some((x) => x.value === state.hourValue) ? '' : String(state.hourValue), placeholder: '自由に入れる',
        // 消したとき・範囲の外のときは、既定の札（5,000円）に戻す（見えない古い値で計算し続けないため）
        oninput: (e) => {
          const n = Number(e.target.value);
          state.hourValue = e.target.value !== '' && n >= 100 && n <= 100000 ? n : DEFAULT_HOUR_VALUE;
          markHour(); update();
        },
        onchange: (e) => {
          const n = Number(e.target.value);
          if (e.target.value === '' || !(n >= 100 && n <= 100000)) e.target.value = '';
        },
      });
      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'その作業をする方の1時間の値段' },
        HOUR_VALUES.map((x) => h('button', {
          type: 'button', 'aria-pressed': String(x.value === state.hourValue), dataset: { v: String(x.value) },
          onclick: () => { state.hourValue = x.value; free.value = ''; markHour(); update(); },
        }, x.label, x.note ? h('small', {}, `（${x.note}）`) : null)));
      inputsBox.append(h('div', { class: 'est-field' }, h('span', {}, 'その作業をする方の1時間の値段'), chips, h('span', { class: 'est-num' }, free, h('span', {}, '円'))));
      function markHour() { chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === state.hourValue))); }
    }
  }

  // ---- 結果 -------------------------------------------------------------------------

  const resRows = {};
  function update() {
    const d = DEMOS[state.key];
    const r = calcEstimate(state.key, state.values[state.key], state.hourValue);
    const rows = [];
    if (r.asked != null) rows.push(['asked', d.askedLabel, `${r.asked}時間`, '']);
    if (r.hours != null) {
      rows.push(['hours', '月に浮く時間（試算）', `${r.hours}時間`, 'good']);
      rows.push(['value', '金額に換算すると', `月 ${yen(r.monthlyValue)}`, '']);
      rows.push(['fee', '月額（続ける場合）', `月 ${man(r.monthlyFee)}`, '']);
      rows.push(['be', '月額の元が取れる時間', `月 ${r.breakEvenHours}時間`, '']);
    } else {
      rows.push(['hours', '時間の試算', '夜・休日の件数を、お試しで測ります', 'text']);
    }
    if (r.payback) rows.push(['payback', r.payback.label, `年に${r.payback.count}${r.payback.unit}`, '']);
    const sig = rows.map((x) => x[0]).join();
    if (resBox.dataset.sig !== sig) {
      // 行の並びが変わったときだけ作り直す（数字の変更では作り直さず、変わった所だけ光らせる）
      clear(resBox);
      // 「導入後の時間が今より長い」の注意は、結果の数字より先に出す（安全の表示を後に回さない）
      resBox.append(h('p', { class: 'est-neg', role: 'status' }));
      for (const [k, label, , cls] of rows) {
        const b = h('b', { class: cls });
        resRows[k] = b;
        resBox.append(h('div', { class: 'est-row' }, h('span', {}, label), b));
      }
      resBox.append(h('p', { class: 'est-verdict' }));
      resBox.dataset.sig = sig;
    }
    for (const [k, , text] of rows) {
      const b = resRows[k];
      if (b.textContent !== text) { const first = b.textContent === ''; b.textContent = text; if (!first) flash(b.parentElement); }
    }
    resBox.querySelector('.est-verdict').textContent = verdictText(state.key, r);
    const neg = resBox.querySelector('.est-neg');
    neg.textContent = r.negative ? '導入後の時間が今より長くなっています。浮く時間は0として計算しました。' : '';
    neg.hidden = !r.negative;
  }

  // ---- 使い道 ------------------------------------------------------------------------

  function renderUse() {
    const freeInput = h('input', {
      type: 'text', maxLength: 100, value: state.use, placeholder: '自由に書く（例：月に2回、取引先を訪問する）', 'aria-label': '浮いた時間の使い道（自由に書く）',
      oninput: (e) => { state.use = e.target.value; markUse(); },
    });
    const select = h('select', {
      'aria-label': '業種',
      onchange: (e) => { state.industry = e.target.value; state.industryChosen = true; renderUse(); useBox.querySelector('select')?.focus(); },
    }, Object.entries(INDUSTRIES).map(([k, x]) => h('option', { value: k, selected: k === state.industry }, x.label)));
    const uses = INDUSTRIES[state.industry].uses;
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '使い道の候補' },
      uses.map((u) => h('button', {
        type: 'button', 'aria-pressed': String(state.use === u),
        onclick: () => { state.use = state.use === u ? '' : u; freeInput.value = state.use; markUse(); },
      }, u)));
    function markUse() { chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === state.use))); }
    clear(useBox).append(...[
      h('h3', {}, '浮いた時間を、何に使いますか（1つ）'),
      h('div', { class: 'row' }, h('label', {}, '業種', select)),
      uses.length ? chips : null,
      h('label', { class: 'est-free' }, uses.length ? 'または自由に書く' : '自由に書く', freeInput),
    ].filter(Boolean));
  }

  // ---- 持ち帰り1枚 --------------------------------------------------------------------

  async function printTakeaway() {
    const t = buildTakeaway({ ...state, values: state.values[state.key], date: today() });
    const table = (pairs) => h('table', {}, h('tbody', {}, pairs.map(([a, b]) => h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, b)))));
    document.querySelectorAll('.takeaway').forEach((el) => el.remove());
    const sheet = h('div', { class: 'takeaway' },
      h('header', {}, h('b', {}, 'ソエギ'), h('span', {}, t.title), h('span', { class: 'tk-date' }, t.date)),
      h('p', { class: 'tk-disclaimer' }, t.disclaimer),
      h('p', { class: 'tk-meta' }, `デモ：${t.demoName}　／　業種：${t.industry || '—'}`),
      h('div', { class: 'tk-cols' },
        h('section', {}, h('h3', {}, '入れた前提'), table(t.assumptions)),
        h('section', {}, h('h3', {}, '試算の結果'),
          t.negativeNote ? h('p', { class: 'tk-neg' }, h('b', {}, '注意　'), t.negativeNote) : null,
          table(t.results), h('p', { class: 'tk-verdict' }, t.verdict))),
      h('section', {}, h('h3', {}, '浮いた時間の使い道'), h('p', { class: 'tk-use' }, t.use || '（まだ決めていません）')),
      h('section', {}, h('h3', {}, 'お試しの1ヶ月で、実際に測ること'), h('ul', {}, t.measures.map((m) => h('li', {}, m)))),
      h('section', {}, h('h3', {}, '料金'), h('p', {}, t.pricing)),
      h('footer', {},
        h('img', { src: QR_SRC, alt: 'withsoegi.jp のQRコード', width: 72, height: 72 }),
        h('div', {}, h('b', {}, 'ソエギ（山形）'), h('span', {}, 'withsoegi.jp'), h('span', {}, `${t.contact.tel} ／ ${t.contact.mail}`))));
    document.body.append(sheet);
    printBtn.disabled = true;
    // QR が描けるまで待ってから印刷する（長くても1.5秒。読めなければ文字の連絡先だけで印刷する）
    const img = sheet.querySelector('footer img');
    await Promise.race([preloadQr().then(() => img.decode?.()).catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);
    printBtn.disabled = false;
    document.documentElement.classList.add('print-takeaway');
    const done = () => { document.documentElement.classList.remove('print-takeaway'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  // ---- 1週間の記録表 ----------------------------------------------------------------

  async function downloadRecord() {
    recordBtn.disabled = true;
    try {
      // ExcelJS を読み込んでいない画面では、押したときに読み込む（同じサーバーのファイル）
      if (!window.ExcelJS) {
        await new Promise((ok, ng) => document.head.append(h('script', { src: '/vendor/exceljs.min.js', onload: ok, onerror: ng })));
      }
      const wb = buildRecordWorkbook(window.ExcelJS, state.key);
      const buf = await wb.xlsx.writeBuffer();
      const name = `1週間の記録表_${DEMOS[state.key].name.replace(/[：（）\s/→]+/g, '_').replace(/_+$/, '')}_${stamp()}.xlsx`;
      downloadBlob(new Blob([buf], { type: XLSX_MIME }), name);
      recordMsg.className = 'small-note';
      recordMsg.textContent = `記録表を作りました：${name}。お試しの前の1週間、付けてください。`;
    } catch {
      // 作れなかったときは、補足の小さな字にせず、注意の面で出す
      recordMsg.className = 'notice warn';
      recordMsg.textContent = '記録表を作れませんでした。再読み込みしてお試しください。';
    } finally {
      recordBtn.disabled = false;
    }
  }

  function selectKey(k) {
    if (!keys.includes(k) || k === state.key) return;
    state.key = k;
    if (!state.industryChosen) state.industry = DEMOS[k].industry;
    render();
  }

  function render() {
    switcher?.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === state.key)));
    renderInputs();
    delete resBox.dataset.sig;
    update();
    renderUse();
  }
  render();

  return {
    /**
     * ほかの入力（画面上部の「手入力なら約」など）から値を入れる。onChange は呼ばない。
     * 範囲（DEMOS の min・max）に寄せた値を返す（呼んだ側も、その値にそろえる）
     */
    set(key, name, value) {
      state.values[key][name] = value;
      const n = calcEstimate(key, state.values[key]).values[name];
      state.values[key][name] = n;
      if (state.key === key && fields[name]) fields[name].value = String(n);
      if (state.key === key) update();
      return n;
    },
    get(key) { return calcEstimate(key, state.values[key], state.hourValue).values; },
    /** 札（社内の質問／外国人スタッフ）を切り替える。入口の #foreign から来たときなど */
    select: selectKey,
  };
}
