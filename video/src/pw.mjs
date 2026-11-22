// この環境に入っている Playwright を読み込む（ESM からは全体の node_modules が見えないため require で読む）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node-tools/node_modules/playwright'); }
export const { chromium } = pw;
