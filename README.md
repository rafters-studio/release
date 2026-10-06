# @rafters/release

Takes a TypeScript project from merged work to a pushed version tag. It sets the new version everywhere it appears, checks that the changelog leads with it, commits the release on its own branch for review, and, once that lands, tags the commit and pushes the tag. Your tag-triggered workflow publishes.

There is no config file. It reads what the project already declares.

## Install

```sh
pnpm add -D @rafters/release
```

Node 22.18 or later, and git.

## Usage

```sh
release status                      # the version, and every place it was found
release <patch|minor|major|x.y.z>   # set it, commit on release/vX.Y.Z, push the branch
release finish <x.y.z> [--wait]     # tag the commit where it landed, push the tag
```

A release, start to finish:

1. Write the changelog section for the new version (`## 1.4.0` at the top of `CHANGELOG.md`). Agents on a legion team use legion's changelog agent, which writes it from what merged since the last tag.
2. On an up-to-date default branch, run `release minor`. It refuses unless the changelog leads with `## 1.4.0`, the only uncommitted change is that changelog, the version increases, and neither the tag `v1.4.0` nor the branch `release/v1.4.0` exists yet. Then it writes the version, commits `chore(release): v1.4.0` on `release/v1.4.0`, and pushes the branch.
3. Open a PR for `release/v1.4.0` and merge it like any other change.
4. Run `release finish 1.4.0` (or `release finish 1.4.0 --wait` to wait for the merge queue). It finds the commit on the default branch that set the version, tags it `v1.4.0`, and pushes only the tag. Running it again pushes the same tag again; it refuses if the tag already points somewhere else.

When `legion` is installed, commits and pushes go through `legion commit` and `legion push` (signed, gated, and audited), using the repo's directory name; set `RELEASE_LEGION_REPO` if legion knows it by another name, or `RELEASE_NO_LEGION=1` to use git directly.

## What it reads

One version per project. Every place that carries it moves together:

| Where                                                                                                                             | What it changes                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `package.json` at the root, or each package in a pnpm (`pnpm-workspace.yaml`) or npm (`workspaces`) workspace that is not private | its `version`                      |
| any other tracked `package.json` already at the project's version (a private plugin package, for example)                         | its `version`                      |
| `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` at the project's version                                       | every `"version"` field holding it |
| `SKILL.md` frontmatter at the project's version                                                                                   | `version:`                         |
| a source line marked `release-version`                                                                                            | the quoted version on that line    |

The publishable packages must already share one version; `release status` lists them if they do not. Files at a different version (a skill that versions itself, a private package at `0.0.x`) are left alone and listed. A dependency on `workspace:*` or `catalog:` is never touched.

Workspace globs may be exact paths, `dir/*`, or `dir/**`, optionally negated with `!`; any other form is refused rather than guessed at.

To keep a version constant in source, end the line with a `release-version` comment (`//`, `#`, or `/* */`); a file that only mentions the word is ignored:

```ts
export const VERSION = "1.4.0"; // release-version
```

The changelog is `CHANGELOG.md` at the root, or the publishable package's own when there is exactly one. Headings may be `## 1.4.0`, `## [1.4.0]`, or `## v1.4.0 - 2026-10-06`.

## Publishing

`release` stops at the tag. Publish from a workflow on the tag with npm trusted publishing (no token stored anywhere):

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  id-token: write
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v6.0.10
      - uses: actions/setup-node@v5
        with:
          node-version: 24.12
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - run: pnpm publish --access=public --provenance --no-git-checks
      - run: gh release create "$GITHUB_REF_NAME" --generate-notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Do not set `registry-url` on `actions/setup-node`; it writes a token placeholder that npm then prefers over trusted publishing. In a workspace, publish each package in dependency order with `pnpm publish` (it rewrites `workspace:*` and `catalog:` to real versions), for example `pnpm -r publish --access=public --provenance --no-git-checks`.

### A brand-new package

npm can only configure trusted publishing on a package that already exists. For a package's first release:

1. Publish it once by hand from a machine logged in to npm: `pnpm publish --access=public`.
2. On npmjs.com, open the package's settings and add a trusted publisher: this GitHub repository and the workflow file (`release.yml`).
3. From then on, the tag workflow publishes it.

## Library

The same steps are exported for scripts and agents:

```ts
import { discover, prepare, finish } from "@rafters/release";

const project = discover(process.cwd()); // { version, targets, untracked }
```

## Development

```sh
vp install
vp check
vp test
vp pack
```
