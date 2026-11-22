// posts.md の X 用の文の重みを数える（X の数え方：U+0000-10FF などは1、それ以外は2、URLは23。上限280）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const md = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'posts.md'), 'utf8');
const x = md.split('## X')[1].split('```')[1].replace(/^\n/, '').replace(/\n$/, '');
const light = (cp) => cp <= 0x10FF || (cp >= 0x2000 && cp <= 0x200D) || (cp >= 0x2010 && cp <= 0x201F) || (cp >= 0x2032 && cp <= 0x2037);
let w = 0;
const noUrl = x.replace(/https?:\/\/\S+/g, () => { w += 23; return ''; });
for (const ch of noUrl) w += light(ch.codePointAt(0)) ? 1 : 2;
console.log('X weight:', w, '/ 280');
