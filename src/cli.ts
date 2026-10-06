#!/usr/bin/env node
import { finish, prepare, status } from "./release.ts";

const USAGE = `usage:
  release status                       show the version and every place it was found
  release <patch|minor|major|x.y.z>    set the version, commit it on release/vX.Y.Z, push the branch
  release finish <x.y.z> [--wait]      tag the commit where that version landed and push the tag`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(args: string[]): Promise<number> {
  const [command, arg] = args;
  const cwd = process.cwd();

  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command === undefined ? 1 : 0;
  }

  if (command === "status") {
    const project = status(cwd);
    console.log(`version ${project.version}`);
    for (const t of project.targets)
      console.log(`  ${t.file} (${t.kind}${t.occurrences > 1 ? ` x${t.occurrences}` : ""})`);
    for (const u of project.untracked)
      console.log(`  ${u.file} left alone (its own version ${u.version})`);
    return 0;
  }

  if (command === "finish") {
    if (arg === undefined)
      throw new Error("release finish needs the version, for example: release finish 1.2.0");
    const wait = args.includes("--wait");
    const deadline = Date.now() + 30 * 60_000;
    for (;;) {
      const result = finish(cwd, arg);
      if (result.state === "tagged") {
        console.log(
          `${result.repushed ? "pushed existing" : "tagged and pushed"} ${result.tag} at ${result.sha.slice(0, 7)}`,
        );
        return 0;
      }
      if (!wait || Date.now() > deadline) {
        console.error(
          `${arg} has not landed on the default branch yet${wait ? " (gave up after 30 minutes)" : "; merge the release PR, or pass --wait"}`,
        );
        return 2;
      }
      await sleep(20_000);
    }
  }

  const result = prepare(cwd, command);
  console.log(`${result.from} -> ${result.to} on ${result.branch}`);
  for (const file of result.files) console.log(`  ${file}`);
  console.log(
    `next: open a PR for ${result.branch}, merge it, then run: release finish ${result.to}`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
