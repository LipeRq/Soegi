# Cloudflare への反映（既存の設定を壊さない手順）

対象：Worker `soegi-demo`（`demo.withsoegi.jp`）。ソエギのサイト本体（withsoegi.jp の Worker「soegi」）には触れません。
`npm run deploy`（＝ `wrangler deploy`）は、**コードと静的ファイルを丸ごと入れ替え**、`wrangler.toml` に書いた設定で上書きします。次の3つだけ注意すれば、既存の設定は残ります。

## 先に知っておくこと

| もの | `wrangler deploy` で | 対処 |
|---|---|---|
| Secret（パスワード・DeepSeek のキーなど） | **残る**（触らない） | 何もしない |
| 変数（Variables）：`wrangler.toml` に書いたもの | `wrangler.toml` の値で**上書き** | 下の手順1で、ダッシュボードの値と合わせる |
| 変数：ダッシュボードで直接入れた、`wrangler.toml` に無いもの | `keep_vars = true`（設定済み）で**残る** | — |
| KV などの接続（Bindings）をダッシュボードで作った場合 | `wrangler.toml` に無いと**消える** | 手順1で、`wrangler.toml` に書く |
| `TURNSTILE_SITEKEY`（`wrangler.toml` では空） | 空で**上書き**される | ダッシュボードに値が入っているなら、手順1で `wrangler.toml` に写す |
| コード・画面（`public/`） | 全部入れ替わる | このブランチは `design/live-ui` を含むので、以前の画面は引き継いでいる |

## 手順

1. **いまの設定を控える**（ダッシュボード：Workers & Pages → `soegi-demo` → Settings）
   - Variables and Secrets：変数の名前と値（Secret は名前だけ）
   - Bindings：KV（`DEMO_KV`）があれば、その namespace id
   - Domains & Routes：`demo.withsoegi.jp`
   - 控えた値のうち、`wrangler.toml` と違うもの（`TURNSTILE_SITEKEY`、KV の id など）を `wrangler.toml` に写す
2. **ログイン**：`npx wrangler login`
3. **ためしの版を作る**（本番はまだ変わらない）：`npx wrangler versions upload`
   - 出てきたプレビューURLで、確認リスト（`docs/verification-checklist.md`）の「共通」と、①レシートを試す
4. **本番に出す**：`npx wrangler versions deploy`（100%を選ぶ）。または、確認済みなら `npm run deploy`
5. **戻したいとき**：`npx wrangler rollback`（直前の版に戻る）

## 補足

- 設定ファイルの確認だけ（何も送らない）：`npx wrangler deploy --dry-run`
- Secret の追加・変更：`npx wrangler secret put 名前`（値はチャットに貼らない）
- 本番を Claude にするとき：`wrangler.toml` の `AI_PROVIDER = "claude"` と `wrangler secret put ANTHROPIC_API_KEY`（いまは DeepSeek のまま）

## 公開の記録
- 2026-10-24：デモ `soegi-demo` 版 `d6822d0d`（直前は `878ddd07`）、サイト `soegi` 版 `b0f80356`（直前は `0e99bd44`）を100%で公開。`npx wrangler rollback` で直前の版に戻せる
- `wrangler.toml` に、本番の KV（`DEMO_KV`）を書いてある。**消さないこと**（消すと、公開したときに KV の接続が外れ、LINE と回数の数え方が止まる）
- サイト（withsoegi.jp）のソースは `LipeRq/SOEGI_Website` の `main`。公開のしかたは、そちらの README

## 公開の前に必ず確認すること（2026-10-24 の失敗から）
- **公開中の版のコードが、リポジトリと同じか。** 別の場所（別のセッションなど）で直して公開した修正が、リポジトリにないと、こちらの公開で上書きされる。2026-10-24 に、DeepSeek の思考モードを切る修正（`claude/wonderful-tesla-jm0npj`）を取り込まずに公開し、チャットボットなどが約2時間 400 エラーになった（取り込んだ版 `8e9e9186` で復旧）
- 確認の仕方：`git branch -a` で、他のブランチに未取り込みの修正がないか見る。公開中の版の説明（`wrangler versions list` の message）と、リポジトリのコミットを突き合わせる
- 公開したら、**AIを使う機能を1つ実際に動かして**確かめる（チャットボットに1問、など）
