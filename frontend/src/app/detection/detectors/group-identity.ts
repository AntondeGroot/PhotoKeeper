/**
 * Whether a correction recorded against `recorded` still applies to a re-detected group.
 *
 * <p>Matching on the exact member set was too brittle to keep a promise the store makes: re-detection
 * at a different threshold routinely shifts a group by a frame, and the correction then stopped
 * applying with no trace — the burst you already said was not a burst simply came back. Since the
 * burst-window setting re-detects the whole library, that was reachable by moving one slider.
 *
 * <p>So a correction follows the group it was made about rather than an exact set: it applies while
 * the two sets share more than half of everything they cover between them. Identical sets always
 * match (the previous behaviour), a group that gained or lost a frame still matches, and a genuinely
 * different group — sharing only a frame or two — does not, so a correction cannot spread.
 */
export function coversSameGroup(recorded: readonly string[], detected: readonly string[]): boolean {
  const inRecorded = new Set(recorded);
  const shared = new Set(detected.filter((id) => inRecorded.has(id))).size;
  const union = inRecorded.size + new Set(detected).size - shared;
  return union > 0 && shared * 2 > union;
}
