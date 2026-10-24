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
