// 文字列 → Shift_JIS（Windows の日本語、いわゆる CP932）のバイト列。会計ソフトや販売管理ソフトの CSV 取り込み用。
// ブラウザの TextEncoder は UTF-8 しか作れないので、TextDecoder('shift_jis') で全ての組を一度だけ読み、逆引きの表を作る。
// 追加のライブラリは使わない。Shift_JIS に無い文字（絵文字など）は「?」にして、どの文字だったかを返す。

let table = null;

function build() {
  const dec = new TextDecoder('shift_jis');
  const map = new Map();
  const put = (ch, bytes) => { if (!map.has(ch) && ch !== '�') map.set(ch, bytes); };
  for (let b = 0; b < 0x80; b++) put(String.fromCharCode(b), [b]);
  for (let b = 0xa1; b <= 0xdf; b++) put(dec.decode(new Uint8Array([b])), [b]); // 半角カナ
  const leads = [];
  for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
  for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
  for (const lead of leads) {
    for (let t = 0x40; t <= 0xfc; t++) {
      if (t === 0x7f) continue;
      put(dec.decode(new Uint8Array([lead, t])), [lead, t]);
    }
  }
  // よく使う記号の書き分け（Windows の動きに合わせる）
  put('¥', [0x5c]); put('‾', [0x7e]); put('−', [0x81, 0x7c]); put('〜', [0x81, 0x60]);
  return map;
}

/** @returns {{bytes: Uint8Array, unmappable: string[]}} */
export function encodeSjis(text) {
  table ??= build();
  const out = []; const unmappable = [];
  for (const ch of String(text)) {
    const b = table.get(ch);
    if (b) out.push(...b);
    else { out.push(0x3f); unmappable.push(ch); }
  }
  return { bytes: new Uint8Array(out), unmappable };
}

/** Shift_JIS にできない文字を返す（画面で先に知らせるため） */
export function sjisUnmappable(text) {
  return encodeSjis(text).unmappable;
}
