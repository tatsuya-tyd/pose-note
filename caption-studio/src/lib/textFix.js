// Meta's "Download Your Information" JSON export mis-encodes non-ASCII text:
// UTF-8 bytes get written out as if each byte were a Latin-1 code point.
// Round-tripping through Latin-1 -> UTF-8 recovers the original text.
// See: https://stackoverflow.com/questions/60193664 (well-known Instagram export bug).
export function fixMojibake(str) {
  if (!str) return str;
  try {
    const fixed = Buffer.from(str, "latin1").toString("utf8");
    // If the fix produced replacement characters, the input likely wasn't
    // mis-encoded in the first place — keep the original.
    return fixed.includes("�") ? str : fixed;
  } catch {
    return str;
  }
}
