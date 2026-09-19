# docs/typesafe

A local working folder for the TypeSafe (Jev) integration behind `AIMEAT.decide`. Only this
README is in git. Everything else here is ignored on purpose:

- **TypeSafe's documentation snapshot** (`typesafe-docs/`, fetched 2026-09-19). It is the
  vendor's copyrighted material, and a copy of it does not belong in this repository.
- **`FINDINGS.md` and anything measured about the model.** Clause 2.3(f) of TypeSafe's Master
  Customer Agreement forbids publishing benchmarks or performance information. A public
  repository is publishing. Keep measurements in this folder or in an unpublished draft in the
  development organism, never in a committed file, a published document or a post.

**One exception** (Jouni, 2026-09-19): a figure TypeSafe publishes itself, on its site or its
blog, may be repeated. It is TypeSafe's claim, not our measurement: name TypeSafe as the source
next to the figure, link the page it comes from, and say it was not measured here.

The snapshot goes stale. Refetch it from `https://docs.typesafe.ai/llms.txt`, which lists every
page; each page is served as Markdown at its own path with `.md` appended.

A folder that git ignores is not backed up by git. It exists on the machine that fetched it.
