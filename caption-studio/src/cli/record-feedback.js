#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.js";
import { appendFeedback } from "../lib/feedbackStore.js";

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../..");
const dataDir = path.join(projectRoot, "data");

function parseArgs(argv) {
  const args = { file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") args.file = path.resolve(argv[++i]);
  }
  return args;
}

async function main() {
  const { file } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("使い方: node src/cli/record-feedback.js --file samples/feedback-sample.jsonl");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`ファイルが見つかりません: ${file}`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim());

  let count = 0;
  for (const line of lines) {
    appendFeedback(dataDir, JSON.parse(line));
    count += 1;
  }
  console.log(`${count} 件のフィードバックを data/feedback.jsonl に追記しました。`);
}

main().catch((err) => {
  console.error("エラー:", err.message);
  process.exit(1);
});
