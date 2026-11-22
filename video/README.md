# SNS告知動画（Nodus Consulting）

山形の中小企業の社長向けの、SNS告知動画とサムネイル・投稿文です。HTML で場面を組み、Playwright で1コマずつ画像にし、ffmpeg で mp4 にします。

## できるもの（`out/`）

| ファイル | 中身 |
|---|---|
| `nodus-v30.mp4` | 縦 1080×1920・30秒（リール・TikTok・ショート） |
| `nodus-v15.mp4` | 縦 1080×1920・15秒 |
| `nodus-sq30.mp4` | 正方形 1080×1080・30秒（Facebook・X） |
| `thumb-v30.png`／`thumb-v15.png`／`thumb-sq30.png` | サムネイル |
| `check/<版>-<場面>.png` | 確認用：各場面の、文字が出そろった所の1枚 |

投稿文の案は `posts.md`。

すべて 30fps・H.264（High）・yuv420p。BGMは入れていません（音声は無音のトラックだけ。音声トラックの無い動画を受け付けない投稿先があるため）。

## 名前・URLを差し替える

1. `brand.json` を書き換える。

   | 項目 | 使う所 |
   |---|---|
   | `name` | ロゴ画像が無いときに、文字で出す名前 |
   | `wordmark` | 締めの画面とサムネイルのロゴ画像（このフォルダからの相対パス）。**名前を変えたら、ロゴ画像も差し替えるか `null` にする**（`null` なら `name` を文字で出す） |
   | `url` | 締めの画面のURL |
   | `tagline` | 締めの画面の添え書き |
   | `rep` | 山形の場面の代表名 |

2. 書き出し直す。

   ```bash
   cd video && npm install && npm run render
   ```

3. `posts.md` の名前・URLは、手で書き換える。

## 作り直す手順（はじめから）

```bash
cd video
npm install                                  # 書体（BIZ UDPGothic）
npm run receipts                             # 撮影用の架空のレシート画像 → assets/receipts/
DEMO_PASS=<合言葉> node src/record-demo.mjs   # demo.withsoegi.jp を操作して録る → assets/rec/
npm run render                               # 動画とサムネイル → out/
```

- 録画を撮り直したら、`assets/rec/<名前>/log.json` の `marks`（操作の時刻）を見て、`src/edl.json` の使う区間を直す。
- 合言葉はファイルに書かず、環境変数で渡す。
- Playwright は、この環境に入っているものを使う（`src/pw.mjs`）。

## 部品

| ファイル | 役割 |
|---|---|
| `src/stage.html` | 場面の部品と配置（縦と正方形）。色は withsoegi.jp に合わせてある |
| `src/render.mjs` | 版ごとの場面と秒数、書き出し |
| `src/edl.json` | 録画のどこを何秒使うか |
| `src/record-demo.mjs` | デモの録画 |
| `src/make-receipts.mjs` | 架空のレシート画像（店・番号は架空。登録番号は実在しない `T0000000000001` の形） |
| `assets/yamagata.svg` | 山形県の輪郭（Natural Earth の行政区画データから作成。パブリックドメイン） |

## 縦動画の決まり

上の250px、下の400px、右下のボタン列（x 930〜、y 880〜1520）には文字を置いていません。`out/check/` の画像で確かめられます。
