// 画像を、長辺2000pxのJPEGに縮小し、向きを直してから送る（画面側で行う）。

const MAX_SIDE = 2000;

async function load(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 下の方法へ */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

/** @returns {Promise<{base64:string, blob:Blob}>} */
export async function toJpeg(file, maxSide = MAX_SIDE, quality = 0.85) {
  let src;
  try { src = await load(file); } catch { throw new Error('画像を開けませんでした（JPEG・PNGなどでお試しください）'); }
  const w = src.width; const hgt = src.height;
  const scale = Math.min(1, maxSide / Math.max(w, hgt));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale); canvas.height = Math.round(hgt * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  src.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('画像を変換できませんでした');
  const base64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = () => rej(new Error('画像を読み込めませんでした'));
    fr.readAsDataURL(blob);
  });
  return { base64, blob };
}
