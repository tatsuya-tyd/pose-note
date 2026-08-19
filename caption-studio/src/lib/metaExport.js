import fs from "node:fs";
import path from "node:path";
import { fixMojibake } from "./textFix.js";

// Meta's Instagram "Download Your Information" (JSON format) export puts posts in
// files matching your_instagram_activity/content/posts_1.json, posts_2.json, ...
export function findPostsFiles(rootDir) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/^posts_\d+\.json$/i.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(rootDir);
  return found.sort();
}

// A single export entry can carry the caption at the post level (carousels)
// or on the first media item (single-photo posts) — never both reliably.
function pickCaption(entry) {
  const candidates = [entry.title];
  if (Array.isArray(entry.media)) {
    for (const media of entry.media) {
      candidates.push(media?.title);
    }
  }
  const raw = candidates.find((c) => typeof c === "string" && c.trim().length > 0);
  return raw ? fixMojibake(raw) : "";
}

function pickTimestamp(entry) {
  if (typeof entry.creation_timestamp === "number") return entry.creation_timestamp;
  if (Array.isArray(entry.media)) {
    const withTs = entry.media.find((m) => typeof m?.creation_timestamp === "number");
    if (withTs) return withTs.creation_timestamp;
  }
  return null;
}

export function parsePostsFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  const entries = Array.isArray(json) ? json : [json];

  return entries
    .map((entry) => ({
      caption: pickCaption(entry),
      timestamp: pickTimestamp(entry),
    }))
    .filter((post) => post.caption.length > 0);
}

export function loadAllPosts(rootDir) {
  const files = findPostsFiles(rootDir);
  const posts = files.flatMap(parsePostsFile);
  // Newest first, unknown timestamps last.
  posts.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return { files, posts };
}

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;

export function extractHashtags(caption) {
  const tags = new Set();
  for (const match of caption.matchAll(HASHTAG_RE)) {
    tags.add("#" + match[1]);
  }
  return [...tags];
}

export function captionWithoutHashtags(caption) {
  return caption.replace(HASHTAG_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}
