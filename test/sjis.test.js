import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSjis, sjisUnmappable } from '../public/js/sjis.js';

const dec = (b) => new TextDecoder('shift_jis').decode(b);

test('Shift_JIS：日本語・半角カナ・記号を変えて、読み戻すと元の文字', () => {
  const s = 'さくらんぼ食品（仮）,ラ・フランスジャム 150g,4,800円,ｶﾅ,髙橋,①,ー';
  const { bytes, unmappable } = encodeSjis(s);
  assert.deepEqual(unmappable, []);
  assert.equal(dec(bytes), s);
  assert.deepEqual([...encodeSjis('〜').bytes], [0x81, 0x60]); // 波ダッシュは Windows と同じ位置へ
  assert.deepEqual([...encodeSjis('あ').bytes], [0x82, 0xa0]);
  assert.deepEqual([...encodeSjis('A,1\r\n').bytes], [0x41, 0x2c, 0x31, 0x0d, 0x0a]);
});

test('Shift_JIS にできない文字は「?」にして、どの文字かを返す', () => {
  const { bytes, unmappable } = encodeSjis('A😀𠮷B');
  assert.deepEqual(unmappable, ['😀', '𠮷']);
  assert.equal(dec(bytes), 'A??B');
  assert.deepEqual(sjisUnmappable('ふつうの文字'), []);
});
