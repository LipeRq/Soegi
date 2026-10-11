# ソエギ デモ（demo.withsoegi.jp）

山形の会社の「3つの壁」（手入力・知識・言葉）を、AIで「探す・答える・訳す」を見せるデモです。登場する会社・宿・人物はすべて架空です。

| デモ | 画面 | パスワード |
|---|---|---|
| ① 経理：レシート → Excel | `/receipt.html` | 要 |
| ① 労務：打刻データ → 残業の集計 | `/attendance.html` | 要 |
| A 社内ナレッジ検索＋外国人スタッフ向け | `/knowledge.html` | 要 |
| B 宿の多言語対応 | `/inn.html` | 不要（サイトからリンク） |
| C サイトのチャットボット | `/chatbot.html`、`/widget/chat.js`（サイトに1行貼る） | 不要 |

- 台本：`docs/demo-scenario.md`
- 設計（v0.2からの改良点・決めてほしいこと）：`docs/design-v0.3.md`
- デザインシステム「ライブ」（色・書体・動き・部品・本番への適用）：`docs/design-system-v1.md`
- サイト（withsoegi.jp）に足すもの：`docs/site-embed.md`

## 構成

Cloudflare Worker `soegi-demo`（静的ファイル `public/`＋API `src/`）。ビルド不要。画面は素のHTML/JS（ES modules）、ExcelJS は `public/vendor/` に同梱。

| パス | 役割 |
|---|---|
| `src/worker.js` | 入口。回数制限 → パスワード（demo側のデモだけ）→ 各デモの処理 |
| `src/ai.js` | AI呼び出しの**1か所**。`AI_PROVIDER` = `deepseek`／`claude`／`mock` |
| `src/schemas.js` | AIに返させるJSONの形と検証（崩れたら1回だけ再試行） |
| `src/core/` | AIの答えを**プログラムで確かめる**部分（根拠の照合、要確認の追加、リンクの制限、言語ごとの決まった文） |
| `src/demos/` | 各デモのプロンプトと処理 |
| `src/guard.js` | 1分・1日の回数制限、パスワード、Turnstile、CORS |
| `src/cache.js` | 宿の例文・よくある質問の結果の使い回し |
| `src/mock.js` | `AI_PROVIDER=mock` の固定の架空データ（台本の質問に合わせてある） |
| `public/data/` | 架空の資料（さくらんぼ食品（仮））、宿の情報、チャットボットの知識 |
| `public/css/style.css` | 共通のデザイン（色・書体・角丸・動きの変数と共通部品）。画面ごとの見た目は `public/css/<画面>.css`（変数だけを使う）。設計は `docs/design-system-v1.md` |
| `public/js/motion.js` | 共通の動きの部品（数え上げ・タイプ・順に出す など。「動きを減らす」設定では動かさない） |
| `public/js/pricing.js` | 料金（画面の案内とチャットボットの知識の両方がここを使う） |
| `public/js/overtime.js` ほか | 残業の計算・レシートのチェック・Excel・「御社の場合」の計算（すべてプログラム） |

## ローカルで動かす（AIキー不要）

```
npm install
cp .dev.vars.example .dev.vars   # パスワード「ためし」、AI_PROVIDER=mock
npm run dev                      # http://127.0.0.1:8787
npm test                         # 単体テスト
```

`mock` では、どのデモも固定の架空データで最後まで動きます（社内検索・宿・チャットボットは台本の質問に合わせた答えを返します）。

## 公開する

```
npx wrangler login
npx wrangler secret put DEMO_PASSCODE      # パスワード（日本語可）
npx wrangler secret put DEEPSEEK_API_KEY
npm run deploy
```

必要に応じて：

| 使うもの | 設定 | 無いとき |
|---|---|---|
| 宿の自由入力のロボット対策 | Cloudflare で Turnstile のウィジェットを作り、`wrangler.toml` の `TURNSTILE_SITEKEY` にサイトキー、`npx wrangler secret put TURNSTILE_SECRET` にシークレット。ホスト名は `demo.withsoegi.jp` | 自由入力が「準備中」になる（例文は使える） |
| 1日の回数を数える KV | `npx wrangler kv namespace create DEMO_KV` → 出た id を `wrangler.toml` の `[[kv_namespaces]]` に入れてコメントを外す | Worker のメモリで数える（目安） |
| 本番（お客さんのデータ） | `AI_PROVIDER = "claude"`、`npx wrangler secret put ANTHROPIC_API_KEY` | — |

- **本番（お客さんのデータを扱う導入）は必ず `claude`**。`mock` は公開環境に設定しない
- DeepSeek のモデル名は変わりやすいので、公開前に公式ドキュメントで確認し、`DEEPSEEK_TEXT_MODEL`／`DEEPSEEK_VISION_MODEL` を直す
- 公開したら、台本の質問を一度ずつ実際に試す（宿の例文は1回目の結果が30日キャッシュされる）

## 守っていること

- AIは「読み取り・下書き・検索」だけ。残業の計算、レシートのチェック、根拠の照合、要確認の追加は**プログラム**
- 何も保存しない。ログに本文を出さない（宿の自由入力とチャットボットは、1日の回数だけをIPのハッシュで翌々日まで数える）
- 画面の文字は `textContent` だけで組み立てる（AIの出力をHTMLとして扱わない）。CSPで外部のスクリプトは Turnstile だけを許可
- 効果を約束しない。「御社の場合」の計算には必ず「目安。実際の数字はお試しで測ります」
