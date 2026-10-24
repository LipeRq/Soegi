import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCitations, finalizeKnowledgeAnswer, isSafetyRelated, isLaborJudgment, buildDocsContext } from '../src/core/knowledge.js';
import { finalizeInnReply, finalizeInnFaq } from '../src/core/inn.js';
import { finalizeSiteAnswer } from '../src/core/sitebot.js';
import { validateKnowledge, validateInnReply, validateInnFaq, validateSiteAnswer } from '../src/schemas.js';
import { mockResponse } from '../src/mock.js';
import { knowledge } from '../src/demos/knowledge.js';
import { innReply, innFaq } from '../src/demos/inn.js';
import { siteChat, loadProfiles } from '../src/demos/sitechat.js';
import { fixed, langKey } from '../src/core/lang.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'));
const { docs } = load('sakuranbo.json');
const inn = load('yukiakari.json');
const examples = load('inn-examples.json');
const MOCK = { AI_PROVIDER: 'mock' };

// ---- デモA -------------------------------------------------------------------------

test('資料：見積書20件と、手順書・衛生・エラー表・就業規則・出荷ルールがある', () => {
  assert.equal(docs.filter((d) => d.type === 'estimate').length, 20);
  for (const id of ['manual-wash', 'manual-fill', 'manual-sterilize', 'hygiene', 'errors', 'rules', 'shipping']) assert.ok(docs.find((d) => d.id === id), id);
  const ids = new Set();
  for (const d of docs) for (const s of d.sections) { const k = `${d.id}#${s.id}`; assert.ok(!ids.has(k), k); ids.add(k); }
  assert.match(buildDocsContext(docs), /\[est-2025-031#l1\] 1行目/);
});

test('引用の照合：資料にある文は通し、作った文・存在しない箇所は落とす', () => {
  const { valid, invalid } = verifyCitations(docs, [
    { doc_id: 'est-2025-031', section_id: 'l1', quote: 'ラ・フランスジャム 150g｜単価 420円' }, // ある
    { doc_id: 'est-2025-031', section_id: 'l1', quote: 'ラ・フランスジャム 150g｜単価 400円' }, // 数字を変えた
    { doc_id: 'est-2025-031', section_id: 'l9', quote: 'ラ・フランスジャム' }, // 箇所がない
    { doc_id: 'rules', section_id: 'r1', quote: '有給休暇を使うときは、休みたい日の3日前まで' }, // ある（文の途中まで）
    { doc_id: 'errors', section_id: 'e07', quote: '1. 赤い停止ボタンを押します。…班長を呼びます' }, // 省略つき
  ]);
  assert.equal(valid.length, 3);
  assert.equal(invalid, 2);
});

test('根拠が確かめられない答えは「見当たりません」に置き換える（知ったかぶりをしない）', () => {
  const v = validateKnowledge({
    language: 'ja', question_ja: '社員旅行は？', found: true, answer: '来月は蔵王です。', answer_ja: '', easy_japanese: '',
    citations: [{ doc_id: 'rules', section_id: 'r1', quote: '社員旅行は蔵王です' }], safety_related: false, category: 'その他',
  });
  const out = finalizeKnowledgeAnswer(docs, v, '来月の社員旅行はどこ？');
  assert.equal(out.found, false);
  assert.equal(out.answer, fixed('notFound', 'ja'));
  assert.equal(out.citations.length, 0);
  assert.ok(out.notes.length);
});

test('安全・衛生の質問には、AIが見落としても「必ずリーダーに確認」を出す', () => {
  assert.ok(isSafetyRelated('Apakah saya boleh memakai sarung tangan yang sama?'));
  assert.ok(isSafetyRelated('指を切ってしまった'));
  assert.ok(!isSafetyRelated('有給はどう取る？'));
  const v = validateKnowledge({ ...mockResponse({ tool: { name: 'submit_answer' }, userText: '質問：sarung tangan' }), safety_related: false });
  const out = finalizeKnowledgeAnswer(docs, v, 'Apakah saya boleh memakai sarung tangan yang sama setelah istirahat?');
  assert.equal(out.requireConfirm, true);
  assert.equal(out.confirmText, fixed('confirm', 'id'));
  assert.ok(out.confirmEasy);
  assert.ok(out.translatedNote);
});

test('労務・在留資格の判断に踏み込む質問には注意を出す', () => {
  assert.ok(isLaborJudgment('ビザの更新はどうすればいい？'));
  assert.ok(isLaborJudgment('残業代の計算は合っていますか'));
  assert.ok(!isLaborJudgment('休憩は何時から？'));
});

test('台本の質問1〜5（モック）：根拠が資料と一致し、資料に無い質問は見当たらない', async () => {
  const qs = [
    ['去年、やまびこスーパー（仮）向けに出したラ・フランスジャムの単価は？', true, 'est-2025-031'],
    ['充填機でE-07が出た。どうする？', true, 'errors'],
    ['Tôi muốn xin nghỉ phép có lương, phải làm thế nào?', true, 'rules'],
    ['Apakah saya boleh memakai sarung tangan yang sama setelah istirahat?', true, 'hygiene'],
    ['来月の社員旅行はどこ？', false, null],
  ];
  for (const [q, found, docId] of qs) {
    const out = await knowledge(MOCK, { question: q });
    assert.equal(out.found, found, q);
    if (found) {
      assert.ok(out.citations.length, q);
      assert.equal(out.citations[0].docId, docId);
      assert.equal(out.notes.length, 0, `${q}: ${out.notes}`);
    } else {
      assert.equal(out.answer, fixed('notFound', 'ja'));
    }
  }
  const vi = await knowledge(MOCK, { question: qs[2][0] });
  assert.equal(vi.language, 'vi');
  assert.ok(vi.easyJa && vi.translatedNoteJa);
  const e07 = await knowledge(MOCK, { question: qs[1][0] });
  assert.equal(e07.requireConfirm, true); // 熱いノズル＝安全
});

test('質問が空・長すぎるときは断る', async () => {
  await assert.rejects(knowledge(MOCK, { question: '' }), /質問/);
  await assert.rejects(knowledge(MOCK, { question: 'あ'.repeat(501) }), /500/);
});

test('言語のキー', () => {
  assert.equal(langKey('zh-TW'), 'zh');
  assert.equal(langKey('vi-VN'), 'vi');
  assert.equal(fixed('notFound', 'xx'), fixed('notFound', 'en'));
});

// ---- デモB -------------------------------------------------------------------------

test('宿：例文3つの順は、繁体字（台湾）が先頭', () => {
  assert.deepEqual(examples.map((e) => e.id), ['zh-family', 'en-access', 'ko-bath']);
});

test('宿：AIが挙げなくても、アレルギー・空室・夜の樹氷は必ず要確認に出る', () => {
  const v = validateInnReply({ language: 'zh-TW', inquiry_ja: '', reply: 'x', reply_ja: 'ご連絡ありがとうございます。', needs_check: [], used_info_ids: ['allergy', 'nope'] });
  const out = finalizeInnReply(inn, v, examples[0].text);
  const points = out.needsCheck.map((n) => n.point);
  assert.ok(points.some((p) => p.includes('アレルギー')));
  assert.ok(points.some((p) => p.includes('空室')));
  assert.ok(points.some((p) => p.includes('ライトアップ')));
  assert.deepEqual(out.usedInfo.map((u) => u.id), ['allergy']);
  assert.equal(out.warnings.length, 1); // 宿の情報に無い id
});

test('宿：「夜」だけでは樹氷の要確認を出さない（樹氷の話のときだけ）', () => {
  const v = validateInnReply({ language: 'en', inquiry_ja: '2泊したい', reply: 'x', reply_ja: 'y', needs_check: [], used_info_ids: [] });
  const out = finalizeInnReply(inn, v, 'We want to stay for 2 nights.');
  assert.ok(!out.needsCheck.some((n) => n.point.includes('ライトアップ')));
});

test('宿：返信に「安全です」など約束の表現があれば注意を出す', () => {
  const v = validateInnReply({ language: 'en', inquiry_ja: '', reply: 'x', reply_ja: '卵は完全に除去しますので安全です。', needs_check: [], used_info_ids: [] });
  assert.equal(finalizeInnReply(inn, v, 'egg allergy').warnings.length, 1);
});

test('宿：例文はキャッシュされ、2回目はAIを呼ばずに同じ結果', async () => {
  const env = { AI_PROVIDER: 'mock' };
  const a = await innReply(env, { exampleId: 'en-access' }, '1.2.3.4');
  const b = await innReply(env, { exampleId: 'en-access' }, '1.2.3.4');
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(a.reply, b.reply);
  for (const ex of examples) {
    const out = await innReply(env, { exampleId: ex.id }, '1.2.3.4');
    assert.equal(out.warnings.length, 0, ex.id);
    if (ex.id === 'zh-family') assert.ok(out.needsCheck.length >= 3);
  }
});

test('宿：自由入力は Turnstile が未設定なら使えない（503）', async () => {
  await assert.rejects(innReply(MOCK, { text: 'Hello' }, '1.2.3.4'), (e) => e.status === 503);
  await assert.rejects(innReply(MOCK, { text: 'a'.repeat(501) }, '1.2.3.4'), (e) => e.status === 400);
});

test('宿：よくある質問は4言語そろい、宿の情報に無い項目に頼る問いは外す', async () => {
  const out = await innFaq({ AI_PROVIDER: 'mock' });
  assert.ok(out.items.length >= 3);
  const v = validateInnFaq({ items: [{ ...out.items[0], info_ids: ['nope'] }, out.items[1]] });
  assert.equal(finalizeInnFaq(inn, v).dropped, 1);
  assert.throws(() => validateInnFaq({ items: [{ info_ids: ['checkin'], q_ja: 'a', a_ja: 'b' }] }), /schema/);
});

// ---- デモC -------------------------------------------------------------------------

test('チャット：リンクは決めた一覧からだけ。答えられないときは相談に案内', () => {
  const p = loadProfiles().soegi;
  const v = validateSiteAnswer({ language: 'ja', found: true, answer: 'a', link_ids: ['price', 'evil', 'price'], suggest_consult: false, category: '料金' });
  const out = finalizeSiteAnswer(p, v);
  assert.deepEqual(out.links.map((l) => l.href), ['https://withsoegi.jp/price/']);
  assert.equal(out.consult, null);
  const nf = finalizeSiteAnswer(p, validateSiteAnswer({ language: 'en', found: false, answer: '', link_ids: [], suggest_consult: false, category: '' }));
  assert.match(nf.answer, /Sorry/);
  assert.ok(nf.consult);
});

test('チャット：ソエギ版の知識に料金（pricing.js）が入り、宿版は宿の情報から作られる', () => {
  const ps = loadProfiles();
  const price = ps.soegi.sections.find((s) => s.id === 'price').text;
  assert.match(price, /社内ナレッジ検索.*初期 15万円＋月5万円/);
  assert.match(price, /Webチャットボット：初期 10万円＋月2万円/);
  assert.ok(ps.yado.sections.some((s) => s.heading === 'アレルギー'));
  for (const p of Object.values(ps)) for (const s of p.sections) assert.ok(s.id in p.links, `${p.key}:${s.id}`);
});

test('チャット：台本の質問（モック）と、長すぎる・空の質問', async () => {
  const out = await siteChat(MOCK, { profile: 'soegi', message: '料金はいくら？' }, '9.9.9.9');
  assert.ok(out.found);
  assert.equal(out.links[0].href, 'https://withsoegi.jp/price/');
  const en = await siteChat(MOCK, { profile: 'soegi', message: 'Do you support companies outside Yamagata?' }, '9.9.9.9');
  assert.equal(en.language, 'en');
  await assert.rejects(siteChat(MOCK, { message: '' }, '9.9.9.9'), /質問/);
  await assert.rejects(siteChat(MOCK, { message: 'a'.repeat(301) }, '9.9.9.9'), /300/);
});

test('チャット：1日30回を超えると断る（同じIP）', async () => {
  const ip = '8.8.4.4';
  for (let i = 0; i < 30; i++) await siteChat(MOCK, { message: '料金は？' }, ip);
  await assert.rejects(siteChat(MOCK, { message: '料金は？' }, ip), (e) => e.status === 429);
});
