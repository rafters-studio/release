# release

Takes a TypeScript project from merged work to a pushed version tag: sets the version everywhere it appears, gets the changelog written from what merged, sends the release through the normal review and merge path, and tags the commit that lands. It does not publish; the tag triggers the project's own workflow. Owned by the platform agent.

If you are part of a legion team, orient through legion before reading anything here:

```
legion whoami --repo platform          # who owns this repo
legion whatami --repo platform         # how platform works
legion recall --repo release           # what release remembers about the task at hand
legion sym ...                         # code questions: definitions, references
```

The intent is legion document 01a10f09-0fcb-7e62-9c3e-bd0d7ee485ce (surface release).

Toolchain: Vite+ (`vp`). Run `vp install` after pulling, and `vp check` and `vp test` before committing.
