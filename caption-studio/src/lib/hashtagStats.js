import { extractHashtags } from "./metaExport.js";

// Classifies each tag the user has actually used in the past by how
// consistently they use it, per the spec: 80%+ / 40-80% / <40%.
export function buildHashtagStats(posts) {
  const totalPosts = posts.length;
  const counts = new Map();

  for (const post of posts) {
    for (const tag of extractHashtags(post.caption)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const tags = [...counts.entries()]
    .map(([tag, count]) => {
      const rate = totalPosts === 0 ? 0 : count / totalPosts;
      const tier = rate >= 0.8 ? "毎回" : rate >= 0.4 ? "よく使う" : "時々";
      return { tag, count, rate: Number(rate.toFixed(3)), tier };
    })
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    totalPosts,
    note:
      "ジャンル別（婚礼／前撮り／ポートレート等）の自動分類は未対応です。過去投稿にジャンルのラベルが" +
      "ないため、現状は全投稿を横断した集計になっています。ジャンル別に分けたい場合は data/genre-map.json" +
      "などで手動マッピングを追加する運用を検討してください（README参照）。",
    tags,
  };
}
