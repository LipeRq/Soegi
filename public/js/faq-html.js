// よくある質問を、宿のサイトに貼れるHTMLにする。AIの出力は必ずエスケープしてから文字列にする。

export const FAQ_LANGS = [
  { key: 'ja', label: '日本語', lang: 'ja' },
  { key: 'zh', label: '繁體中文', lang: 'zh-Hant-TW' },
  { key: 'en', label: 'English', lang: 'en' },
  { key: 'ko', label: '한국어', lang: 'ko' },
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function faqToHtml(items, innName) {
  const parts = [`<!-- よくある質問（${esc(innName)}）。送る・載せる前に、内容を宿のスタッフが確認してください -->`];
  for (const l of FAQ_LANGS) {
    parts.push(`<section class="faq" lang="${l.lang}">`, `  <h2>${esc(l.label)}</h2>`);
    for (const it of items) {
      parts.push('  <details>', `    <summary>${esc(it[`q_${l.key}`])}</summary>`, `    <p>${esc(it[`a_${l.key}`])}</p>`, '  </details>');
    }
    parts.push('</section>');
  }
  return parts.join('\n');
}
