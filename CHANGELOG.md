# @rafters/release

## 0.1.2

### Fixed

- `release finish` tags the merge commit that landed the release, not the version commit on the release branch, so the tag holds every fix pushed to the release PR after the version was set. (#13)

## 0.1.1

The first version published to npm, from the tag workflow through trusted publishing with provenance. No code changes since 0.1.0, which was tagged but never published.

## 0.1.0

The first release: one command takes any TypeScript project from merged work to a pushed version tag, with no config file and no shell scripts. Publishing stays in the project's own tag-triggered workflow.

### New

- `release status` shows the project's version and every place it appears: the root package or a pnpm or npm workspace's publishable packages, other package.json files already at that version, Claude plugin and marketplace manifests, SKILL.md frontmatter, and source lines ending in a `release-version` comment. Files at their own version are listed and left alone. (#3)
- `release <patch|minor|major|x.y.z>` sets the new version everywhere and commits it on `release/vX.Y.Z`, pushing the branch for review. It refuses, before writing anything, when the version does not increase, the tag or the release branch already exists, the changelog does not lead with the new version, or anything besides the changelog is uncommitted. Commits and pushes go through legion when it is installed. (#3)
- `release finish <x.y.z> [--wait]` tags the commit on the default branch that set the version and pushes only the tag; running it again is safe, and a tag pointing elsewhere is refused. (#3)
- The same steps are exported as a library: `discover`, `prepare`, `finish`. (#3)
