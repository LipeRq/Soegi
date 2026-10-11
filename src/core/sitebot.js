// デモC：サイトのチャットボット。サイトに書いてある内容だけで答え、リンクは決めた一覧からだけ出す。
import { langKey } from './lang.js';

/** 宿の情報を、チャットボットの節の形にする */
export function innToSections(inn) {
  const access = new Set(['access', 'pickup']);
  return [
    { id: 'stay', heading: '宿の概要', text: `${inn.name}。${inn.about}` },
    ...inn.items.map((i) => ({ id: access.has(i.id) ? 'access' : 'stay', heading: i.label, text: i.text })),
    { id: 'contact', heading: 'お問い合わせ', text: '空室・料金・予約は、お問い合わせください（デモ用の架空の宿のため、連絡先はありません）。' },
  ];
}

export function buildSiteContext(profile) {
  return profile.sections.map((s, i) => `[${s.id}] (${i + 1}) ${s.heading}\n${s.text}`).join('\n\n');
}

const NOT_FOUND = {
  ja: 'すみません、サイトには載っていない内容です。お問い合わせください。',
  en: "Sorry, that isn't covered on this website. Please contact us.",
  zh: '抱歉，網站上沒有這方面的資訊。請與我們聯繫。',
  ko: '죄송합니다. 사이트에 없는 내용입니다. 문의해 주세요.',
  vi: 'Xin lỗi, nội dung này không có trên trang web. Vui lòng liên hệ với chúng tôi.',
  id: 'Maaf, hal itu tidak ada di situs ini. Silakan hubungi kami.',
};

export function finalizeSiteAnswer(profile, v) {
  const lang = langKey(v.language);
  const links = [];
  for (const id of v.link_ids) {
    const l = profile.links[id];
    if (l && !links.some((x) => x.href === l.href)) links.push({ label: l.label, href: l.href });
  }
  const found = v.found && v.answer.trim() !== '';
  return {
    language: lang,
    found,
    answer: found ? v.answer : (NOT_FOUND[lang] ?? NOT_FOUND.en),
    links: links.slice(0, 3),
    consult: (v.suggest_consult || !found) ? profile.consult : null,
    category: v.category || 'その他',
  };
}
