import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

// A git repo with the given files committed on main, pushed to a bare origin.
export function project(files: Record<string, string>): string {
  const base = mkdtempSync(join(tmpdir(), "release-test-"));
  const origin = join(base, "origin.git");
  const root = join(base, "work");
  execFileSync("git", ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
  mkdirSync(root);
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "tag.gpgsign", "false");
  write(root, files);
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "chore: init");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "--quiet", "-u", "origin", "main");
  git(root, "remote", "set-head", "origin", "main");
  return root;
}

export function write(root: string, files: Record<string, string>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

export const pkg = (name: string, version: string, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ name, version, ...extra }, null, 2)}\n`;
