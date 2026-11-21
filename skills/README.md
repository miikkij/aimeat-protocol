# Node skills kept in git

The sources of the platform's node-scope skills that a node does not seed itself. The skills built
into every node live in `aimeat/src/data/builtin-skills*.ts` and are not here. An app's own skill
lives beside the app in the `aimeat-apps` repository (`<app>/skills/<name>/SKILL.md`) and is not
here either.

**Why this folder exists.** These skills were published straight to aimeat.io and had no copy
anywhere else, so a reset of that node would have lost them (2026-11-21). Each folder holds the
skill exactly as aimeat.io served it on the day it was copied: `SKILL.md` and any other file of the
skill, at the same paths.

**Not loaded by Claude Code.** Claude Code reads skills from `.claude/skills/`, and this folder is
not that one, so nothing here enters a session's skill list. A skill a session should load while it
works in this repository belongs in `.claude/skills/`.

## Change one

1. Edit the files here.
2. Publish the folder to the node: zip it (the folder, with `SKILL.md` inside), call
   `aimeat_skill_publish { scope: "node" }` with no `skill_md` to get an upload address, and PUT
   the zip there. Node scope is the operator's.
3. Commit the change in the same session. A skill changed on the node and not here is the drift this
   folder exists to prevent; when you find one, copy the node's version here and commit it.

## Put one back on a new or reset node

Publish each folder as in step 2. The folder name is the skill name.
