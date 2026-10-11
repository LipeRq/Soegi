// 料金の置き場所はここ1か所。画面の案内と、サイトのチャットボットの知識が、これを使う。
// 2026-10-11「デモシナリオと導入料金」の案。表示はすべて税抜（サイトの決まりに合わせる）。

export const TAX_NOTE = '表示はすべて税抜です';

export const TRIAL = { name: 'お試し導入', price: 50000, text: '1業務・1ヶ月' };
const CREDIT = '続ける場合は、お試しの5万円を初期費用に充てます';

// サイトの料金表にあり、今回の案で変えていないもの
export const OTHERS = [
  { name: '見える化パック', text: '5万円から。売上・利益やお客さまの傾向を、型にしたExcelや一覧表で見える化します' },
  { name: '小さなツール', text: '10万円から。型のある仕組みに限ります（見積書や問い合わせ返信の下書きなど）' },
  { name: '社内研修', text: '2時間あたり3万円から。御社の書類を題材にしたAIの使い方研修と、社内の利用ルールづくり' },
  { name: '保守プラン', text: '月1万円（任意）。手順書の更新、3ヶ月ごとのオンライン点検、メールでのご質問' },
];

export const MENUS = {
  manual: { name: '手作業を減らす（経理・労務など）', initial: null, monthly: 50000, includes: '仕組みの改善、手順書づくり、月1回の振り返り' },
  knowledge: { name: '社内ナレッジ検索（外国人スタッフ向けの多言語を含む）', initial: 150000, monthly: 50000, includes: 'AIの利用料、資料の追加・更新、よく聞かれる質問の月次レポート、手順書の改善提案、月1回の打ち合わせ' },
  inn: { name: '宿の多言語対応（返信の下書き＋多言語のよくある質問）', initial: 150000, monthly: 30000, includes: 'AIの利用料、宿の情報の更新（季節ごと）、月次レポート' },
  chatbot: { name: 'Webチャットボット', initial: 100000, monthly: 20000, includes: 'AIの利用料、回答内容の更新（月1回）、月次レポート' },
};

export const RENEWAL = '月額は3ヶ月ごとの更新です。続けるかは、質問の件数や減った問い合わせなどの数字で判断していただきます';
export const AFTER_STOP = '月額をやめても、整えた資料・よくある質問・手順書はお客さまの手元に残ります';

const man = (yen) => (yen % 10000 === 0 ? `${yen / 10000}万円` : `${yen.toLocaleString('ja-JP')}円`);

/** デモの最後に出す一文。効果は約束しない */
export function pricingText(key) {
  const m = MENUS[key];
  const trial = `${TRIAL.name} ${man(TRIAL.price)}（${TRIAL.text}）`;
  const cont = m.initial
    ? `続ける場合：初期 ${man(m.initial)}（お試しの${man(TRIAL.price)}を充てるので、残り${man(m.initial - TRIAL.price)}）＋月${man(m.monthly)}`
    : `続ける場合：月${man(m.monthly)}`;
  return `${trial} → ${cont}。${RENEWAL}。効果は約束せず、お試しで御社の数字を測ります（${TAX_NOTE}）。`;
}

/** チャットボットの知識用：料金の全体を文章にする */
export function pricingKnowledge() {
  const lines = [`${TAX_NOTE}。無料相談（60分）は無料です。`, `${TRIAL.name}：${man(TRIAL.price)}（${TRIAL.text}）。初期費用のあるメニューでは、${CREDIT}。`];
  for (const m of Object.values(MENUS)) {
    lines.push(`${m.name}：${m.initial ? `初期 ${man(m.initial)}＋` : ''}月${man(m.monthly)}。月額に含むもの：${m.includes}。`);
  }
  for (const o of OTHERS) lines.push(`${o.name}：${o.text}。`);
  lines.push(`${RENEWAL}。${AFTER_STOP}。`);
  return lines.join('\n');
}
