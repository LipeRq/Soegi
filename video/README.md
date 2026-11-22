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
| `check/<版>-cues.json` | 確認用：効果音を鳴らした時刻の一覧 |

投稿文の案は `posts.md`。

- 映像：60fps・H.264（High、level 4.2）・yuv420p・CRF 14（見た目で劣化が分からない画質）。
- 音声：BGMと効果音入り。AAC 256kbps・48kHz・ステレオ。音量は -14 LUFS、最大 -2 dBFS 前後（投稿先で再変換されても割れにくい値）。

## BGM・効果音の出典

**すべて自作です。** `src/make-audio.py` が、外部の音源を使わずに一から合成しています（乱数の種を固定しているので、毎回同じ音になります）。著作権・利用条件の心配はありません。

- BGM：120BPM・ハ長調（Fmaj7 → G6 → Em7 → Am7）。場面に合わせて、静か（冒頭）→ リズム → 全体 → 落ち着く（山形の場面）→ 最後の一打、と変わる。流れは `src/render.mjs` の `music`。
- 効果音：場面の切り替え（風切り音）、カード・吹き出し（ポン）、タップ、拡大、スタンプ、チェック、ピン、URLの入力、ボタンの押下（クリックと鐘）。鳴らす時刻は `src/stage.html` の `data-sfx`。
- 音を作り直すときは、Python 3 と numpy・scipy が要る（`pip install numpy scipy`）。

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
   cd video && npm install && pip install numpy scipy && npm run render
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

- 使っている録画（`assets/rec/knowledge`・`assets/rec/inn`）はリポジトリに入っている。名前・URLを変えるだけなら、撮り直さなくてよい。
- 録画を撮り直したら、`assets/rec/<名前>/log.json` の `marks`（操作の時刻）を見て、`src/edl.json` の使う区間を直す。
- 合言葉はファイルに書かず、環境変数で渡す。
- Playwright は、この環境に入っているものを使う（`src/pw.mjs`）。

## 部品

| ファイル | 役割 |
|---|---|
| `src/stage.html` | 場面の部品・動き・配置（縦と正方形）と、効果音の時刻。色は withsoegi.jp に合わせてある。光る演出は使っていない |
| `src/render.mjs` | 版ごとの場面と秒数・BGMの流れ、書き出し（4並列で1コマずつ撮る。縦30秒で約2分） |
| `src/make-audio.py` | BGMと効果音の合成 |
| `src/edl.json` | 録画のどこを何秒使うか |
| `src/record-demo.mjs` | デモの録画（拡大してもぼやけないよう、画面の3倍の細かさで撮る） |
| `src/make-receipts.mjs` | 架空のレシート画像（店・番号は架空。登録番号は実在しない `T0000000000001` の形） |
| `assets/yamagata.svg` | 山形県の輪郭（Natural Earth の行政区画データから作成。パブリックドメイン） |

## レシートの場面について

当初はレシート → Excel の場面にする予定でした。2026-11-22 に本番（demo.withsoegi.jp）の読み取りが、外部サービスの 400 エラーで動かなかったため、社内ナレッジ検索（見積書の単価）の場面に替えています。

本番が直ったら、次の手順でレシートの場面に戻せます。

1. `DEMO_PASS=<合言葉> node src/record-demo.mjs receipt` で録る。
2. `src/edl.json` の `receipt` に、使う区間を書く（`"5"` と `"4"` の2つ）。
3. `src/render.mjs` の場面の `knowledge` を `receipt` に戻す。`src/stage.html` の困りごとのカード（「見積書の単価さがし」）も「レシートの入力」に戻す。
4. `npm run render`。投稿文（`posts.md`）も直す。

## 縦動画の決まり

上の250px、下の400px、右下のボタン列（x 930〜、y 880〜1520）には文字を置いていません。`out/check/` の画像で確かめられます。
