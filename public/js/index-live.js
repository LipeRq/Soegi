// 入口のタイルの「動きの見本」。中身は各デモの台本（docs/demo-scenario.md）と同じ架空データ。
// - AIも通信も使わない。決まった文を、順に出しているだけ
// - HTML には最後の状態を書いてある（スクリプトが動かなくても、動きを減らす設定でも、そのまま読める）
// - 画面の外・裏のタブでは止める

import { reduced, sleep, typeText, replay, watchVisible } from './motion.js';

const $ = (id) => document.getElementById(id);

const RECEIPTS = [
  { payee: 'さくら文具店', item: 'コピー用紙・ボールペン', total: '¥1,980' },
  { payee: 'みどり食堂', item: '日替わり定食 2名', total: '¥1,760' },
  { payee: 'あおぞらガソリンスタンド', item: 'レギュラー給油', total: '¥6,200' },
  { payee: '山の駅 売店', item: '飲料・菓子', total: '¥1,200' },
];

const KNOWLEDGE = [
  {
    role: '社長の質問', q: '去年、やまびこスーパー（仮）向けに出したラ・フランスジャムの単価は？',
    a: '420円（税抜）です。見積書 No.2025-031 の1行目です。', safe: false, cite: '見積書 No.2025-031',
    doc: '見積書 No.2025-031（やまびこスーパー（仮）・2025年9月）',
    lines: ['件名：秋の果物フェア向け', 'ラ・フランスジャム 150g｜単価 420円｜数量 600個', 'ドライラ・フランス 40g｜単価 390円｜数量 300個'],
  },
  {
    role: '現場リーダーの質問', q: '充填機でE-07が出た。どうする？',
    a: 'E-07 はノズルのつまりです。赤い停止ボタンを押し、電源を切ります。', safe: true, cite: '充填機エラー表 E-07',
    doc: '充填機エラー表（FL-200型）',
    lines: ['E-07 ノズルのつまり', '1. 赤い停止ボタンを押します。2. 電源を切り、画面が消えたことを確かめます。', '3. ノズルは熱いので、耐熱手袋を着けます。'],
  },
];

const FOREIGN = [
  {
    role: 'ベトナム人スタッフの質問', q: 'Tôi muốn xin nghỉ phép có lương, phải làm thế nào?',
    a: 'Khi muốn nghỉ phép có lương, bạn hãy nộp "Đơn xin nghỉ" (休暇届) cho trưởng nhóm ít nhất 3 ngày trước ngày muốn nghỉ.',
    e: 'ゆうきゅうきゅうかを つかう ときは、やすみたい ひの 3にち まえまでに「きゅうかとどけ」を はんちょうに だします。',
    safe: false, cite: '就業規則（抜粋）有給休暇の申請',
  },
  {
    role: 'インドネシア人スタッフの質問', q: 'Apakah saya boleh memakai sarung tangan yang sama setelah istirahat?',
    a: 'Tidak boleh. Sarung tangan hanya untuk sekali pakai. Setelah istirahat, gantilah dengan sarung tangan yang baru.',
    e: 'つかえません。てぶくろは 1かいだけ つかいます。きゅうけいの あとは、あたらしい てぶくろに かえます。',
    safe: true, cite: '衛生ルール 手袋',
  },
];

const INN = [
  { q: '小孩對雞蛋過敏，晚餐可以處理嗎？', ja: '子どもが卵アレルギーですが、夕食は対応してもらえますか？', a: '如果您能在抵達前3天告知，我們會商量是否能夠對應。', checks: ['要確認：アレルギーの具体的な対応', '要確認：空室'] },
  { q: 'Do you have a pick-up service?', ja: '送迎はありますか？', a: 'We offer a free pick-up from Zao Onsen Bus Terminal to our inn between 3 pm and 6 pm.', checks: ['要確認：バスの時刻'] },
  { q: '전세 온천(가족탕)은 예약이 필요한가요?', ja: '貸切風呂は予約が必要ですか？', a: '전세 온천(가족탕)은 2곳이 있으며, 예약은 필요 없습니다.', checks: [] },
];

const BOT = [
  { q: '料金はいくら？', a: 'お試し導入は、1業務・1ヶ月で5万円（税抜）です。', link: '料金' },
  { q: 'Do you support companies outside Yamagata?', a: 'We visit companies in Yamagata, and work online anywhere in Japan.', link: '事業者概要' },
];

/** 見えている間だけ、step を繰り返す */
async function loop(el, firstWait, step) {
  const visible = watchVisible(el);
  await sleep(firstWait);
  for (let i = 0; ; i += 1) {
    while (!visible()) await sleep(500);
    await step(i);
  }
}

function receipts() {
  const box = $('live-rc');
  const rows = Array.from(box.querySelectorAll('tbody tr'));
  const set = (n) => {
    $('rc-cnt').textContent = String(n);
    $('rc-prog').style.setProperty('--p', `${(n / rows.length) * 100}%`);
  };
  loop(box, 2600, async () => {
    rows.forEach((r) => r.classList.add('off'));
    set(0);
    for (let i = 0; i < rows.length; i += 1) {
      const r = RECEIPTS[i];
      $('rc-payee').textContent = r.payee; $('rc-item').textContent = r.item; $('rc-total').textContent = r.total;
      await sleep(950);
      rows[i].classList.remove('off');
      set(i + 1);
    }
    await sleep(3600);
  });
}

/** 受注：注文書の行を1行ずつ読み、照らし合わせた結果の行が増える（注意・要確認の印は、行と一緒に最初から出る） */
function orders() {
  const box = $('live-od');
  const rows = Array.from(box.querySelectorAll('tbody tr'));
  const lines = Array.from(box.querySelectorAll('.paper span'));
  const set = (n) => {
    $('od-cnt').textContent = String(n);
    $('od-prog').style.setProperty('--p', `${(n / rows.length) * 100}%`);
  };
  loop(box, 3800, async () => {
    rows.forEach((r) => r.classList.add('off'));
    set(0);
    for (let i = 0; i < rows.length; i += 1) {
      lines.forEach((l, k) => l.classList.toggle('hit', k === i));
      await sleep(900);
      rows[i].classList.remove('off');
      set(i + 1);
    }
    lines.forEach((l) => l.classList.remove('hit'));
    await sleep(3600);
  });
}

/** 労務：シフト表を左の日から確かめていき、赤・黄のマスに言葉が出る（下の一文は、最後に見つけた問題） */
function shifts() {
  const box = $('live-sf');
  const rows = Array.from(box.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')));
  const flagged = rows.flat().filter((td) => td.dataset.note);
  loop(box, 4400, async () => {
    flagged.forEach((td) => td.classList.add('off'));
    for (let c = 0; c < rows[0].length; c += 1) {
      rows.forEach((r) => r[c].classList.add('scan'));
      await sleep(650);
      rows.forEach((r) => {
        const td = r[c];
        td.classList.remove('scan');
        if (!td.classList.contains('off')) return;
        td.classList.remove('off');
        $('sf-note').textContent = td.dataset.note;
        $('sf-chip').className = `chip ${td.classList.contains('r') ? 'r' : 'y'}`;
        $('sf-chip').textContent = td.classList.contains('r') ? '要確認' : '注意';
      });
    }
    await sleep(3800);
  });
}

/** 日報：話した言葉の中から、項目が1つずつ埋まっていく（最後の「時間」は話に無いので、聞き返しのまま） */
function reports() {
  const box = $('live-rp');
  const rows = Array.from(box.querySelectorAll('tbody tr'));
  loop(box, 5000, async () => {
    rows.forEach((r) => r.classList.add('off'));
    for (const r of rows) {
      await sleep(850);
      r.classList.remove('off');
    }
    await sleep(3600);
  });
}

/** 月次：顧客の行が1つずつ現れる（伸びた所・落ちた所を、色と記号と言葉で） */
function monthlies() {
  const box = $('live-mo');
  const rows = Array.from(box.querySelectorAll('tbody tr'));
  loop(box, 5000, async () => {
    rows.forEach((r) => r.classList.add('off'));
    for (const r of rows) {
      await sleep(800);
      r.classList.remove('off');
    }
    await sleep(3800);
  });
}

function overtime() {
  const box = $('live-ot');
  loop(box, 6000, async () => { replay(box); await sleep(6500); });
}

function knowledge() {
  const box = $('live-kb');
  loop(box, 4200, async (i) => {
    const s = KNOWLEDGE[(i + 1) % KNOWLEDGE.length];
    // 「必ずリーダーに確認」は、答えを打ち始める前から出す（答えより後に出さない）
    $('kb-cite').classList.add('off'); $('kb-safe').hidden = !s.safe;
    $('kb-role').textContent = s.role; $('kb-q').textContent = s.q; $('kb-a').textContent = '';
    replay($('kb-q'), 'in');
    await sleep(500);
    await typeText($('kb-a'), s.a, { cps: 34, maxMs: 2000 });
    $('kb-cite').textContent = s.cite; $('kb-cite').classList.remove('off');
    $('kb-doc').textContent = s.doc;
    $('kb-l0').textContent = s.lines[0]; $('kb-l1').textContent = s.lines[1]; $('kb-l2').textContent = s.lines[2];
    replay($('kb-l1'), 'sweep');
    await sleep(5200);
  });
}

function foreign() {
  const box = $('live-fs');
  loop(box, 5200, async (i) => {
    const s = FOREIGN[(i + 1) % FOREIGN.length];
    $('fs-cite').classList.add('off'); $('fs-safe').hidden = !s.safe;
    $('fs-role').textContent = s.role; $('fs-q').textContent = s.q; $('fs-a').textContent = ''; $('fs-e').textContent = '';
    replay($('fs-q'), 'in');
    await sleep(500);
    await typeText($('fs-a'), s.a, { cps: 44, maxMs: 2000 });
    await typeText($('fs-e'), s.e, { cps: 34, maxMs: 1800 });
    $('fs-cite').textContent = s.cite; $('fs-cite').classList.remove('off');
    await sleep(5600);
  });
}

function inn() {
  const box = $('live-inn');
  const langs = Array.from(box.querySelectorAll('.langs span'));
  loop(box, 3400, async (i) => {
    const n = (i + 1) % INN.length;
    const s = INN[n];
    langs.forEach((l, k) => l.classList.toggle('on', k === n));
    const checks = $('inn-c');
    while (checks.firstChild) checks.firstChild.remove();
    $('inn-q').textContent = s.q; $('inn-j').textContent = s.ja; $('inn-a').textContent = '';
    replay($('inn-q'), 'in');
    // 「要確認」は、返信の下書きを打ち始める前から出す（下書きより後に出さない）
    for (const c of s.checks) {
      const chip = document.createElement('span');
      chip.className = 'chip w';
      chip.textContent = c;
      checks.append(chip);
    }
    await sleep(500);
    await typeText($('inn-a'), s.a, { cps: 40, maxMs: 1800 });
    await sleep(4200);
  });
}

function bot() {
  const box = $('live-bot');
  loop(box, 4600, async (i) => {
    const s = BOT[(i + 1) % BOT.length];
    $('bot-l').classList.add('off');
    $('bot-q').textContent = s.q; $('bot-a').textContent = '';
    replay($('bot-q'), 'in');
    await sleep(500);
    await typeText($('bot-a'), s.a, { cps: 36, maxMs: 1800 });
    $('bot-l').textContent = s.link; $('bot-l').classList.remove('off');
    await sleep(4800);
  });
}

export function startLive() {
  if (reduced()) return;
  receipts(); overtime(); orders(); shifts(); reports(); monthlies(); knowledge(); foreign(); inn(); bot();
}
