// 月次レポートのグラフ（SVG を画面の中で作る。CSP のまま：style 属性は使わず、色は CSS のクラスで決める）。
// 折れ線：今年（--accent）と前年（--gray-bar）の2本。強調の形（1色＋灰色）。凡例は常に出し、端の直接ラベルは線が離れているときだけ。
// ホバー・フォーカス：縦の細い線が月に吸いつき、1つの吹き出しに両方の値を出す。値は表（「表で見る」）でも読める（吹き出しだけに頼らない）。
import { yen, yenShort, pct } from './monthly-calc.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const html = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** きりのよい上限と目盛り（0 から。4つに区切る） */
export function niceScale(max) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** 軸の文字：0 / 50万 / 100万（1000以上は万に縮める） */
export const axisLabel = (v) => (v === 0 ? '0' : v >= 100_000_000 ? `${v / 100_000_000}億` : v >= 10_000 ? `${Math.round(v / 100) / 100}万` : String(v));

const monthShort = (ym) => `${+ym.slice(5, 7)}月`;

/**
 * 直近12か月の折れ線
 * @param box 入れ物（中を作り直す）
 * @param series [{ym, thisYear, prevYear}]
 * @param labels {thisName, prevName}
 */
export function lineChart(box, series, labels = { thisName: '今年', prevName: '前年' }) {
  box.replaceChildren();
  const W = 720; const H = 300; const L = 58; const R = 70; const T = 16; const B = 40;
  const pw = W - L - R; const ph = H - T - B;
  const vals = series.flatMap((s) => [s.thisYear, s.prevYear]).filter((v) => v != null);
  const { max, ticks } = niceScale(Math.max(0, ...vals));
  const x = (i) => L + (pw * i) / (series.length - 1);
  const y = (v) => T + ph - (ph * v) / max;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc', role: 'img', 'aria-label': `直近12か月の売上。${labels.thisName}と${labels.prevName}の月ごとの売上を並べた折れ線グラフ。数字は下の「表で見る」でも読めます` });
  // 目盛りの線（細い実線）と、軸の文字
  for (const t of ticks) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'grid' }));
    svg.append(el('text', { x: L - 8, y: y(t) + 4, class: 'ytick', 'text-anchor': 'end' }, axisLabel(t)));
  }
  series.forEach((s, i) => {
    const showYear = i === 0 || s.ym.endsWith('-01');
    svg.append(el('text', { x: x(i), y: H - B + 18, class: 'xtick', 'text-anchor': 'middle' }, monthShort(s.ym)));
    if (showYear) svg.append(el('text', { x: x(i), y: H - B + 33, class: 'xyear', 'text-anchor': 'middle' }, `${s.ym.slice(0, 4)}年`));
  });
  // 線（データの無い月は、線をつながない）
  const path = (key) => {
    let d = ''; let pen = false;
    series.forEach((s, i) => { if (s[key] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s[key]).toFixed(1)}`; pen = true; });
    return d;
  };
  svg.append(el('path', { d: path('prevYear'), class: 'line prev' }));
  svg.append(el('path', { d: path('thisYear'), class: 'line cur' }));
  // 端の点（2px の面の色の輪つき）と、線が離れているときだけの直接ラベル
  const lastIdx = (key) => { for (let i = series.length - 1; i >= 0; i -= 1) if (series[i][key] != null) return i; return -1; };
  const ends = [['prevYear', 'prev', labels.prevName], ['thisYear', 'cur', labels.thisName]].map(([key, cls, name]) => ({ key, cls, name, i: lastIdx(key) })).filter((e) => e.i >= 0);
  for (const e of ends) svg.append(el('circle', { cx: x(e.i), cy: y(series[e.i][e.key]), r: 4, class: `dot ${e.cls}` }));
  if (ends.length === 2 && Math.abs(y(series[ends[0].i][ends[0].key]) - y(series[ends[1].i][ends[1].key])) >= 18 && ends[0].i === ends[1].i) {
    for (const e of ends) svg.append(el('text', { x: x(e.i) + 10, y: y(series[e.i][e.key]) + 4, class: `endlabel ${e.cls}` }, e.name));
  }
  // ホバー・フォーカス
  const cross = el('line', { x1: 0, x2: 0, y1: T, y2: T + ph, class: 'cross', visibility: 'hidden' });
  svg.append(cross);
  const tip = html('div', 'tip'); tip.hidden = true;
  const show = (i) => {
    const s = series[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(html('div', 'tip-h', `${+s.ym.slice(0, 4)}年${monthShort(s.ym)}`));
    for (const [key, cls, name] of [['thisYear', 'cur', labels.thisName], ['prevYear', 'prev', labels.prevName]]) {
      const row = html('div', 'tip-r');
      row.append(html('i', `key ${cls}`), html('span', 'tip-v', s[key] == null ? 'データなし' : yen(s[key])), html('span', 'tip-n', name));
      tip.append(row);
    }
    if (s.thisYear != null && s.prevYear != null && s.prevYear > 0) tip.append(html('div', 'tip-d', `前年との差：${pct((s.thisYear - s.prevYear) / s.prevYear)}（${s.thisYear - s.prevYear >= 0 ? '＋' : '－'}${yenShort(Math.abs(s.thisYear - s.prevYear))}）`));
    tip.hidden = false;
    // 吹き出しは、グラフの枠からはみ出さない所に置く（右に出せなければ左、どちらも狭ければ左端に寄せる）
    const box2 = wrap.clientWidth; const px = (x(i) / W) * box2; const w = tip.offsetWidth;
    const left = px + 10 + w <= box2 ? px + 10 : Math.max(0, px - 10 - w);
    tip.style.setProperty('left', `${left}px`);
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  // 当たり判定は、点より大きい（月の幅いっぱい）。キーボードでも、同じ吹き出しが出る
  const step = pw / (series.length - 1);
  series.forEach((s, i) => {
    const g = el('rect', { x: x(i) - step / 2, y: T, width: step, height: ph + 24, class: 'hit', tabindex: 0, role: 'img',
      'aria-label': `${+s.ym.slice(0, 4)}年${monthShort(s.ym)}：${labels.thisName} ${s.thisYear == null ? 'データなし' : yen(s.thisYear)}、${labels.prevName} ${s.prevYear == null ? 'データなし' : yen(s.prevYear)}` });
    g.addEventListener('pointerenter', () => show(i));
    g.addEventListener('pointermove', () => show(i));
    g.addEventListener('focus', () => show(i));
    g.addEventListener('blur', hide);
    svg.append(g);
  });
  svg.addEventListener('pointerleave', hide);

  const wrap = html('div', 'chartwrap');
  wrap.append(svg, tip);
  // 凡例（2本以上のとき、常に出す）。線の見本は、グラフと同じ形
  const legend = html('div', 'legend2');
  for (const [cls, name] of [['cur', labels.thisName], ['prev', labels.prevName]]) { const item = html('span', 'lg'); item.append(html('i', `key ${cls}`), name); legend.append(item); }
  box.append(legend, wrap);
}

/** 横棒：上位の顧客・商品。値は棒の先に出す（収まらない文字は、棒の外）。色は1色（並べ替えの順位で色を変えない） */
export function barList(box, items, { restLabel, rest, restShare, restCount } = {}) {
  box.replaceChildren();
  const max = Math.max(1, ...items.map((i) => i.amount));
  const list = html('div', 'bars');
  for (const it of items) {
    const row = html('div', 'barrow');
    const fill = html('i', 'fill');
    fill.style.setProperty('--w', `${(it.amount / max) * 100}%`);
    const track = html('span', 'track'); track.append(fill);
    row.append(html('span', 'nm', it.name), track, html('span', 'val', `${yenShort(it.amount)}${it.share != null ? `（${(it.share * 100).toFixed(1)}%）` : ''}`));
    list.append(row);
  }
  box.append(list);
  if (rest > 0) box.append(html('p', 'rest', `${restLabel}${restCount ? `（${restCount}件）` : ''}：${yenShort(rest)}（${(restShare * 100).toFixed(1)}%）`));
}
