import { applyVersion, checkChangelog } from "./apply.ts";
import { type Project, discover } from "./discover.ts";
import { Git } from "./git.ts";
import { compareVersions, isVersion, nextVersion } from "./version.ts";

export const tagFor = (version: string): string => `v${version}`;

export interface PrepareResult {
  from: string;
  to: string;
  branch: string;
  files: string[];
}

// Sets the new version everywhere, commits it on release/vX.Y.Z, and pushes the branch.
// Refuses before touching anything if a precondition fails.
export function prepare(cwd: string, target: string): PrepareResult {
  const git = Git.at(cwd);
  const project = discover(git.root);
  const to = nextVersion(project.version, target);
  if (compareVersions(to, project.version) <= 0) {
    throw new Error(`${to} does not increase on the current version ${project.version}`);
  }
  const tag = tagFor(to);

  const main = git.defaultBranch();
  if (git.currentBranch() !== main)
    throw new Error(`run a release from ${main}, not ${git.currentBranch()}`);
  git.fetch();
  if (git.head() !== git.head(`origin/${main}`))
    throw new Error(`${main} is not in sync with origin/${main}; pull or push first`);
  if (git.tagSha(tag) !== null || git.remoteTagExists(tag))
    throw new Error(`tag ${tag} already exists`);

  const changelog = checkChangelog(project, to);
  const dirty = git.dirty().filter((file) => file !== changelog);
  if (dirty.length > 0)
    throw new Error(`uncommitted changes besides ${changelog}:\n  ${dirty.join("\n  ")}`);

  const files = [...applyVersion(project, to), changelog];
  const branch = `release/${tag}`;
  git.commitRelease(branch, files, `chore(release): ${tag}\n`);
  return { from: project.version, to, branch, files };
}

export type FinishResult =
  | { state: "tagged"; tag: string; sha: string; repushed: boolean }
  | { state: "not-landed"; tag: string };

// The commit that first set `version` in `file`, among the newest run of commits
// on `ref` that carry it. Later commits that touch the file but keep the version
// are not the release.
export function findReleaseCommit(
  git: Git,
  ref: string,
  file: string,
  version: string,
): string | null {
  let found: string | null = null;
  for (const sha of git.commitsTouching(ref, file)) {
    const parsed: unknown = JSON.parse(git.show(sha, file));
    const v =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { version?: unknown }).version
        : undefined;
    if (v === version) found = sha;
    else if (found !== null) break;
  }
  return found;
}

// Tags the commit where `version` landed on origin's default branch and pushes only the tag.
// Safe to run again: a tag already on that commit is pushed again; one elsewhere is refused.
export function finish(cwd: string, version: string): FinishResult {
  if (!isVersion(version)) throw new Error(`"${version}" is not a version`);
  const git = Git.at(cwd);
  const tag = tagFor(version);
  git.fetch();
  const record = discover(git.root).targets.find((t) => t.kind === "package")!.file;
  const sha = findReleaseCommit(git, `origin/${git.defaultBranch()}`, record, version);
  if (sha === null) return { state: "not-landed", tag };

  const existing = git.tagSha(tag);
  if (existing !== null && existing !== sha) {
    throw new Error(
      `tag ${tag} already points at ${existing.slice(0, 7)}, not the release commit ${sha.slice(0, 7)}`,
    );
  }
  if (existing === null) git.tag(tag, sha);
  git.pushTag(tag);
  return { state: "tagged", tag, sha, repushed: existing !== null };
}

export function status(cwd: string): Project {
  return discover(Git.at(cwd).root);
}
