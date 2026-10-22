// Cloudflare Turnstile（ロボット対策）。api.js は1回だけ読み込み、ウィジェットを何か所にでも置ける（宿の問い合わせ・口コミ返信）。
import { h } from './common.js';

let loading = null;
function loadApi() {
  loading ??= new Promise((ok, ng) => {
    window.onTurnstileLoad = () => ok(window.turnstile);
    document.head.append(h('script', {
      src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit', async: true, defer: true, onerror: () => ng(new Error('turnstile')),
    }));
  });
  return loading;
}

/** @returns {Promise<{token(): string, reset(): void}>} */
export async function mountTurnstile(selector, siteKey) {
  const api = await loadApi();
  let token = '';
  const id = api.render(selector, { sitekey: siteKey, language: 'ja', callback: (t) => { token = t; }, 'expired-callback': () => { token = ''; } });
  return { token: () => token, reset() { token = ''; api.reset(id); } };
}
