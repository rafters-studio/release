import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Project,
  type Target,
  skillPattern,
  sourcePattern,
  versionFieldPattern,
} from "./discover.ts";

function rewrite(
  text: string,
  target: Target,
  from: string,
  to: string,
): { text: string; replaced: number } {
  let replaced = 0;
  const swap = (_match: string, open: string, close: string) => {
    replaced++;
    return `${open}${to}${close}`;
  };
  if (target.kind === "package") {
    // Only the package's own version field, which is the first one in the file.
    const first = new RegExp(versionFieldPattern(from).source);
    return { text: text.replace(first, swap), replaced };
  }
  if (target.kind === "plugin" || target.kind === "marketplace") {
    return { text: text.replace(versionFieldPattern(from), swap), replaced };
  }
  if (target.kind === "skill") {
    const match = /^---\n[\s\S]*?\n---/.exec(text);
    if (!match) return { text, replaced };
    const head = match[0].replace(skillPattern(from), swap);
    return { text: head + text.slice(match[0].length), replaced };
  }
  const lines = text
    .split("\n")
    .map((line) =>
      line.includes("release-version") ? line.replace(sourcePattern(from), swap) : line,
    );
  return { text: lines.join("\n"), replaced };
}

// Sets `to` in every target, refusing (before writing anything) if any file
// no longer holds the version the expected number of times.
export function applyVersion(project: Project, to: string): string[] {
  const writes: { path: string; text: string }[] = [];
  for (const target of project.targets) {
    const path = join(project.root, target.file);
    const { text, replaced } = rewrite(readFileSync(path, "utf8"), target, project.version, to);
    if (replaced !== target.occurrences) {
      throw new Error(
        `${target.file}: expected ${target.occurrences} occurrence(s) of ${project.version}, found ${replaced}`,
      );
    }
    writes.push({ path, text });
  }
  for (const w of writes) writeFileSync(w.path, w.text);
  return project.targets.map((t) => t.file);
}

const HEADING = /^##\s+\[?v?(\d+\.\d+\.\d+[0-9A-Za-z.-]*)\]?/m;

// The changelog at the root, else the single publishable package's own.
export function findChangelog(project: Project): string | null {
  if (existsSync(join(project.root, "CHANGELOG.md"))) return "CHANGELOG.md";
  const packages = project.targets.filter((t) => t.kind === "package");
  if (packages.length === 1) {
    const dir = packages[0]!.file.replace(/package\.json$/, "");
    if (existsSync(join(project.root, dir, "CHANGELOG.md"))) return `${dir}CHANGELOG.md`;
  }
  return null;
}

export function newestChangelogVersion(text: string): string | null {
  return HEADING.exec(text)?.[1] ?? null;
}

export function checkChangelog(project: Project, version: string): string {
  const file = findChangelog(project);
  if (file === null)
    throw new Error("no CHANGELOG.md found at the root or in the publishable package");
  const newest = newestChangelogVersion(readFileSync(join(project.root, file), "utf8"));
  if (newest !== version) {
    throw new Error(
      `${file}: the newest section is ${newest === null ? "missing" : `"## ${newest}"`}; write "## ${version}" first`,
    );
  }
  return file;
}
