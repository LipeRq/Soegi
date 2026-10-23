// AI_PROVIDER=mock のときの固定の架空データ。AIを呼ばずに画面の流れを確かめるため（本番では使わない）。
// デモA〜Cは台本の例文に合わせた答えを返す。根拠の引用は実際の資料の文と同じにしてある（テストで照合）。

import orderSamples from '../public/samples/orders/samples.json' with { type: 'json' };
import timecardSamples from '../public/samples/timecards/samples.json' with { type: 'json' };

const MOCK_STORES = [
  { payee: 'さくら文具店', summary: 'コピー用紙・ボールペン', total: 1980, a10: 1980, a8: null, tax: 180, acc: '事務用品費', inv: 'T1234567890123' },
  { payee: 'みどり食堂', summary: '日替わり定食 2名', total: 1760, a10: null, a8: 1760, tax: 130, acc: '会議費', inv: 'T2345678901234' },
  { payee: 'あおぞらガソリンスタンド', summary: 'レギュラー給油', total: 6200, a10: 6200, a8: null, tax: 564, acc: '車両費（燃料）', inv: '' },
  { payee: '山の駅 売店', summary: '飲料・菓子', total: 1200, a10: 400, a8: 700, tax: 91, acc: '福利厚生費', inv: 'T3456789012345' },
];
let counter = 0;

function receipt() {
  const i = counter++ % MOCK_STORES.length;
  const s = MOCK_STORES[i];
  const d = new Date(Date.now() - (i + 1) * 3 * 86400000).toISOString().slice(0, 10);
  return {
    is_receipt: true, date: d, payee: s.payee, total: s.total,
    amount_10: s.a10, amount_8: s.a8, tax_amount: s.tax, invoice_no: s.inv,
    payment_method: '現金', summary: s.summary, account: s.acc,
    account_reason: '（モック）品目から推定した候補',
    confidence: { date: '高', payee: '高', total: '高', tax: i === 3 ? '低' : '中', invoice_no: s.inv ? '中' : '低', account: '中' },
  };
}

// 見本のタイムカード（public/samples/timecards/samples.json）の、AIが読んだとする内容。見本でない写真は順に返す
let timecardCounter = 0;
function timecard(sample) {
  const list = timecardSamples.samples;
  const s = list.find((x) => x.id === sample) ?? list[timecardCounter++ % list.length];
  return {
    employee_name: s.employee_name,
    entries: s.entries.map((x) => ({
      date: x.date, start: x.start, end: x.end, out: x.out, back: x.back, break_min: x.break_min,
      start_alt: x.start_alt, end_alt: x.end_alt,
      conf_start: x.conf.start, conf_end: x.conf.end, conf_out: x.conf.out, conf_back: x.conf.back, note: x.note,
    })),
  };
}

const KNOWLEDGE = [
  {
    when: /ラ・フランス/, out: {
      language: 'ja', question_ja: '', found: true, category: '見積・単価', safety_related: false,
      answer: '去年（2025年）、やまびこスーパー（仮）向けに出したラ・フランスジャム 150g の単価は、420円（税抜）です。見積書 No.2025-031（2025年9月12日、秋の果物フェア向け）の1行目です。なお、2026年3月の見積書 No.2026-008 では430円になっています。',
      answer_ja: '', easy_japanese: '',
      citations: [
        { doc_id: 'est-2025-031', section_id: 'l1', quote: 'ラ・フランスジャム 150g｜単価 420円｜数量 600個' },
        { doc_id: 'est-2026-008', section_id: 'l1', quote: 'ラ・フランスジャム 150g｜単価 430円' },
      ],
    },
  },
  {
    when: /E-?07/i, out: {
      language: 'ja', question_ja: '', found: true, category: '機械・エラー', safety_related: true,
      answer: 'E-07 はノズルのつまりです。\n1. 赤い停止ボタンを押します。\n2. 電源を切り、画面が消えたことを確かめます。\n3. ノズルは熱いので、耐熱手袋を着けます。\n4. ノズルを外し、60℃以上のお湯で洗います。\n5. ノズルを取り付け、電源を入れて、試しに3本充填します。\n6. それでも E-07 が出るときは、班長を呼びます。',
      answer_ja: '', easy_japanese: '',
      citations: [{ doc_id: 'errors', section_id: 'e07', quote: '1. 赤い停止ボタンを押します。2. 電源を切り、画面が消えたことを確かめます。' }],
    },
  },
  {
    when: /nghỉ phép/i, out: {
      language: 'vi', question_ja: '有給休暇を取りたいです。どうすればいいですか？', found: true, category: '有給・休み', safety_related: false,
      answer: 'Khi muốn nghỉ phép có lương, bạn hãy nộp "Đơn xin nghỉ" (休暇届) cho trưởng nhóm ít nhất 3 ngày trước ngày muốn nghỉ. Đơn có trong tập hồ sơ màu xanh trên kệ ở văn phòng. Trong tập hồ sơ đó cũng có mẫu hướng dẫn cách viết bằng tiếng Việt.',
      answer_ja: '有給休暇を使うときは、休みたい日の3日前までに「休暇届」を班長に出します。休暇届は事務所の棚の青いファイルにあり、ベトナム語の書き方の見本も同じファイルにあります。',
      easy_japanese: 'ゆうきゅうきゅうかを つかう ときは、やすみたい ひの 3にち まえまでに「きゅうかとどけ」を はんちょうに だします。かみは じむしょの たなの あおい ファイルに あります。ベトナムごの みほんも あります。',
      citations: [{ doc_id: 'rules', section_id: 'r1', quote: '有給休暇を使うときは、休みたい日の3日前までに「休暇届」を班長に出します。' }],
    },
  },
  {
    when: /sarung tangan/i, out: {
      language: 'id', question_ja: '休憩のあとに、同じ手袋を使ってもいいですか？', found: true, category: '衛生', safety_related: true,
      answer: 'Tidak boleh. Sarung tangan hanya untuk sekali pakai. Setelah istirahat, jangan memakai sarung tangan yang sama; gantilah dengan sarung tangan yang baru. Sebelum itu, cuci tangan dengan sabun selama 30 detik dan disinfeksi dengan alkohol.',
      answer_ja: '使えません。手袋は使い捨てです。休憩のあとは同じ手袋を使わず、新しい手袋に替えます。その前に、せっけんで30秒手を洗い、アルコールで消毒します。',
      easy_japanese: 'つかえません。てぶくろは 1かいだけ つかいます。きゅうけいの あとは、あたらしい てぶくろに かえます。その まえに、せっけんで 30びょう てを あらって、アルコールで しょうどく します。',
      citations: [
        { doc_id: 'hygiene', section_id: 's2', quote: '休憩のあとは、同じ手袋を使わず、新しい手袋に替えます。' },
        { doc_id: 'hygiene', section_id: 's1', quote: '休憩のあとは、せっけんで30秒手を洗い、アルコールで消毒します。' },
      ],
    },
  },
];

function knowledge(userText) {
  const q = userText.split('質問：').pop();
  const hit = KNOWLEDGE.find((k) => k.when.test(q));
  if (hit) return { ...hit.out, question_ja: hit.out.question_ja || q.trim() };
  return {
    language: /[a-z]{4,}/i.test(q) && !/[ぁ-んァ-ン一-龥]/.test(q) ? 'en' : 'ja', question_ja: q.trim(), found: false,
    answer: '', answer_ja: '', easy_japanese: '', citations: [], safety_related: false, category: 'その他',
  };
}

const INN = {
  'zh-family': {
    language: 'zh-TW', inquiry_ja: '2月に家族4人（大人2人、子ども2人）で泊まりたいです。子どもが卵アレルギーですが、夕食は対応してもらえますか？また、夜も樹氷は見られますか？',
    reply: '您好，感謝您對蔵王溫泉 ゆきあかり荘（仮）的詢問。\n\n關於2月一家四口的住宿，空房情況需要確認，我們的負責人會再與您聯繫。\n\n關於孩子的雞蛋過敏：如果您能在抵達前3天告知，我們會商量是否能夠對應。不過，因為在同一個廚房烹調，我們無法保證完全去除過敏原，敬請見諒。\n\n樹冰的最佳觀賞期一般為1月下旬至2月下旬，可在纜車山頂站附近觀賞。夜間點燈的日程每年不同，本館無法提供確定的資訊，請參考營運公司的官方資訊。\n\n期待您的光臨。\nゆきあかり荘（仮） 全體員工',
    reply_ja: 'お問い合わせありがとうございます。\n\n2月のご家族4名様のご宿泊について、空室の状況は確認が必要なため、担当者から改めてご連絡します。\n\nお子さまの卵アレルギーについて：到着の3日前までにお知らせいただければ、対応できるかを相談します。ただし、同じ調理場で調理しているため、完全な除去はお約束できません。\n\n樹氷の見頃は例年1月下旬から2月下旬で、ロープウェイの山頂駅付近で見られます。夜のライトアップの日程は年によって変わるため、宿では確定の情報をお伝えできません。運営会社の公式情報をご確認ください。\n\nお越しをお待ちしております。\nゆきあかり荘（仮） スタッフ一同',
    needs_check: [{ point: '2月の空室', reason: '日付と人数が決まっていないため' }, { point: 'アレルギーの具体的な対応', reason: '調理場の状況を料理長に確認' }],
    used_info_ids: ['allergy', 'juhyo', 'rooms'],
  },
  'en-access': {
    language: 'en', inquiry_ja: '15時ごろに山形駅に着きます。宿まではどう行けばいいですか？送迎はありますか？',
    reply: 'Thank you for your message.\n\nFrom the East Exit of Yamagata Station, please take the local bus bound for Zao Onsen (about 40 minutes) and get off at the last stop, Zao Onsen Bus Terminal. Please check the latest bus timetable before your trip.\n\nWe offer a free pick-up from Zao Onsen Bus Terminal to our inn (about 3 minutes by car) between 3 pm and 6 pm. Please call the inn before you arrive at the terminal. We are sorry that we do not offer pick-up from Yamagata Station.\n\nWe look forward to welcoming you.\nThe staff of Yukiakari-so',
    reply_ja: 'ご連絡ありがとうございます。\n\n山形駅の東口から、蔵王温泉行きの路線バス（約40分）にお乗りいただき、終点の蔵王温泉バスターミナルでお降りください。お出かけ前に最新の時刻表をご確認ください。\n\n蔵王温泉バスターミナルから宿までは、15時から18時の間、無料で送迎します（車で約3分）。ターミナルに着く前に、宿へお電話ください。山形駅からの送迎はございません。\n\nお越しをお待ちしております。\nゆきあかり荘（仮） スタッフ一同',
    needs_check: [{ point: 'バスの時刻', reason: '宿の情報の時刻はデモ用の例' }],
    used_info_ids: ['access', 'pickup'],
  },
  'ko-bath': {
    language: 'ko', inquiry_ja: '貸切風呂は予約が必要ですか？何時まで使えますか？',
    reply: '안녕하세요. 문의해 주셔서 감사합니다.\n\n전세 온천(가족탕)은 2곳이 있으며, 예약은 필요 없습니다. 비어 있으면 안쪽에서 문을 잠그고 이용하실 수 있습니다. 1회 40분까지, 오후 3시부터 밤 11시까지 이용 가능합니다.\n\n편안한 시간 보내시길 바랍니다.\nゆきあかり荘（仮） 직원 일동',
    reply_ja: 'お問い合わせありがとうございます。\n\n貸切風呂は2つあり、予約はいりません。空いていれば、内側から鍵をかけてお使いいただけます。1回40分まで、15時から23時までご利用いただけます。\n\nごゆっくりお過ごしください。\nゆきあかり荘（仮） スタッフ一同',
    needs_check: [],
    used_info_ids: ['private_bath'],
  },
};

function innReply(userText) {
  if (/雞蛋|過敏/.test(userText)) return INN['zh-family'];
  if (/Yamagata Station|pick/i.test(userText)) return INN['en-access'];
  if (/가족탕|전세/.test(userText)) return INN['ko-bath'];
  return {
    language: 'ja', inquiry_ja: '（モック）自由入力の問い合わせ', reply: '（モック）お問い合わせありがとうございます。担当者から改めてご連絡します。',
    reply_ja: '（モック）お問い合わせありがとうございます。担当者から改めてご連絡します。', needs_check: [{ point: '問い合わせの内容', reason: 'モックのため' }], used_info_ids: [],
  };
}

const REVIEW = {
  'zh-bath': {
    language: 'zh-TW', review_ja: '部屋はとてもきれいで、スタッフも親切でした。ただ、大浴場のお湯がぬるく、温まりませんでした。また、午後4時に着いたのに、チェックインができたのは5時近くで、少しがっかりしました。',
    reply: '您好，非常感謝您入住蔵王溫泉 ゆきあかり荘（仮），也謝謝您留下寶貴的意見。\n\n大浴場的水溫讓您無法暖和身體，以及辦理入住時讓您久等，我們深感抱歉。我們會向相關人員確認當時的狀況，並作為今後改善的參考。\n\n我們也很高興您覺得客房整潔、服務親切。衷心期待您再次光臨。\nゆきあかり荘（仮） 全體員工',
    reply_ja: 'ご宿泊いただき、また貴重なご意見をありがとうございます。\n\n大浴場のお湯の温度で温まっていただけなかったこと、チェックインでお待たせしたことを、申し訳なく思います。当時の状況を担当者に確認し、今後の参考にいたします。\n\n客室の清潔さと接客をお喜びいただけたことも、うれしく思います。またのお越しを心よりお待ちしております。\nゆきあかり荘（仮） スタッフ一同',
    points: [{ kind: 'praise', text: '客室がきれい・スタッフが親切' }, { kind: 'complaint', text: '大浴場のお湯がぬるかった' }, { kind: 'complaint', text: '16時に着いたのに、チェックインが17時近くになった（待ち時間）' }],
    needs_check: [{ point: '大浴場の温度の記録', reason: 'その日の湯温を確かめて、事実かどうかを責任者が判断します' }, { point: 'チェックインが遅れた事情', reason: '当日の受付の状況を確認してから、お詫びの言い方を決めます' }],
    used_info_ids: ['checkin', 'bath'],
  },
  'en-juhyo': {
    language: 'en', review_ja: '素晴らしい滞在をありがとうございました。田中さんが樹氷について丁寧に説明してくれ、地元の野菜を使った夕食もおいしかったです。来年の冬もまた来たいです。',
    reply: 'Thank you very much for your kind words, and for choosing to stay with us.\n\nWe are delighted that you enjoyed the explanation about the snow monsters (juhyo) and our dinner with local vegetables. We will share your message with the whole team.\n\nWe look forward to welcoming you again next winter.\nThe staff of Yukiakari-so',
    reply_ja: 'あたたかいお言葉と、当館をお選びいただいたことに、心から感謝いたします。\n\n樹氷のご案内と、地元の野菜を使った夕食をお楽しみいただけたことを、うれしく思います。お言葉はスタッフ全員に伝えます。\n\n来年の冬も、お越しをお待ちしております。\nゆきあかり荘（仮） スタッフ一同',
    points: [{ kind: 'praise', text: 'スタッフが樹氷を丁寧に説明してくれた（「田中」さん）' }, { kind: 'praise', text: '地元の野菜を使った夕食がおいしかった' }, { kind: 'request', text: '来年の冬にまた来たい' }],
    needs_check: [],
    used_info_ids: ['juhyo', 'dinner'],
  },
  'ja-dinner': {
    language: 'ja', review_ja: 'お部屋からの眺めは最高で、お風呂も気持ちよかったです。ただ、夕食は美味しかったものの、量が少なく感じました。もう少しボリュームがあると嬉しいです。',
    reply: 'このたびは、ゆきあかり荘（仮）にご宿泊いただき、また口コミをお寄せいただき、ありがとうございます。\n\nお部屋からの眺めとお風呂をお喜びいただけて、うれしく思います。一方で、夕食の量を少なく感じられたとのこと、申し訳ございません。いただいたご意見は、調理担当と共有し、今後の参考にいたします。\n\nまたのお越しを、スタッフ一同お待ちしております。\nゆきあかり荘（仮） スタッフ一同',
    reply_ja: 'このたびは、ゆきあかり荘（仮）にご宿泊いただき、また口コミをお寄せいただき、ありがとうございます。\n\nお部屋からの眺めとお風呂をお喜びいただけて、うれしく思います。一方で、夕食の量を少なく感じられたとのこと、申し訳ございません。いただいたご意見は、調理担当と共有し、今後の参考にいたします。\n\nまたのお越しを、スタッフ一同お待ちしております。\nゆきあかり荘（仮） スタッフ一同',
    points: [{ kind: 'praise', text: '部屋からの眺めが最高・お風呂が気持ちよかった' }, { kind: 'praise', text: '夕食は美味しかった' }, { kind: 'complaint', text: '夕食の量が少なく感じた' }, { kind: 'request', text: 'もう少しボリュームがあると嬉しい' }],
    needs_check: [{ point: '夕食の量の見直し', reason: '量を変えるかどうかは、調理担当と責任者が決めます（下書きでは約束していません）' }],
    used_info_ids: ['dinner'],
  },
};

function innReview(userText) {
  if (/雞蛋|水溫|大浴場|辦好入住/.test(userText)) return REVIEW['zh-bath'];
  if (/snow monsters|juhyo/i.test(userText)) return REVIEW['en-juhyo'];
  if (/量が少なく/.test(userText)) return REVIEW["ja-dinner"];
  return {
    language: 'ja', review_ja: '（モック）自由入力の口コミ', reply: '（モック）口コミをお寄せいただき、ありがとうございます。',
    reply_ja: '（モック）口コミをお寄せいただき、ありがとうございます。', points: [{ kind: 'complaint', text: '（モック）' }], needs_check: [], used_info_ids: [],
  };
}

function innFaq() {
  return {
    items: [
      { info_ids: ['checkin', 'checkout'], q_ja: 'チェックイン・チェックアウトは何時ですか？', a_ja: 'チェックインは15時から18時、チェックアウトは10時までです。', q_zh: '入住和退房時間是幾點？', a_zh: '入住時間為15點至18點，退房時間為10點前。', q_en: 'What are the check-in and check-out times?', a_en: 'Check-in is from 3 pm to 6 pm. Check-out is by 10 am.', q_ko: '체크인·체크아웃은 몇 시인가요?', a_ko: '체크인은 오후 3시부터 6시, 체크아웃은 오전 10시까지입니다.' },
      { info_ids: ['allergy'], q_ja: '食物アレルギーに対応できますか？', a_ja: '到着の3日前までにご連絡いただければ、対応できるかを相談します。同じ調理場で調理しているため、完全な除去はお約束できません。', q_zh: '可以對應食物過敏嗎？', a_zh: '請於抵達前3天告知，我們會商量是否能夠對應。由於在同一廚房烹調，無法保證完全去除。', q_en: 'Can you handle food allergies?', a_en: 'Please tell us at least 3 days before arrival and we will discuss what we can do. As all meals are prepared in the same kitchen, we cannot guarantee complete removal of allergens.', q_ko: '음식 알레르기에 대응할 수 있나요?', a_ko: '도착 3일 전까지 알려 주시면 대응 가능 여부를 상의합니다. 같은 주방에서 조리하므로 완전한 제거는 약속드릴 수 없습니다.' },
      { info_ids: ['pickup', 'access'], q_ja: '送迎はありますか？', a_ja: '蔵王温泉バスターミナルから宿まで、15時から18時の間、無料で送迎します。到着前にお電話ください。山形駅からの送迎はありません。', q_zh: '有接送服務嗎？', a_zh: '15點至18點之間，提供從蔵王溫泉巴士總站到本館的免費接送。抵達前請來電。不提供山形站的接送。', q_en: 'Do you offer a pick-up service?', a_en: 'We offer a free pick-up from Zao Onsen Bus Terminal between 3 pm and 6 pm. Please call us before you arrive. There is no pick-up from Yamagata Station.', q_ko: '송영 서비스가 있나요?', a_ko: '오후 3시부터 6시 사이에 자오온센 버스터미널에서 무료로 송영합니다. 도착 전에 전화해 주세요. 야마가타역 송영은 없습니다.' },
    ],
  };
}

function siteAnswer(userText) {
  const q = userText.split('今回の質問：').pop();
  if (/料金|いくら|price|cost/i.test(q)) {
    return { language: /[ぁ-ん一-龥]/.test(q) ? 'ja' : 'en', found: true, answer: '（モック）料金はサイトの料金表のとおりです。お試し導入は1業務・1ヶ月で5万円（税抜）です。社内ナレッジ検索は初期15万円＋月5万円です。', link_ids: ['price'], suggest_consult: true, category: '料金' };
  }
  if (/outside|Yamagata/i.test(q)) {
    return { language: 'en', found: true, answer: '(Mock) We visit companies in Yamagata Prefecture. Outside Yamagata, we can support you online.', link_ids: ['about'], suggest_consult: true, category: '対応範囲' };
  }
  if (/補助金/.test(q)) {
    return { language: 'ja', found: true, answer: '（モック）補助金の申請書の作成は、行政書士の先生の業務のためお引き受けしていません。使える制度がある場合は、確かなものだけをご案内します。', link_ids: ['service', 'safety'], suggest_consult: false, category: '対応範囲' };
  }
  return { language: 'ja', found: false, answer: '', link_ids: [], suggest_consult: true, category: 'その他' };
}

// 受注：見本の注文書を使ったときは、その見本の中身を「読めた」ことにする。それ以外の写真は見本を順に返す
let orderCounter = 0;
function order(sample) {
  const s = orderSamples.samples.find((x) => x.id === sample) ?? orderSamples.samples[orderCounter++ % orderSamples.samples.length];
  const handwritten = s.kind !== '印字';
  return {
    is_order: true, customer: s.customer, order_date: s.order_date, delivery_date: s.delivery_date, note: s.note,
    confidence: { customer: handwritten ? '中' : '高', order_date: handwritten ? '中' : '高', delivery_date: s.delivery_date ? '高' : '低' },
    lines: s.lines.map((l) => ({
      name: l.name, spec: l.spec ?? '', qty: l.qty, unit: l.unit ?? '', unit_price: l.unit_price ?? null, amount: l.amount ?? null,
      conf_name: l.conf_name ?? (handwritten ? '中' : '高'), conf_qty: l.conf_qty ?? (handwritten ? '中' : '高'),
    })),
  };
}

export function mockResponse({ tool, userText, sample }) {
  switch (tool.name) {
    case 'submit_receipt': return receipt();
    case 'submit_timecard': return timecard(sample);
    case 'submit_order': return order(sample);
    case 'submit_answer': return knowledge(userText);
    case 'submit_inn_reply': return innReply(userText);
    case 'submit_inn_review': return innReview(userText);
    case 'submit_inn_faq': return innFaq();
    case 'submit_site_answer': return siteAnswer(userText);
    default: throw new Error(`mock: ${tool.name}`);
  }
}

/**
 * 「御社の資料で試す」の見本（AIを呼ばない）：質問と一番近い1文を、資料から引用して答える。
 * 近い文が無ければ、引用なし（＝「見当たりません」になる）。
 */
export function mockDocAnswer(docs, question) {
  const grams = (t) => {
    const s = String(t).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const out = new Set();
    for (let i = 0; i + 2 <= s.length; i += 1) out.add(s.slice(i, i + 2));
    return out;
  };
  const q = grams(question);
  let best = null;
  docs.forEach((d, di) => {
    for (const m of d.text.matchAll(/[^。\n]+[。]?/g)) {
      const sentence = m[0];
      if (sentence.trim().length < 6) continue;
      const g = grams(sentence);
      let score = 0;
      for (const x of q) if (g.has(x)) score += 1;
      if (!best || score > best.score) best = { score, di, start: m.index, end: m.index + sentence.length, sentence };
    }
  });
  if (!best || best.score < 3) return { text: '資料には、この質問に答える内容が見当たりません。', citations: [], usage: null };
  const quote = best.sentence.trim();
  const start = best.start + best.sentence.indexOf(quote);
  return {
    text: `資料には次のように書かれています：${quote}`,
    citations: [{ type: 'char_location', document_index: best.di, cited_text: quote, start_char_index: start, end_char_index: start + quote.length }],
    usage: null,
  };
}
