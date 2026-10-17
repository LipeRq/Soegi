// 持ち帰り1枚に載せる withsoegi.jp の QR を、SVG にして一度だけ作る（画面では計算しない）。
//   node scripts/gen-qr.mjs
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const svg = await QRCode.toString('https://withsoegi.jp/', { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1B2428', light: '#FFFFFF' } });
writeFileSync(new URL('../public/img/qr-withsoegi.svg', import.meta.url), svg);
console.log('ok', svg.length);
