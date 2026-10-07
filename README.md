# ソエギ デモ（demo.withsoegi.jp）

設計書 v0.2 のうち、**デモ1（経理：レシート → Excel）とデモ2（労務：打刻データ → 残業の集計）** と共通の土台を実装したものです。
デモ3（宿の多言語対応）は `withsoegi.jp` 側のコードが別にあるため今回は含めていません。デモ4（社内検索）は「準備中」の表示のみです。

- Cloudflare Worker `soegi-demo`（静的ファイル `public/`＋API `src/`）。ビルド不要
- 画面は素のHTML/JS（ES modules）。ExcelJS は `public/vendor/` に同梱
- 何も保存しません。ログに本文を出しません（`observability` は無効のまま）

## 構成
| パス | 役割 |
|---|---|
| `src/worker.js` | `/api/verify` `/api/receipt` `/api/timecard`。回数制限→合言葉→検証→AI→形の検証（崩れたら1回だけ再試行） |
| `src/ai.js` | AI呼び出しの**1か所**。`AI_PROVIDER` = `deepseek`／`claude`／`mock` |
| `src/schemas.js` | ツール呼び出しのJSON Schemaと、Worker側の検証 |
| `public/js/overtime.js` | 残業の計算（純粋関数。AI不使用） |
| `public/js/receipt-check.js` | レシートのチェック（赤・黄・重複） |
| `public/js/*-xlsx.js` | Excel出力（ブラウザ内） |
| `public/sample/` | 架空の打刻データ（5人×2026年9月）。`npm run sample` で再生成 |
| `docs/demo-scenario.md` | 実演の台本 |

## ローカルで動かす
```
npm install
cp .dev.vars.example .dev.vars   # 合言葉は「ためし」、AI_PROVIDER=mock（固定の架空データを返す）
npm run dev                      # http://127.0.0.1:8787
npm test                         # 単体テスト
```

## デプロイ
```
wrangler secret put DEMO_PASSCODE      # 合言葉（日本語可）
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put ANTHROPIC_API_KEY  # claude に切り替えるときだけ
npm run deploy                         # demo.withsoegi.jp をカスタムドメインに（wrangler.toml の routes）
```
- 回数制限（同じIPから1分に30）は Rate Limiting バインディング `LIMITER`。合言葉の総当たりも同じ枠で止まります
- **本番（お客さんのデータを扱う導入）は `AI_PROVIDER=claude`**。`mock` は本番に設定しないこと
- DeepSeek の画像モデル名（`deepseek-v4-flash-vision-exp`）は実験的なため `DEEPSEEK_VISION_MODEL` で差し替え可。**手書きのレシート・タイムカードが読めるか、最初に実際に試してください**（読めなければ写真のデモだけ claude に）

## 実装メモ（設計書との対応・判断したところ）
- 残業の計算は分単位の整数。単体テストに、手計算した値（時間外・深夜・休日・日またぎ・休憩なし・連続勤務・判定の境界）と、サンプルを1分ずつ数える別実装との突き合わせを入れています
- 深夜は「休憩を昼間にとったもの」として引きません。日またぎは出勤した日で法定休日を判定します（Excelの「使った設定」シートにも明記）
- 週40時間超は参考表示のみ（月〜日、法定休日を除き、1日の所定分まで）
- 合言葉はヘッダーに日本語を載せられないため、画面側でURLエンコードして送っています
- CSPのため画面側のインライン style は使っていません（`h()` が CSSOM で設定）
