// 同じ入力（用意した例文など）の結果を使い回し、AIを呼ばないためのキャッシュ。
// 入るのはデモ用の架空データから作った結果だけ（利用者の入力は入れない）。

const memory = new Map();
const TTL_SEC = 30 * 86400;

const keyUrl = (key) => `https://soegi-demo.cache/${encodeURIComponent(key)}`;

export async function getCached(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const hit = await caches.default.match(new Request(keyUrl(key)));
    if (hit) {
      const data = await hit.json();
      memory.set(key, data);
      return data;
    }
  } catch { /* キャッシュが使えない環境 */ }
  return null;
}

export async function putCached(key, data) {
  memory.set(key, data);
  if (memory.size > 200) memory.delete(memory.keys().next().value);
  try {
    await caches.default.put(new Request(keyUrl(key)), new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL_SEC}` },
    }));
  } catch { /* キャッシュが使えない環境 */ }
}
