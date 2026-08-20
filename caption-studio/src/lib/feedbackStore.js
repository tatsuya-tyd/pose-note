import fs from "node:fs";
import path from "node:path";

const FEEDBACK_FILE = "feedback.jsonl";
const META_FILE = "feedback-meta.json";
const SUGGEST_EVERY = 30;
const EXCLUDE_MIN_SHOWN = 3;

function getFeedbackPath(dataDir) {
  return path.join(dataDir, FEEDBACK_FILE);
}

function getMetaPath(dataDir) {
  return path.join(dataDir, META_FILE);
}

// entry: {genre, shootingNote, candidates:[{angle,caption,selected,edited,finalCaption}],
//         proposedTags:[{tag,tier,selected}], manualAddedTags:[...]}
export function appendFeedback(dataDir, entry) {
  fs.mkdirSync(dataDir, { recursive: true });
  const record = { recordedAt: new Date().toISOString(), ...entry };
  fs.appendFileSync(getFeedbackPath(dataDir), JSON.stringify(record) + "\n", "utf8");
  return record;
}

export function loadFeedback(dataDir, { limit } = {}) {
  const file = getFeedbackPath(dataDir);
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const entries = lines.map((l) => JSON.parse(l));
  return limit ? entries.slice(-limit) : entries;
}

function loadMeta(dataDir) {
  const file = getMetaPath(dataDir);
  if (!fs.existsSync(file)) return { lastSuggestedAtCount: 0 };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function markStyleGuideSuggestionShown(dataDir, entryCount) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getMetaPath(dataDir), JSON.stringify({ lastSuggestedAtCount: entryCount }, null, 2), "utf8");
}

// dataDir is optional: pass it to also compute styleGuideUpdateSuggested (needs
// the "last suggested at" marker file); omit it when only angle/tag stats matter.
export function summarizeFeedback(entries, dataDir) {
  const angleCounts = new Map();
  const tagCounts = new Map();
  const manualAddCounts = new Map();

  for (const entry of entries) {
    for (const c of entry.candidates ?? []) {
      const stat = angleCounts.get(c.angle) ?? { shown: 0, selected: 0 };
      stat.shown += 1;
      if (c.selected) stat.selected += 1;
      angleCounts.set(c.angle, stat);
    }
    for (const t of entry.proposedTags ?? []) {
      const stat = tagCounts.get(t.tag) ?? { shown: 0, selected: 0 };
      stat.shown += 1;
      if (t.selected) stat.selected += 1;
      tagCounts.set(t.tag, stat);
    }
    for (const tag of entry.manualAddedTags ?? []) {
      manualAddCounts.set(tag, (manualAddCounts.get(tag) ?? 0) + 1);
    }
  }

  const angleStats = [...angleCounts.entries()]
    .map(([angle, s]) => ({ angle, shown: s.shown, selected: s.selected, rate: s.shown ? s.selected / s.shown : 0 }))
    .sort((a, b) => b.rate - a.rate);

  const alwaysExcludedTags = [...tagCounts.entries()]
    .filter(([, s]) => s.shown >= EXCLUDE_MIN_SHOWN && s.selected === 0)
    .map(([tag, s]) => ({ tag, shown: s.shown }));

  const manualAddFrequency = [...manualAddCounts.entries()]
    .filter(([, count]) => count >= EXCLUDE_MIN_SHOWN)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  const angleTrendText = angleStats.length
    ? `過去は${angleStats
        .slice(0, 2)
        .map((a) => `「${a.angle}」が選ばれる傾向(選択率${Math.round(a.rate * 100)}%)`)
        .join("、")}にあります。`
    : "";

  let styleGuideUpdateSuggested = false;
  if (dataDir) {
    const meta = loadMeta(dataDir);
    styleGuideUpdateSuggested = entries.length >= meta.lastSuggestedAtCount + SUGGEST_EVERY;
  }

  return {
    totalEntries: entries.length,
    angleStats,
    alwaysExcludedTags,
    manualAddFrequency,
    styleGuideUpdateSuggested,
    angleTrendText,
  };
}
