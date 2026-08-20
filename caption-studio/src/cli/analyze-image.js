#!/usr/bin/env node
import path from "node:path";
import { loadEnv } from "../lib/env.js";
import { loadImageFile, analyzeImages, summaryToText } from "../lib/imageAnalysis.js";
import { getGeminiModel, describeGeminiError } from "../lib/geminiClient.js";

loadEnv();

function parseArgs(argv) {
  const args = { file: null, genre: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") args.file = path.resolve(argv[++i]);
    else if (argv[i] === "--genre") args.genre = argv[++i];
  }
  return args;
}

async function main() {
  const { file, genre } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('使い方: npm run analyze-image -- --file ./samples/xxx.jpg [--genre "和装前撮り"]');
    process.exit(1);
  }

  console.log(`Gemini (${getGeminiModel()}) で画像を解析中...`);
  const image = loadImageFile(file);
  const { summary } = await analyzeImages([image], { genre });

  console.log("\n抽出結果:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nテキスト概要:");
  console.log(summaryToText(summary));
}

main().catch((err) => {
  console.error("エラー:", err.message);
  console.error(describeGeminiError(err).guidance);
  process.exit(1);
});
