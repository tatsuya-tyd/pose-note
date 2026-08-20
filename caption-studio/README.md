# caption-studio

婚礼・前撮り・ポートレート専門カメラマン向け、Instagram のキャプション作成とハッシュタグ選定を
ほぼゼロの手間で終わらせるためのローカルツール。自動投稿はしない。生成した文言をコピーして
Instagram アプリで投稿する運用を想定している。

Phase 1〜6 すべて実装済み。1画面のローカルUI（`npm start`）から使うのが基本の運用で、
各機能は個別の CLI としても動く（プロンプト調整時の smoke test 用）。

**すべての生成・調査・解析は Gemini の無料枠のみで完結する。** Anthropic API（Claude）は
従量課金必須で無料枠が存在しないため、このアプリからは呼び出さない方針にした（詳細は4節）。
Gemini の無料枠には「1日あたりのリクエスト数」の上限があり、それに達した場合だけ、
このプロジェクトを操作している Claude（Chat/Claude Code）に直接キャプション作成を頼む、
という**手動フォールバック**を運用ルールにしている（4節・5節参照）。

---

## 1. 技術選定案

| 項目 | 選定 | 理由 |
|---|---|---|
| 実行環境 | Node.js（v18+） | ローカル実行・セットアップの容易さを最優先。`npm install` 一発で動く。ビルド不要。 |
| 言語 | 素の JavaScript (ESM) | TypeScript のビルドステップを避け、セットアップコストを下げる。型はコメントで補う程度に留める。 |
| 生成AI呼び出し | 公式 SDK `@google/genai`（Gemini 無料枠のみ） | Web検索（Grounding）・ビジョン解析・通常のテキスト生成をすべて同じ SDK でまかなえる。Anthropic API は無料枠が無く従量課金必須のため不採用（4節）。無料枠のレート制限は変動しやすいため、特定の数値には依存せず HTTP ステータス／エラーコードで分類してガイダンスを出す設計にした。 |
| データ保存 | ローカル JSON / JSON Lines ファイル | SQLite すら不要な規模（投稿は多くて数百件、生成履歴も同程度）。外部DBは使わない。 |
| UI（Phase 5） | 単一 HTML + Node 標準 `http` によるローカルサーバー | 依存最小限の方針を優先し Express は採用しなかった。画像は `FileReader` で base64 化して JSON POST するため multipart 処理（`multer` 等）も不要で、Express を使わずに済む一番の理由になっている。 |
| APIキー管理 | `.env`（gitignore 済み）を `src/lib/env.js` の自前ローダーで読む | `dotenv` パッケージすら足さず依存を1個減らす。フロントには絶対に渡さない（サーバープロセス内でのみ参照）。 |

**モデル選定について：** デフォルトは `gemini-3.6-flash`（`.env` の `GEMINI_MODEL` で変更可）。
`gemini-2.5-flash` は新規ユーザー向けの提供が終了しているため使用しない。

---

## 2. ディレクトリ構成

```
caption-studio/
  README.md
  package.json
  .env.example              コピーして .env を作る
  .gitignore                 .env・個人データ（過去投稿・生成物）を除外
  src/
    lib/
      env.js                 .env の自前ローダー
      geminiClient.js        Gemini 呼び出しラッパー（テキスト生成 / Search grounding / Vision / エラー分類）
      metaExport.js          Meta エクスポート JSON のパース＋文字化け修復
      textFix.js             Instagram エクスポート特有の文字化けバグの修復
      hashtagStats.js        過去ハッシュタグの使用実績集計（毎回/よく使う/時々の3分類）
      hashtagResearch.js     Web検索によるタグ相場リサーチ＋ジャンル別キャッシュ＋差分計算
      hashtagPrompt.js       タグ提案（3層20個程度）用プロンプト
      imageAnalysis.js       画像のビジョン解析＋手入力フォールバック解決
      feedbackStore.js       選択・編集結果の記録・集計
      styleGuidePrompt.js    スタイルガイド生成用プロンプト
      captionPrompt.js       キャプション3案生成用プロンプト
    cli/
      build-style-guide.js   Phase 1: エクスポート→スタイルガイド生成
      generate-caption.js    Phase 2: 撮影メモ→キャプション3案生成
      research-hashtags.js   Phase 3: ジャンル別タグ相場の初回調査／再調査／一覧
      generate-hashtags.js   Phase 3: タグ提案（3層20個程度）生成
      analyze-image.js       Phase 4: 画像1枚の解析結果を確認する smoke test 用CLI
      record-feedback.js     Phase 6: フィードバックJSONLの一括投入
      feedback-report.js     Phase 6: フィードバック集計のテキスト表示
    server.js                Phase 5: ローカルUIサーバー（Node標準 http、唯一のAPIエントリーポイント）
    public/                  Phase 5: 1画面UI（index.html / app.js / style.css）
  data/
    input/                   ← ここに Meta エクスポートを展開して置く（gitignore対象）
    output/                   生成履歴の保存先（gitignore対象）
    style-guide.md            生成されるスタイルガイド（gitignore対象・手編集OK）
    hashtag-stats.json        生成されるタグ使用実績（gitignore対象）
    hashtag-cache/            ジャンル別タグ相場キャッシュ（gitignore対象）
    feedback.jsonl            選択・編集ログ（gitignore対象、追記のみ）
    feedback-meta.json        スタイルガイド更新提案の連続表示を防ぐマーカー（gitignore対象）
  samples/
    meta-export-sample/       実データなしで動作確認するためのダミー投稿データ
    feedback-sample.jsonl     フィードバック機能の動作確認用ダミーデータ
```

`data/` 以下は個人の投稿内容を含むため丸ごと gitignore 対象（`.gitkeep` のみ追跡）。

---

## 3. 準備作業

1. **Meta の「情報をダウンロード」で過去投稿データを取得する**
   - Instagram アプリ／ブラウザ版 → 設定 →「アカウントセンター」→「あなたの情報とアクセス許可」→
     「情報をダウンロード」→ 対象アカウントを選択。
   - 形式は **JSON** を選択（HTML ではなく）。範囲は「すべての期間」推奨。
   - リクエスト後、メールで通知が来るまで数時間〜数日かかることがある（Meta 側の処理待ち）。
   - ダウンロードした ZIP を展開し、`your_instagram_activity/content/posts_1.json`
     （複数ファイルに分かれることもある）が含まれるフォルダごと
     `caption-studio/data/input/` 以下に置く。

2. **Gemini API キーを取得する（必須・無料）**
   - https://aistudio.google.com/apikey で無料枠のキーを発行できる。
   - `caption-studio/.env.example` を `caption-studio/.env` にコピーし、
     `GEMINI_API_KEY=` に貼り付ける。**支払い情報をリンクしない限り、無料枠の上限を
     超えてもエラーになるだけで自動課金はされない。**

3. **Node.js 18 以上をインストールしておく**

4. **（任意）ローカルUIサーバーのポート変更**
   - 既定は `3000`。使用中の場合は `.env` の `PORT=` で変更できる。

---

## 4. なぜ Anthropic API（Claude）を使わないか／無料枠の制約

- **Anthropic API には無料枠が存在しない。** Claude Code（このチャット）のサブスクリプションとは
  別に、APIキー経由の呼び出しは常に従量課金（プリペイド式クレジット）が必要で、「追加の課金を
  一切発生させない」という要件と両立しない。そのため実装当初は Claude を「書く係」として
  組み込んでいたが、途中でこの制約が判明し、**全機能を Gemini 無料枠のみで完結する構成に
  作り直した**（`src/lib/claudeClient.js` は削除済み）。
- **Gemini 無料枠にも「1日あたりのリクエスト数」の上限がある（2025年12月の改定以降、
  目安として1日20回程度とかなり少ない）。** この上限は Web検索・画像解析・通常のテキスト
  生成すべてに共通してかかるため、投稿準備1回（画像解析＋キャプション生成＋タグ提案）で
  3〜4回消費する計算になり、1日に何件も投稿準備をすると枯渇しうる。
  - タグ相場リサーチは**キャッシュ機構**（再調査はUIのボタン／CLIの`--refresh`を押したときだけ）
    でそもそもの呼び出し回数を抑えている。
  - 上限に達した場合、`src/lib/geminiClient.js` の `describeGeminiError()` が
    `rate_limit` / `quota_exceeded` / `auth_error` / `transient` / `other` を判定し、
    CLI・UI双方に **「今回だけ Claude（このプロジェクトを操作している Chat）に直接
    撮影メモと `data/style-guide.md` を伝えて代筆を依頼してください」という案内**を表示する。
    これが正式な運用上のフォールバック。
  - Google Cloud の請求先アカウントをリンクして Tier 1 に上げれば上限は大幅に緩和されるが、
    無料枠を超えた分は従量課金になるため、「課金一切禁止」の方針とは別判断が必要（今は選択していない）。
- **Meta エクスポートの反映ラグ**：情報ダウンロードのリクエストから実際にファイルが用意されるまで
  時間がかかるため、「今すぐ試したい」を満たせない。→ `samples/` にダミーデータを用意し、
  実データが届く前でも動作確認できるようにした。
- **ジャンル別のハッシュタグ分類ができない（Phase 1 の集計）**：Meta エクスポートには
  「婚礼」「前撮り」等のジャンルラベルが存在しないため、`hashtag-stats.json` の集計は
  全投稿横断になる。ジャンル別に分けたい場合は `data/genre-map.json` 等の手動マッピングを
  追加する運用を検討する（未実装）。なお Phase 3 のタグ相場リサーチ・タグ提案はユーザーが
  都度入力する「ジャンル」単位で完結するため、この制約の影響を受けない。
- **Gemini の検索結果の数値の扱い**：「投稿数◯◯万件」等の数値は不正確な可能性が高いため、
  タグの相場感は「大規模／中規模／ニッチ・ローカル」の3段階の**規模感**でのみ扱い、
  数値そのものは出力・保存しない。タグ相場の「差分表示」も件数の順位ではなく、
  この規模感がどう変わったか（新規／消失／規模感の変化）を対象にしている。
- **スタイルガイド生成のトークン量**：過去投稿をまとめて読ませるため、投稿数が多いと入力量が
  増える。`buildStyleGuideUserPrompt` は既定で最大200件・4万文字までにサンプリングを制限し、
  青天井にならないようにしている（`src/lib/styleGuidePrompt.js` 内のデフォルト引数で調整可能）。

---

## 5. 使い方

```bash
cd caption-studio
npm install
cp .env.example .env   # GEMINI_API_KEY を設定する
```

### 基本の使い方（Phase 5 UI）

```bash
npm start
```

`http://localhost:3000` を開く。1画面で完結する：

1. ジャンル・撮影メモ・追加指定を入力
2. 画像をドラッグ&ドロップ（複数枚可）→ 自動で Gemini 画像解析が走り、結果がテキスト欄に入る
   （失敗時は「情報源: 手入力」に切り替わり、手で入力できる）
3. 「生成する」→ Gemini がキャプション3案とタグ提案（3層・約20個）を生成
4. キャプションを1つ選択・その場で編集、タグをチェックボックスで取捨選択、
   必要なら「追加のタグ」欄に屋号タグ等を手入力
5. 「タグ相場を再調査」でジャンル別キャッシュを更新（差分と最終更新日時が表示される。
   このボタンを押さない限り Gemini への再検索は走らない）
6. 完成形プレビューをコピー → Instagram アプリで投稿。コピー時に選択結果がローカルに記録される
   （フィードバック蓄積、6節参照）
7. ヘッダーの「フィードバック分析」タブで、選ばれる切り口の傾向・除外候補タグ・必須タグ候補を確認できる

**Gemini の無料枠上限に達したら：** 画面上部のステータス欄に案内が表示される
（例：「Geminiの無料枠の上限に達した可能性があります…今回だけ Claude に直接…依頼してください」）。
その場合は `data/style-guide.md` の内容と撮影メモを、このプロジェクトを操作している
Claude（Chat/Claude Code）にそのまま伝えてキャプションを書いてもらう、という運用でしのぐ。
日付が変わればまた自動生成が使えるようになる。

### Phase 1: スタイルガイド生成（初回のみ・CLI）

実データがまだない場合は、まず同梱のダミーデータで動作確認できる：

```bash
npm run build-style-guide -- --input ./samples/meta-export-sample
```

実データが揃ったら、`data/input/` にエクスポートを配置してから：

```bash
npm run build-style-guide
```

- `data/style-guide.md` … 生成されたスタイルガイド（Markdown、手編集可）
- `data/hashtag-stats.json` … 過去のハッシュタグ使用実績（毎回/よく使う/時々の3分類）

### Phase 2: キャプション3案生成（CLI）

```bash
npm run generate-caption -- --note "神社前撮り 和装 春"
npm run generate-caption -- --note "神社前撮り 和装 春" --extra "季節感を強めに、短めで" --save
npm run generate-caption -- --note "神社前撮り 和装 春" --image ./samples/xxx.jpg
```

- `--note`：撮影メモ（必須）
- `--extra`：追加指定（省略可。他のどの条件よりも優先される）
- `--style`：スタイルガイドのパス（省略時は `data/style-guide.md`）
- `--image`：画像を渡して Gemini に自動解析させる（省略可、失敗時は概要なしで続行）
- `--image-summary`：画像概要の手入力（指定時は `--image` の自動解析より優先）
- `--save`：生成結果を `data/output/` に保存する

`data/style-guide.md` がまだ無い状態でも、仮のスタイルガイドで動作する（警告が出る）。

### Phase 3: タグ相場リサーチ＆タグ提案（CLI）

```bash
npm run research-hashtags -- --genre "和装前撮り"          # 初回調査、以後はキャッシュのみ表示（API不使用）
npm run research-hashtags -- --genre "和装前撮り" --refresh # 強制再調査、前回との差分を表示
npm run research-hashtags -- --list                        # キャッシュ済みジャンル一覧

npm run generate-hashtags -- --genre "和装前撮り" --image-summary "神社境内、夕方、和装" --extra "屋号タグ必須" --save
```

`generate-hashtags` はキャッシュが無いジャンルに対しては「先に `research-hashtags` を実行してください」
と案内して終了する（UI経由の場合は `server.js` が自動で初回調査を行う）。

### Phase 4: 画像解析の単体確認（CLI）

```bash
npm run analyze-image -- --file ./samples/xxx.jpg --genre "和装前撮り"
```

### Phase 6: フィードバックの投入・集計（CLI）

```bash
npm run record-feedback -- --file samples/feedback-sample.jsonl   # サンプルデータで動作確認
npm run feedback-report                                            # 集計結果をテキストで表示
```

蓄積件数が一定数（既定30件）を超えると `feedback-report` / UI の両方で
スタイルガイド更新の提案が表示される。

---

## 6. 今後の検討事項

- ジャンル別のハッシュタグ自動分類（`data/genre-map.json` 等の手動マッピング運用）
- スタイルガイドの自動更新（現状は「更新を提案」するのみで、実際の再生成は `npm run build-style-guide` を手動実行する運用）
- Gemini 無料枠の実際の消費ペースを日をまたいで実地観察し、1日あたり何件の投稿準備までなら
  自動生成だけで足りるかを把握する（足りない場合は4節のフォールバック運用が主体になる）
