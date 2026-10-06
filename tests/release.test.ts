import { beforeAll, describe, expect, it } from "vite-plus/test";
import { finish, prepare } from "../src/release.ts";
import { git, pkg, project, write } from "./helpers.ts";

beforeAll(() => {
  process.env.RELEASE_NO_LEGION = "1";
});

const single = () =>
  project({ "package.json": pkg("@x/solo", "1.0.0"), "CHANGELOG.md": "# solo\n\n## 1.0.0\n" });

describe("prepare", () => {
  it("commits the new version on release/vX.Y.Z and pushes the branch, without tagging", () => {
    const root = single();
    write(root, { "CHANGELOG.md": "# solo\n\n## 1.1.0\n\n- New.\n\n## 1.0.0\n" });
    const result = prepare(root, "minor");
    expect(result).toMatchObject({ from: "1.0.0", to: "1.1.0", branch: "release/v1.1.0" });
    expect(git(root, "log", "-1", "--format=%s")).toBe("chore(release): v1.1.0");
    expect(git(root, "ls-remote", "--heads", "origin", "release/v1.1.0")).not.toBe("");
    expect(git(root, "tag", "--list")).toBe("");
  });

  it("refuses a version that does not increase", () => {
    expect(() => prepare(single(), "0.9.0")).toThrow(/does not increase/);
  });

  it("refuses when the changelog does not lead with the new version", () => {
    expect(() => prepare(single(), "patch")).toThrow(/write "## 1.0.1" first/);
  });

  it("refuses other uncommitted changes", () => {
    const root = single();
    write(root, { "CHANGELOG.md": "# solo\n\n## 1.0.1\n", "src/x.ts": "export {};\n" });
    expect(() => prepare(root, "patch")).toThrow(/uncommitted changes besides CHANGELOG.md/);
  });

  it("refuses an existing release branch before writing anything", () => {
    const root = single();
    git(root, "branch", "release/v1.0.1");
    write(root, { "CHANGELOG.md": "# solo\n\n## 1.0.1\n" });
    expect(() => prepare(root, "patch")).toThrow(/branch release\/v1.0.1 already exists/);
    expect(git(root, "diff", "--name-only")).toBe("CHANGELOG.md");
  });

  it("refuses an existing tag", () => {
    const root = single();
    git(root, "tag", "v1.0.1");
    write(root, { "CHANGELOG.md": "# solo\n\n## 1.0.1\n" });
    expect(() => prepare(root, "patch")).toThrow(/tag v1.0.1 already exists/);
  });
});

describe("finish", () => {
  // Simulates the release PR merging into main, followed by an unrelated commit.
  const landed = () => {
    const root = single();
    write(root, { "CHANGELOG.md": "# solo\n\n## 1.0.1\n" });
    prepare(root, "patch");
    git(root, "switch", "--quiet", "main");
    git(root, "merge", "--quiet", "--ff-only", "release/v1.0.1");
    const release = git(root, "rev-parse", "HEAD");
    write(root, { "package.json": pkg("@x/solo", "1.0.1", { description: "later" }) });
    git(root, "commit", "--quiet", "-am", "docs: describe");
    git(root, "push", "--quiet", "origin", "main");
    return { root, release };
  };

  it("reports not landed before the release merges", () => {
    expect(finish(single(), "1.0.1")).toEqual({ state: "not-landed", tag: "v1.0.1" });
  });

  it("tags the commit that set the version, not a later one, and pushes only the tag", () => {
    const { root, release } = landed();
    expect(finish(root, "1.0.1")).toEqual({
      state: "tagged",
      tag: "v1.0.1",
      sha: release,
      repushed: false,
    });
    expect(git(root, "ls-remote", "--tags", "origin", "v1.0.1")).toContain("v1.0.1");
  });

  it("is safe to run again", () => {
    const { root, release } = landed();
    finish(root, "1.0.1");
    expect(finish(root, "1.0.1")).toEqual({
      state: "tagged",
      tag: "v1.0.1",
      sha: release,
      repushed: true,
    });
  });

  it("refuses when the tag points at another commit", () => {
    const { root } = landed();
    git(root, "tag", "v1.0.1", "HEAD");
    expect(() => finish(root, "1.0.1")).toThrow(/already points at/);
  });
});
