// 「御社の場合」の計算。サイト（withsoegi.jp）の「元が取れるかの目安」と同じ考え方・同じ時給を使う。
// 結果は目安。画面にも「実際の数字はお試しで測ります」と必ず出す（約束しない）。

export const WHO = {
  owner: { label: '社長・役員', wage: 5000 },
  office: { label: '事務の方', wage: 1500, note: '社会保険込み' },
  field: { label: '現場と兼任の方', wage: 2000 },
};

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param count 月の件数（枚・人など）
 * @param minutesPerUnit 1件あたりの手作業の分
 * @param ratePct そのうち短くなる割合（%）
 * @param who WHO のキー
 * @param monthlyFee 月額（円）
 */
export function calcRoi({ count, minutesPerUnit, ratePct, who, monthlyFee }) {
  const wage = WHO[who]?.wage ?? WHO.office.wage;
  const manualHours = Math.max(0, count) * Math.max(0, minutesPerUnit) / 60;
  const savedHours = manualHours * Math.min(100, Math.max(0, ratePct)) / 100;
  const value = Math.round(savedHours * wage);
  const breakEvenHours = monthlyFee / wage;
  let verdict;
  if (value >= monthlyFee * 1.05) verdict = 'over';
  else if (value >= monthlyFee * 0.95) verdict = 'even';
  else if (value >= monthlyFee / 2) verdict = 'near';
  else verdict = 'under';
  return { wage, manualHours: round1(manualHours), savedHours: round1(savedHours), value, breakEvenHours: round1(breakEvenHours), shortHours: round1(Math.max(0, breakEvenHours - savedHours)), verdict };
}

export function verdictText(r, monthlyFee) {
  const fee = `月${(monthlyFee / 10000).toLocaleString('ja-JP')}万円`;
  switch (r.verdict) {
    case 'over': return `時間の削減だけで、${fee}を上回る目安です。お試し導入で、この数字が本当に出るかを確かめましょう。`;
    case 'even': return `時間の削減だけで、ちょうど${fee}に届く目安です。`;
    case 'near': return `あと月${r.shortHours}時間の削減で届く目安です。ミスの手直しや、お客さまを待たせる時間など、お金に直結する数字も一緒に測ると判断しやすくなります。`;
    default: return '時間の削減だけでは、割に合わない可能性があります。無理におすすめはしません。作業量が多い別の業務がないか、一緒に探しましょう。';
  }
}
