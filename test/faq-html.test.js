import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faqToHtml } from '../public/js/faq-html.js';

test('よくある質問のHTML：4言語の節ができ、AIの出力はエスケープされる', () => {
  const html = faqToHtml([{ q_ja: '<script>x</script>', a_ja: 'A&B', q_zh: '問', a_zh: '答', q_en: 'Q', a_en: 'A', q_ko: '질문', a_ko: '답' }], '宿"');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /A&amp;B/);
  assert.equal((html.match(/<section class="faq"/g) || []).length, 4);
  assert.match(html, /lang="zh-Hant-TW"/);
});
