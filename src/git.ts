import { execFileSync } from "node:child_process";
import { basename } from "node:path";

export interface Runner {
  (cmd: string, args: string[], options?: { input?: string }): string;
}

export function runner(cwd: string): Runner {
  return (cmd, args, options) =>
    execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      input: options?.input,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
}

function ok(run: Runner, cmd: string, args: string[]): boolean {
  try {
    run(cmd, args);
    return true;
  } catch {
    return false;
  }
}

export class Git {
  constructor(
    private readonly run: Runner,
    readonly root: string,
  ) {}

  static at(cwd: string): Git {
    const root = runner(cwd)("git", ["rev-parse", "--show-toplevel"]);
    return new Git(runner(root), root);
  }

  // Commits and pushes go through legion when it is installed (RELEASE_NO_LEGION=1 opts out).
  get legionRepo(): string | null {
    if (process.env.RELEASE_NO_LEGION === "1" || !ok(this.run, "legion", ["--version"]))
      return null;
    return process.env.RELEASE_LEGION_REPO ?? basename(this.root);
  }

  defaultBranch(): string {
    try {
      return this.run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).replace(
        /^origin\//,
        "",
      );
    } catch {
      return "main";
    }
  }

  fetch(): void {
    this.run("git", ["fetch", "--quiet", "--tags", "origin"]);
  }

  currentBranch(): string {
    return this.run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  head(ref = "HEAD"): string {
    return this.run("git", ["rev-parse", ref]);
  }

  // Paths with uncommitted changes, relative to the root.
  dirty(): string[] {
    const changed = this.run("git", ["diff", "--name-only", "HEAD"]);
    const untracked = this.run("git", ["ls-files", "--others", "--exclude-standard"]);
    return [...changed.split("\n"), ...untracked.split("\n")].filter(Boolean);
  }

  tagSha(tag: string): string | null {
    try {
      return this.run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]);
    } catch {
      return null;
    }
  }

  branchExists(branch: string): boolean {
    const local = ok(this.run, "git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return (
      local || this.run("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]) !== ""
    );
  }

  remoteTagExists(tag: string): boolean {
    return this.run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "";
  }

  // Newest first: commits on `ref` that touched `file`.
  commitsTouching(ref: string, file: string): string[] {
    return this.run("git", ["log", "--format=%H", ref, "--", file]).split("\n").filter(Boolean);
  }

  show(sha: string, file: string): string {
    return this.run("git", ["show", `${sha}:${file}`]);
  }

  commitRelease(branch: string, files: string[], message: string): void {
    this.run("git", ["switch", "--create", branch]);
    this.run("git", ["add", "--", ...files]);
    const legion = this.legionRepo;
    if (legion) {
      this.run("legion", ["commit", "--repo", legion], { input: message });
      this.run("legion", ["push", "--repo", legion, "--branch", branch]);
    } else {
      this.run("git", ["commit", "--quiet", "--file", "-"], { input: message });
      this.run("git", ["push", "--quiet", "--set-upstream", "origin", branch]);
    }
  }

  tag(tag: string, sha: string): void {
    const signed = ok(this.run, "git", ["config", "user.signingkey"]);
    this.run("git", ["tag", signed ? "--sign" : "--annotate", tag, "--message", tag, sha]);
  }

  pushTag(tag: string): void {
    const legion = this.legionRepo;
    if (legion) this.run("legion", ["push", "--repo", legion, "--tag", tag]);
    else this.run("git", ["push", "--quiet", "origin", `refs/tags/${tag}`]);
  }
}
