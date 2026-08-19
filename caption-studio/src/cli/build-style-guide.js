#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { loadAllPosts } from "../lib/metaExport.js";
import { buildHashtagStats } from "../lib/hashtagStats.js";
import { askClaude, getModel } from "../lib/claudeClient.js";
import { buildStyleGuideUserPrompt, STYLE_GUIDE_SYSTEM_PROMPT } from "../lib/styleGuidePrompt.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");

function parseArgs(argv) {
  const args = { input: path.join(projectRoot, "data", "input"), out: path.join(projectRoot, "data") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = path.resolve(argv[++i]);
    else if (argv[i] === "--out") args.out = path.resolve(argv[++i]);
  }
  return args;
}

async function main() {
  const { input, out } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(input)) {
    console.error(`入力ディレクトリが見つかりません: ${input}`);
    console.error("Meta の「情報をダウンロード」で取得した ZIP を展開し、中身をこのディレクトリに置いてください。");
    process.exit(1);
  }

  console.log(`[1/4] ${input} 以下から posts_*.json を検索中...`);
  const { files, posts } = loadAllPosts(input);

  if (files.length === 0) {
    console.error("posts_*.json が見つかりませんでした（例: your_instagram_activity/content/posts_1.json）。");
    process.exit(1);
  }
  if (posts.length === 0) {
    console.error(`${files.length} 個のファイルを見つけましたが、キャプション付きの投稿がありませんでした。`);
    process.exit(1);
  }
  console.log(`  → ${files.length} ファイル / キャプションあり投稿 ${posts.length} 件`);

  console.log("[2/4] ハッシュタグ使用実績を集計中...");
  const hashtagStats = buildHashtagStats(posts);
  fs.mkdirSync(out, { recursive: true });
  const statsPath = path.join(out, "hashtag-stats.json");
  fs.writeFileSync(statsPath, JSON.stringify(hashtagStats, null, 2), "utf8");
  console.log(`  → ${hashtagStats.tags.length} 種類のタグを検出、保存先: ${statsPath}`);

  console.log(`[3/4] Claude (${getModel()}) でスタイルガイドを生成中...（少し時間がかかります）`);
  const userPrompt = buildStyleGuideUserPrompt(posts);
  const styleGuideMarkdown = await askClaude({
    system: STYLE_GUIDE_SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 4000,
  });

  console.log("[4/4] 保存中...");
  const guidePath = path.join(out, "style-guide.md");
  fs.writeFileSync(guidePath, styleGuideMarkdown, "utf8");
  console.log(`  → ${guidePath}`);
  console.log("\n完了しました。style-guide.md は自由に手で編集して構いません（AIの判断が外れていた場合の修正用）。");
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
