#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { loadFeedback, summarizeFeedback } from "../lib/feedbackStore.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const dataDir = path.join(projectRoot, "data");

async function main() {
  const entries = loadFeedback(dataDir, { limit: 1000 });
  const summary = summarizeFeedback(entries, dataDir);

  console.log(`蓄積件数: ${summary.totalEntries}`);

  console.log("\n--- 切り口の選択傾向 ---");
  if (summary.angleStats.length === 0) console.log("(データなし)");
  for (const a of summary.angleStats) {
    console.log(`  ${a.angle}: ${a.selected}/${a.shown} 回選択(選択率${Math.round(a.rate * 100)}%)`);
  }

  console.log("\n--- 毎回外されるタグ(除外候補) ---");
  if (summary.alwaysExcludedTags.length === 0) console.log("(該当なし)");
  for (const t of summary.alwaysExcludedTags) {
    console.log(`  ${t.tag}(${t.shown}回提案、一度も選ばれず)`);
  }

  console.log("\n--- 手動追加が多いタグ(必須タグ候補) ---");
  if (summary.manualAddFrequency.length === 0) console.log("(該当なし)");
  for (const t of summary.manualAddFrequency) {
    console.log(`  ${t.tag}(${t.count}回手動追加)`);
  }

  console.log(`\nスタイルガイド更新の提案: ${summary.styleGuideUpdateSuggested ? "あり" : "なし"}`);
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
