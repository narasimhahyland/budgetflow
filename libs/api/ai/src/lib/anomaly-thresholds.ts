/**
 * Deterministic thresholds behind the flags. They are features of the records, not model opinion:
 * the model only turns them into a sentence, and the flag is advisory either way.
 */
export const ANOMALY_THRESHOLDS = {
  /** Two requests by the same person on the same budget within this many days look related. */
  splitWindowDays: 7,
  /** Their combined amount is worth a look above this, in minor units of the budget currency. */
  splitCombinedMinor: 250_000,
  /** Cost per head this many times the peer median is unusual. */
  costPerHeadFactor: 2,
  /** A peer group smaller than this is not a basis for comparison. */
  minimumPeerGroup: 5,
} as const;
