// 言語ごとの決まった文言。AIに任せず、プログラムが必ず出す（翻訳の注意、見当たらない、安全の確認など）。

export const LANG_NAMES = {
  ja: '日本語', en: '英語', vi: 'ベトナム語', id: 'インドネシア語', zh: '中国語（繁体字）', ko: '韓国語',
  tl: 'タガログ語', ne: 'ネパール語', my: 'ミャンマー語', th: 'タイ語', pt: 'ポルトガル語', es: 'スペイン語',
};

/** "vi-VN" "zh-Hant-TW" "Vietnamese" → "vi" "zh" */
export function langKey(lang) {
  const s = String(lang || '').toLowerCase().trim();
  const byName = { japanese: 'ja', english: 'en', vietnamese: 'vi', indonesian: 'id', chinese: 'zh', korean: 'ko' };
  if (byName[s]) return byName[s];
  const k = s.split(/[-_]/)[0];
  return k || 'ja';
}

const T = {
  notFound: {
    ja: '資料には見当たりません。担当者に確認してください。',
    en: 'I could not find this in the documents. Please ask the person in charge.',
    vi: 'Không tìm thấy thông tin này trong tài liệu. Vui lòng hỏi người phụ trách.',
    id: 'Informasi ini tidak ada di dokumen. Silakan tanyakan kepada penanggung jawab.',
    zh: '資料中找不到相關內容。請向負責人確認。',
    ko: '자료에서 찾을 수 없습니다. 담당자에게 확인해 주세요.',
  },
  notFoundEasy: 'しりょうに かいて ありません。たんとうの ひとに きいて ください。',
  confirm: {
    ja: '安全・衛生・体調に関わることです。必ずリーダーに確認してください。',
    en: 'This is about safety, hygiene or health. Always check with your leader.',
    vi: 'Đây là nội dung liên quan đến an toàn, vệ sinh hoặc sức khỏe. Hãy luôn hỏi lại trưởng nhóm.',
    id: 'Ini terkait keselamatan, kebersihan, atau kesehatan. Selalu tanyakan kepada pemimpin Anda.',
    zh: '這與安全、衛生或身體狀況有關。請務必向組長確認。',
    ko: '안전·위생·건강에 관한 내용입니다. 반드시 리더에게 확인하세요.',
  },
  confirmEasy: 'あんぜん・えいせい・からだの ことです。かならず リーダーに きいて ください。',
  labor: {
    ja: '労務（給料・残業代の計算など）や在留資格の判断はできません。会社の担当者に相談してください。',
    en: 'I cannot give judgments about labor matters (such as pay calculations) or visa status. Please talk to the person in charge at the company.',
    vi: 'Tôi không thể đưa ra phán đoán về lao động (như tính lương) hoặc tư cách lưu trú. Vui lòng trao đổi với người phụ trách của công ty.',
    id: 'Saya tidak dapat menilai urusan ketenagakerjaan (seperti perhitungan gaji) atau status izin tinggal. Silakan bicarakan dengan penanggung jawab di perusahaan.',
    zh: '無法判斷勞務（薪資、加班費計算等）或在留資格的問題。請與公司的負責人商量。',
    ko: '노무(급여·잔업수당 계산 등)나 체류 자격에 대해서는 판단할 수 없습니다. 회사 담당자와 상담하세요.',
  },
  laborEasy: 'きゅうりょうの けいさんや ビザの ことは、ここでは こたえられません。かいしゃの たんとうの ひとに そうだん して ください。',
  translated: {
    ja: '',
    en: 'This is a translation by AI. Check important points with the Japanese original and your leader.',
    vi: 'Đây là bản dịch của AI. Hãy kiểm tra những điều quan trọng với bản gốc tiếng Nhật và trưởng nhóm.',
    id: 'Ini terjemahan AI. Periksa hal penting dengan teks asli bahasa Jepang dan pemimpin Anda.',
    zh: '這是AI的翻譯。重要的事情請以日文原文為準，並向組長確認。',
    ko: '이것은 AI 번역입니다. 중요한 내용은 일본어 원문과 리더에게 확인하세요.',
  },
  translatedJa: 'AIの翻訳です。大事なことは日本語の原文と上司で確認してください。',
};

export function fixed(key, lang) {
  const k = langKey(lang);
  const table = T[key];
  return table[k] ?? table.en;
}
export const EASY = { notFound: T.notFoundEasy, confirm: T.confirmEasy, labor: T.laborEasy };
export const TRANSLATED_JA = T.translatedJa;
