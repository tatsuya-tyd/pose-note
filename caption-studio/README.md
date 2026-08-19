# caption-studio

婚礼・前撮り・ポートレート専門カメラマン向け、Instagram のキャプション作成とハッシュタグ選定を
ほぼゼロの手間で終わらせるためのローカルツール。自動投稿はしない。生成した文言をコピーして
Instagram アプリで投稿する運用を想定している。

このドキュメントは実装前に提示する「技術選定・構成案」と、実装後の使い方をまとめたものです。

---

## 1. 技術選定案

| 項目 | 選定 | 理由 |
|---|---|---|
| 実行環境 | Node.js（v18+） | ローカル実行・セットアップの容易さを最優先。`npm install` 一発で動く。ビルド不要。 |
| 言語 | 素の JavaScript (ESM) | TypeScript のビルドステップを避け、セットアップコストを下げる。型はコメントで補う程度に留める。 |
| Claude 呼び出し | 公式 SDK `@anthropic-ai/sdk` | 生 HTTP より安全（エラー型・リトライが標準装備）で、依存は1つだけなので「依存最小限」の方針とも矛盾しない。 |
| Gemini 呼び出し（Phase 3/4 で追加予定） | `@google/genai`（無料枠） | 画像解析・Web検索ツールを持つ公式 SDK。無料枠の範囲で使う。 |
| データ保存 | ローカル JSON ファイル | SQLite すら不要な規模（投稿は多くて数百件、生成履歴も同程度）。外部DBは使わない。 |
| UI（Phase 5） | 単一 HTML + 軽量ローカルサーバー（Node 標準 `http` か Express を薄く使う） | SPA フレームワークのビルド環境を避ける。1画面完結・スマホ幅対応の要件と相性が良い。 |
| APIキー管理 | `.env`（gitignore 済み）を `src/lib/env.js` の自前ローダーで読む | `dotenv` パッケージすら足さず依存を1個減らす。フロントには絶対に渡さない。 |

**モデル選定について：** デフォルトは `claude-sonnet-5`（`.env` の `CLAUDE_MODEL` で変更可）。
書く分量・頻度を考えると、より高性能な `claude-opus-5` は約5倍のトークン単価になるため、
「ランニングコスト最小化」という制約を踏まえてコスト効率の良いモデルをデフォルトにした。
品質を優先したい場合は `.env` で `claude-opus-5` に切り替え可能。

---

## 2. ディレクトリ構成案（実装済み部分は太字）

```
caption-studio/
  **README.md**              このファイル
  **package.json**
  **.env.example**           コピーして .env を作る
  **.gitignore**              .env・個人データ（過去投稿・生成物）を除外
  **src/**
    **lib/**
      **env.js**              .env の自前ローダー
      **claudeClient.js**     Claude API 呼び出しの薄いラッパー
      **metaExport.js**       Meta エクスポート JSON のパース＋文字化け修復
      **textFix.js**          Instagram エクスポート特有の文字化けバグの修復
      **hashtagStats.js**     過去ハッシュタグの使用実績集計（毎回/よく使う/時々の3分類）
      **styleGuidePrompt.js** スタイルガイド生成用プロンプト
      **captionPrompt.js**    キャプション3案生成用プロンプト
      geminiClient.js       [Phase 3/4] Gemini 呼び出しラッパー（未実装）
      hashtagResearch.js    [Phase 3] Web検索によるタグ相場リサーチ＋キャッシュ（未実装）
      imageAnalysis.js      [Phase 4] 画像のビジョン解析（未実装）
      feedbackStore.js      [Phase 6] 選択結果の記録・集計（未実装）
    **cli/**
      **build-style-guide.js** Phase 1 CLI: エクスポート→スタイルガイド生成
      **generate-caption.js**  Phase 2 CLI: 撮影メモ→キャプション3案生成
    server.js              [Phase 5] ローカルUIサーバー（未実装）
    public/                [Phase 5] 1画面UI（未実装）
  **data/**
    **input/**              ← ここに Meta エクスポートを展開して置く（gitignore対象）
    **output/**              生成履歴の保存先（gitignore対象）
    style-guide.md         生成されるスタイルガイド（gitignore対象・手編集OK）
    hashtag-stats.json     生成されるタグ使用実績（gitignore対象）
    hashtag-cache/         [Phase 3] ジャンル別タグ相場キャッシュ（未実装）
    feedback.jsonl         [Phase 6] 選択・編集ログ（未実装）
  **samples/meta-export-sample/**  実データなしで動作確認するためのダミー投稿データ
```

`data/` 以下は個人の投稿内容を含むため丸ごと gitignore 対象（`.gitkeep` のみ追跡）。

---

## 3. Phase 1 を試す前の準備作業

1. **Meta の「情報をダウンロード」で過去投稿データを取得する**
   - Instagram アプリ／ブラウザ版 → 設定 →「アカウントセンター」→「あなたの情報とアクセス許可」→
     「情報をダウンロード」→ 対象アカウントを選択。
   - 形式は **JSON** を選択（HTML ではなく）。範囲は「すべての期間」推奨。
   - リクエスト後、メールで通知が来るまで数時間〜数日かかることがある（Meta 側の処理待ち）。
   - ダウンロードした ZIP を展開し、`your_instagram_activity/content/posts_1.json`
     （複数ファイルに分かれることもある）が含まれるフォルダごと
     `caption-studio/data/input/` 以下に置く。

2. **Anthropic API キーを取得する**
   - https://console.anthropic.com/settings/keys で発行。
   - `caption-studio/.env.example` を `caption-studio/.env` にコピーし、
     `ANTHROPIC_API_KEY=` に貼り付ける。

3. （Phase 3/4 で使用予定）**Gemini API キーの取得場所**
   - https://aistudio.google.com/apikey で無料枠のキーを発行できる。
   - 今はまだコードから使っていないので、今は取得だけしておけば十分。

4. **Node.js 18 以上をインストールしておく**

---

## 4. 無料枠・コスト面で懸念しているポイント

- **Gemini 無料枠のレート制限**：Web検索・画像解析ともに無料枠には1分あたり/1日あたりのリクエスト数
  上限がある。撮影が集中する時期（繁忙期の週末）にまとめて使うと上限に当たる可能性がある。
  → Phase 3 のキャッシュ機構（再調査はボタンを押したときだけ）はこれを見越した設計にしている。
- **Meta エクスポートの反映ラグ**：情報ダウンロードのリクエストから実際にファイルが用意されるまで
  時間がかかるため、「今すぐ試したい」を満たせない。→ `samples/` にダミーデータを用意し、
  実データが届く前でも動作確認できるようにした。
- **ジャンル別のハッシュタグ分類ができない**：Meta エクスポートには「婚礼」「前撮り」等のジャンル
  ラベルが存在しないため、Phase 1 の集計は全投稿横断になる。ジャンル別に分けたい場合は、
  将来的に `data/genre-map.json` のような手動マッピングを追加する運用が必要（未実装、Phase 6 以降で検討）。
- **Gemini の検索結果の数値の扱い**：仕様書の通り「投稿数◯◯万件」等の数値は不正確な可能性が高いため、
  Phase 3 では数値を断定的に出さず「規模感の目安」として扱う設計にする（実装時に厳守する）。
- **Claude のトークンコスト**：スタイルガイド生成は過去投稿をまとめて読ませるため、投稿数が多いと
  入力トークンが増える。`buildStyleGuideUserPrompt` は既定で最大200件・4万文字までにサンプリングを
  制限し、青天井にならないようにしている（`--max-posts` 相当の値は `src/lib/styleGuidePrompt.js` 内の
  デフォルト引数で調整可能）。

---

## 5. 使い方（Phase 1 / Phase 2、実装済み）

```bash
cd caption-studio
npm install
cp .env.example .env   # ANTHROPIC_API_KEY を設定する
```

### Phase 1: スタイルガイド生成（初回のみ）

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

### Phase 2: キャプション3案生成

```bash
npm run generate-caption -- --note "神社前撮り 和装 春"
npm run generate-caption -- --note "神社前撮り 和装 春" --extra "季節感を強めに、短めで" --save
```

- `--note`：撮影メモ（必須）
- `--extra`：追加指定（省略可。他のどの条件よりも優先される）
- `--style`：スタイルガイドのパス（省略時は `data/style-guide.md`）
- `--save`：生成結果を `data/output/` に保存する

`data/style-guide.md` がまだ無い状態でも、仮のスタイルガイドで動作する（警告が出る）。
まずはこの状態で品質を確認し、必要ならプロンプト（`src/lib/captionPrompt.js`）を調整してから
次のフェーズ（UI化）に進む。

---

## 6. 未実装（ロードマップ）

- **Phase 3**：Gemini Web検索によるハッシュタグ相場リサーチ＋ジャンル別キャッシュ＋差分表示
- **Phase 4**：Gemini ビジョンAPIによる画像解析＋手入力フォールバック
- **Phase 5**：1画面UI（画像アップロード・候補選択・チェックボックス選択・一括コピー）
- **Phase 6**：選択・編集結果の蓄積とその可視化、スタイルガイド更新提案

Phase 2 の時点でキャプションの品質確認ができる状態になっているので、実際に生成してみて
精度に問題があれば、UI実装より先にプロンプト（`src/lib/captionPrompt.js` / `styleGuidePrompt.js`）
の調整サイクルを回すこと。
