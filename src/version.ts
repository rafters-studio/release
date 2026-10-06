export type Bump = "patch" | "minor" | "major";

interface Parsed {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(version: string): Parsed {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`"${version}" is not a version (expected x.y.z or x.y.z-pre)`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

export function isVersion(version: string): boolean {
  return SEMVER.test(version);
}

function comparePre(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Negative when a < b, zero when equal, positive when a > b (semver precedence).
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch || comparePre(x.pre, y.pre);
}

export function nextVersion(current: string, target: string): string {
  const v = parseVersion(current);
  if (target === "major") return `${v.major + 1}.0.0`;
  if (target === "minor") return `${v.major}.${v.minor + 1}.0`;
  if (target === "patch")
    return v.pre ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}.${v.patch + 1}`;
  parseVersion(target);
  return target;
}
