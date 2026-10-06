import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { applyVersion, checkChangelog } from "../src/apply.ts";
import { discover } from "../src/discover.ts";
import { pkg, project } from "./helpers.ts";

const workspace = () =>
  project({
    "package.json": pkg("root", "0.0.0", { private: true }),
    "pnpm-workspace.yaml": "packages:\n  - packages/*\n  - plugin\n\ncatalog:\n  vite: 1.0.0\n",
    "packages/cli/package.json": pkg("@x/cli", "0.4.2", {
      dependencies: { "@x/shared": "workspace:*" },
    }),
    "packages/shared/package.json": pkg("@x/shared", "0.4.2"),
    "packages/ui/package.json": pkg("@x/ui", "0.0.7", { private: true }),
    "tools/meta/package.json": pkg("x-meta", "0.4.2", { private: true }),
    "packages/shared/src/version.ts":
      'export const VERSION = "0.4.2"; // release-version\nexport const OTHER = "0.4.2";\n',
    "plugin/package.json": pkg("x-plugin", "0.4.2"),
    "plugin/.claude-plugin/plugin.json": '{\n  "name": "x",\n  "version": "0.4.2"\n}\n',
    ".claude-plugin/marketplace.json":
      '{\n  "metadata": { "version": "0.4.2" },\n  "plugins": [{ "name": "x", "version": "0.4.2" }]\n}\n',
    "plugin/skills/x/SKILL.md": "---\nname: x\nversion: 0.4.2\n---\n\nUses 0.4.2 in prose.\n",
    "other/.claude-plugin/plugin.json": '{ "name": "y", "version": "3.1.0" }\n',
    "CHANGELOG.md": "# Changelog\n\n## 0.4.3\n\n- Fixes.\n\n## 0.4.2\n",
  });

describe("discover", () => {
  it("finds the shared version and every place it appears, skipping private packages", () => {
    const p = discover(workspace());
    expect(p.version).toBe("0.4.2");
    expect(p.targets.map((t) => `${t.file}:${t.kind}:${t.occurrences}`).sort()).toEqual([
      ".claude-plugin/marketplace.json:marketplace:2",
      "packages/cli/package.json:package:1",
      "packages/shared/package.json:package:1",
      "packages/shared/src/version.ts:source:1",
      "plugin/.claude-plugin/plugin.json:plugin:1",
      "plugin/package.json:package:1",
      "plugin/skills/x/SKILL.md:skill:1",
      "tools/meta/package.json:package:1",
    ]);
    expect(p.untracked).toEqual(
      expect.arrayContaining([
        { file: "other/.claude-plugin/plugin.json", version: "3.1.0" },
        { file: "packages/ui/package.json", version: "0.0.7" },
        { file: "package.json", version: "0.0.0" },
      ]),
    );
  });

  it("works for a single package with no workspace", () => {
    const p = discover(project({ "package.json": pkg("@x/solo", "1.0.0") }));
    expect(p.targets).toEqual([{ file: "package.json", kind: "package", occurrences: 1 }]);
  });

  it("refuses when publishable packages disagree", () => {
    const root = project({
      "package.json": pkg("root", "0.0.0", { private: true, workspaces: ["packages/*"] }),
      "packages/a/package.json": pkg("a", "1.0.0"),
      "packages/b/package.json": pkg("b", "1.1.0"),
    });
    expect(() => discover(root)).toThrow(/do not share one version/);
  });

  it("ignores a file that only mentions the marker word", () => {
    const root = project({
      "package.json": pkg("a", "1.0.0"),
      "src/doc.ts": 'const MARKER = "release-version"; // the marker comment\n',
    });
    expect(discover(root).targets.map((t) => t.file)).toEqual(["package.json"]);
  });

  it("reads zero-indent and flow pnpm workspace lists", () => {
    const files = {
      "package.json": pkg("root", "0.0.0", { private: true }),
      "packages/a/package.json": pkg("a", "2.0.0"),
      "packages/b/package.json": pkg("b", "2.0.0"),
    };
    const zero = project({ ...files, "pnpm-workspace.yaml": 'packages:\n- "packages/*"\n' });
    const flow = project({
      ...files,
      "pnpm-workspace.yaml": "packages: [packages/a, 'packages/b']\n",
    });
    for (const root of [zero, flow]) {
      expect(
        discover(root)
          .targets.map((t) => t.file)
          .sort(),
      ).toEqual(["packages/a/package.json", "packages/b/package.json"]);
    }
  });

  it("refuses a workspace glob form it does not support", () => {
    const root = project({
      "package.json": pkg("root", "0.0.0", { private: true, workspaces: ["packages/**/lib"] }),
    });
    expect(() => discover(root)).toThrow(/not supported/);
  });

  it("refuses a release-version marker with no version on the line", () => {
    const root = project({
      "package.json": pkg("a", "1.0.0"),
      "src/v.ts": "export const V = read(); // release-version\n",
    });
    expect(() => discover(root)).toThrow(/no quoted 1.0.0/);
  });
});

describe("applyVersion", () => {
  it("rewrites only the version occurrences, leaving dependencies, prose, and unmarked lines alone", () => {
    const root = workspace();
    applyVersion(discover(root), "0.4.3");
    const read = (f: string) => readFileSync(join(root, f), "utf8");
    expect(read("packages/cli/package.json")).toContain('"version": "0.4.3"');
    expect(read("packages/cli/package.json")).toContain('"@x/shared": "workspace:*"');
    expect(read("packages/ui/package.json")).toContain('"version": "0.0.7"');
    expect(read("packages/shared/src/version.ts")).toBe(
      'export const VERSION = "0.4.3"; // release-version\nexport const OTHER = "0.4.2";\n',
    );
    expect(read(".claude-plugin/marketplace.json")).not.toContain("0.4.2");
    expect(read("plugin/skills/x/SKILL.md")).toBe(
      "---\nname: x\nversion: 0.4.3\n---\n\nUses 0.4.2 in prose.\n",
    );
    expect(read("other/.claude-plugin/plugin.json")).toContain("3.1.0");
    expect(discover(root).version).toBe("0.4.3");
  });
});

describe("checkChangelog", () => {
  it("passes when the newest section is the new version and names the file", () => {
    expect(checkChangelog(discover(workspace()), "0.4.3")).toBe("CHANGELOG.md");
  });

  it("refuses when the newest section is another version", () => {
    expect(() => checkChangelog(discover(workspace()), "0.5.0")).toThrow(
      /newest section is "## 0.4.3"; write "## 0.5.0" first/,
    );
  });

  it("reads a single package's own changelog and bracketed headings", () => {
    const root = project({
      "package.json": pkg("root", "0.0.0", { private: true, workspaces: ["packages/*"] }),
      "packages/a/package.json": pkg("a", "1.0.0"),
      "packages/a/CHANGELOG.md": "# a\n\n## [1.1.0] - 2026-10-06\n",
    });
    expect(checkChangelog(discover(root), "1.1.0")).toBe("packages/a/CHANGELOG.md");
  });
});
