#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { researchGenre, listCachedGenres } from "../lib/hashtagResearch.js";
import { getGeminiModel, describeGeminiError } from "../lib/geminiClient.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const dataDir = path.join(projectRoot, "data");

function parseArgs(argv) {
  const args = { genre: null, refresh: false, list: false, extra: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--genre") args.genre = argv[++i];
    else if (argv[i] === "--refresh") args.refresh = true;
    else if (argv[i] === "--list") args.list = true;
    else if (argv[i] === "--extra") args.extra = argv[++i];
  }
  return args;
}

function printFindings(findings) {
  for (const tier of ["大規模", "中規模", "ニッチ・ローカル"]) {
    const inTier = findings.filter((f) => f.scaleImpression === tier);
    if (inTier.length === 0) continue;
    console.log(`\n[${tier}]`);
    for (const f of inTier) console.log(`  ${f.tag} — ${f.note ?? ""}`);
  }
}

function printDiff(diff) {
  if (!diff) {
    console.log("\n(初回調査のため差分はありません)");
    return;
  }
  console.log("\n--- 前回からの変化(規模感ベース、件数の順位ではありません) ---");
  if (diff.added.length) console.log(`新規: ${diff.added.join(", ")}`);
  if (diff.removed.length) console.log(`消失: ${diff.removed.join(", ")}`);
  if (diff.scaleChanged.length) {
    console.log("規模感の変化:");
    for (const c of diff.scaleChanged) console.log(`  ${c.tag}: ${c.from} → ${c.to}`);
  }
  if (!diff.added.length && !diff.removed.length && !diff.scaleChanged.length) {
    console.log("(変化なし)");
  }
}

async function main() {
  const { genre, refresh, list, extra } = parseArgs(process.argv.slice(2));

  if (list) {
    const genres = listCachedGenres(dataDir);
    if (genres.length === 0) {
      console.log("キャッシュ済みのジャンルはまだありません。");
      return;
    }
    console.log("キャッシュ済みジャンル:");
    for (const g of genres) console.log(`  ${g.genre} (最終更新: ${g.lastUpdated})`);
    return;
  }

  if (!genre) {
    console.error('使い方: npm run research-hashtags -- --genre "和装前撮り" [--refresh] [--extra "冬メインで"]');
    console.error("        npm run research-hashtags -- --list");
    process.exit(1);
  }

  console.log(
    refresh
      ? `Gemini (${getGeminiModel()}) で「${genre}」を再調査中...`
      : `「${genre}」のキャッシュを確認中...`
  );

  const { cache, usedApi } = await researchGenre(dataDir, genre, { extra, force: refresh });

  console.log(
    usedApi
      ? `  → Gemini に調査を依頼しました(最終更新: ${cache.lastUpdated})`
      : `  → キャッシュを使用しました(API呼び出しなし、最終更新: ${cache.lastUpdated})`
  );

  printFindings(cache.findings);
  if (refresh) printDiff(cache.lastDiff);
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(describeGeminiError(err).guidance);
  process.exit(1);
});
