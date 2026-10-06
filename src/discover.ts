import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

export type TargetKind = "package" | "plugin" | "marketplace" | "skill" | "source";

// One file that carries the project's version, and how many times.
export interface Target {
  file: string; // relative to the project root
  kind: TargetKind;
  occurrences: number;
}

export interface Untracked {
  file: string;
  version: string;
}

export interface Project {
  root: string;
  version: string;
  targets: Target[];
  // Manifests found at a different version: they release on their own, so they are left alone.
  untracked: Untracked[];
}

const MARKER = "release-version";
// A marked line ends with the marker as a comment: `// release-version`, `# release-version`, or `/* release-version */`.
const MARKED_LINE = /(?:\/\/|#)\s*release-version\s*$|\/\*\s*release-version\s*\*\/\s*$/;
export const isMarkedLine = (line: string): boolean => MARKED_LINE.test(line);
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

const unquote = (item: string): string => item.trim().replace(/^["']|["']$/g, "");

// Workspace package globs from pnpm-workspace.yaml (block or flow list) or package.json "workspaces".
function workspaceGlobs(root: string, rootPkg: Record<string, unknown>): string[] {
  const pnpm = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpm)) {
    const globs: string[] = [];
    let inPackages = false;
    for (const raw of readFileSync(pnpm, "utf8").split("\n")) {
      const line = raw.replace(/\s+#.*$/, "");
      const flow = /^packages\s*:\s*\[(.*)\]\s*$/.exec(line);
      if (flow) {
        globs.push(...(flow[1] ?? "").split(",").map(unquote).filter(Boolean));
        continue;
      }
      if (/^packages\s*:\s*$/.test(line)) {
        inPackages = true;
        continue;
      }
      if (!inPackages || /^\s*(#.*)?$/.test(line)) continue;
      const item = /^\s*-\s+(.+)$/.exec(line);
      if (item?.[1]) globs.push(unquote(item[1]));
      else if (/^\S/.test(line)) inPackages = false;
    }
    if (globs.length > 0) return globs;
  }
  const ws = rootPkg.workspaces;
  if (Array.isArray(ws)) return ws.filter((g): g is string => typeof g === "string");
  if (
    typeof ws === "object" &&
    ws !== null &&
    Array.isArray((ws as { packages?: unknown }).packages)
  ) {
    return (ws as { packages: unknown[] }).packages.filter(
      (g): g is string => typeof g === "string",
    );
  }
  return [];
}

// Supports exact paths, "dir/*", and "dir/**" (any depth); negated globs exclude.
function expandGlobs(root: string, globs: string[]): string[] {
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const raw of globs) {
    const negate = raw.startsWith("!");
    const glob = (negate ? raw.slice(1) : raw).replace(/\/$/, "");
    if (glob.replace(/\/\*\*?$/, "").includes("*")) {
      throw new Error(
        `workspace glob "${raw}" is not supported (use an exact path, dir/*, or dir/**)`,
      );
    }
    const into = negate ? excluded : included;
    if (glob.endsWith("/**")) {
      walkDirs(join(root, glob.slice(0, -3)), (dir) => into.add(relative(root, dir)));
    } else if (glob.endsWith("/*")) {
      const base = join(root, glob.slice(0, -2));
      if (existsSync(base)) {
        for (const entry of readdirSync(base)) {
          if (statSync(join(base, entry)).isDirectory())
            into.add(relative(root, join(base, entry)));
        }
      }
    } else {
      into.add(glob);
    }
  }
  return [...included]
    .filter((dir) => !excluded.has(dir) && existsSync(join(root, dir, "package.json")))
    .sort();
}

function walkDirs(dir: string, visit: (dir: string) => void): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      visit(path);
      walkDirs(path, visit);
    }
  }
}

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function versionFieldPattern(version: string): RegExp {
  return new RegExp(`("version"\\s*:\\s*")${escape(version)}(")`, "g");
}

export function skillPattern(version: string): RegExp {
  return new RegExp(`^(version:\\s*["']?)${escape(version)}(["']?\\s*)$`, "m");
}

export function sourcePattern(version: string): RegExp {
  return new RegExp(`(["'\`])${escape(version)}(\\1)`, "g");
}

function frontmatter(text: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  return match?.[1] ?? null;
}

function trackedFiles(root: string): string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function discover(root: string): Project {
  const rootPkgPath = join(root, "package.json");
  if (!existsSync(rootPkgPath)) throw new Error(`no package.json at ${root}`);
  const rootPkg = readJson(rootPkgPath);

  const pkgDirs = ["", ...expandGlobs(root, workspaceGlobs(root, rootPkg))];
  const published: { file: string; version: string }[] = [];
  for (const dir of pkgDirs) {
    const file = dir ? join(dir, "package.json") : "package.json";
    const pkg = readJson(join(root, file));
    const version = stringField(pkg, "version");
    if (pkg.private === true || version === undefined) continue;
    published.push({ file, version });
  }
  if (published.length === 0)
    throw new Error("no publishable package found (every package is private or has no version)");

  const versions = new Set(published.map((p) => p.version));
  if (versions.size > 1) {
    const list = published.map((p) => `  ${p.file}: ${p.version}`).join("\n");
    throw new Error(`the publishable packages do not share one version:\n${list}`);
  }
  const version = published[0]!.version;
  const targets: Target[] = published.map((p) => ({
    file: p.file,
    kind: "package",
    occurrences: 1,
  }));
  const untracked: Untracked[] = [];

  // Tracked files still present on disk (git ls-files also lists deleted ones).
  const files = trackedFiles(root).filter((file) => existsSync(join(root, file)));
  const counted = new Set(targets.map((t) => t.file));
  for (const file of files) {
    const name = file.split("/").pop();
    // A private or out-of-workspace package that carries the project's version moves with it.
    if (name === "package.json" && !counted.has(file) && !file.includes("node_modules/")) {
      const other = stringField(readJson(join(root, file)), "version");
      if (other === version) targets.push({ file, kind: "package", occurrences: 1 });
      else if (other !== undefined) untracked.push({ file, version: other });
      continue;
    }
    const inClaudePlugin = file.includes(".claude-plugin/");
    if (inClaudePlugin && (name === "plugin.json" || name === "marketplace.json")) {
      const text = readFileSync(join(root, file), "utf8");
      const kind: TargetKind = name === "plugin.json" ? "plugin" : "marketplace";
      const occurrences = count(text, versionFieldPattern(version));
      if (occurrences > 0) targets.push({ file, kind, occurrences });
      else {
        const other = /"version"\s*:\s*"([^"]+)"/.exec(text)?.[1];
        if (other) untracked.push({ file, version: other });
      }
    } else if (name === "SKILL.md") {
      const fm = frontmatter(readFileSync(join(root, file), "utf8"));
      if (fm === null) continue;
      if (skillPattern(version).test(fm)) targets.push({ file, kind: "skill", occurrences: 1 });
      else {
        const other = /^version:\s*["']?([^"'\s]+)/m.exec(fm)?.[1];
        if (other) untracked.push({ file, version: other });
      }
    } else if (SOURCE_EXTENSIONS.test(file)) {
      const text = readFileSync(join(root, file), "utf8");
      if (!text.includes(MARKER)) continue;
      const lines = text.split("\n").filter(isMarkedLine);
      if (lines.length === 0) continue;
      const occurrences = lines.reduce((n, line) => n + count(line, sourcePattern(version)), 0);
      if (occurrences === 0) {
        throw new Error(`${file} marks a line ${MARKER} but no quoted ${version} is on it`);
      }
      targets.push({ file, kind: "source", occurrences });
    }
  }

  return { root, version, targets, untracked };
}
