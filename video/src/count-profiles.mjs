// profiles.md の文の字数を数える（コードブロックの中身。改行も1字として数える）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const md = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'profiles.md'), 'utf8');
const block = (after) => md.split(after)[1].split('```')[1].replace(/^\n/, '').replace(/\n$/, '');
const len = (s) => [...s].length;
const items = [
  ['Googleビジネスプロフィール 説明（上限 750 または全角375）', block('### ビジネスの説明'), 375],
  ['Instagram 自己紹介（上限150）', block('### 自己紹介（Instagram'), 150],
  ['X 自己紹介（上限160）', block('### 自己紹介（X・'), 160],
  ['Instagram 名前（上限30）', 'Nodus Consulting｜山形の業務改善', 30],
  ['X 名前（上限50）', 'Nodus Consulting｜山形の業務改善・データ活用', 50],
];
let ok = true;
for (const [name, text, max] of items) {
  const n = len(text);
  if (n > max) ok = false;
  console.log(`${n > max ? 'NG' : 'OK'} ${n}字 / ${max}  ${name}`);
}
process.exit(ok ? 0 : 1);
