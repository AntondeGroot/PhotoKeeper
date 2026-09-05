// What the app is keeping on the device, and how much of it is worth keeping.
//
// The stores divide on one question, which is the same one the schema's own upgrade rules turn on
// (see STALE_AT in photokeeper-db): could this be rebuilt if it were lost? Everything derived from
// the catalogue can be — at the cost of a re-scan and some downloading — while the verdicts, tags
// and print state are the record of somebody's work and exist nowhere else. Shown that way round so
// the number that looks alarming is also the number that is safe to lose.

/** The groups shown in the UI, largest concern first. */
export type UsageGroup = 'work' | 'previews' | 'detection' | 'queue';

export interface GroupUsage {
  group: UsageGroup;
  title: string;
  detail: string;
  bytes: number;
  /** Records counted, for the "12,043 photos" line under a group that is mostly one thing. */
  records: number;
  /** Whether losing it would cost only time. Drives how the group is described, not what it does. */
  rebuildable: boolean;
}

export interface StorageUsage {
  groups: GroupUsage[];
  total: number;
  /** What the browser says the whole origin uses, when it will say — see StorageUsageService. */
  reported: number | null;
  /** The browser's quota for this origin, when known. */
  quota: number | null;
}

/**
 * One group of stores, as the settings screen shows it.
 *
 * The store names are plain strings here on purpose: this module is pure, and typing them against
 * the database schema would drag the schema — and the database — into it. The service that owns the
 * groups names them with the schema's own types, and a test pins that every store is accounted for.
 */
export interface UsageGroupSpec {
  group: UsageGroup;
  title: string;
  detail: string;
  rebuildable: boolean;
  stores: readonly string[];
}

/**
 * A stored value's size in bytes — exact where the value knows its own length, estimated otherwise.
 *
 * A blob and a typed array carry their byte count, which covers the two stores that hold nearly all
 * of the space. Everything else is structured-cloned objects whose real footprint only the engine
 * knows, so they are measured as the JSON they would serialise to: the right order of magnitude, and
 * honest about being an estimate rather than pretending to a precision nobody can offer.
 */
export function byteSize(value: unknown): number {
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === 'string') return value.length;
  if (typeof value === 'number') return 8;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0; // circular or unserialisable: not worth failing a size report over
  }
}

/** Bytes as a person reads them: "1.4 MB", "812 kB", "0 B". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Assembles the report from per-store totals, dropping groups that hold nothing. */
export function summarise(
  specs: readonly UsageGroupSpec[],
  perStore: ReadonlyMap<string, { bytes: number; records: number }>,
  reported: number | null,
  quota: number | null,
): StorageUsage {
  const groups = specs.map((spec) => {
    const measured = spec.stores.map((store) => perStore.get(store));
    return {
      group: spec.group,
      title: spec.title,
      detail: spec.detail,
      rebuildable: spec.rebuildable,
      bytes: measured.reduce((sum, s) => sum + (s?.bytes ?? 0), 0),
      records: measured.reduce((sum, s) => sum + (s?.records ?? 0), 0),
    };
  });
  return {
    groups: groups.filter((g) => g.records > 0),
    total: groups.reduce((sum, g) => sum + g.bytes, 0),
    reported,
    quota,
  };
}
