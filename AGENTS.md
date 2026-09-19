# AGENTS.md

For coding agents that do not read `CLAUDE.md`: Codex, Cursor, Copilot, Gemini CLI and the rest.
Claude Code reads `CLAUDE.md`. That file is the source, and this one exists so that you arrive with
the same rules. It was written on 2026-09-19, after a model working in this repository without any
of them built the wrong thing three times in a row.

## Read these first, in this order

1. **`CLAUDE.md`, in full.** What the project is for, how Jouni works, the gates, where knowledge
   lives. Everything below is a pointer into it or a rule that bites before you would find it.
2. **`.claude/rules/*.md`.** Rules for one kind of code. The `paths` list at the top of each file
   says which files it covers. Claude Code loads them by itself when it opens a matching file; you
   have to open the ones that match what you are about to touch. The table in `CLAUDE.md` ("Rules
   that load by path") says which is which.
3. **`.claude/skills/<name>/SKILL.md`.** How one kind of task is done here. Read the one that
   matches the task BEFORE you start:
   - `aimeat-app-building`: building, publishing or changing an app on AIMEAT.
   - `aimeat-frontend-verify`: any change to a page, and how it is checked in a real browser.
   - `aimeat-design-language`: fonts, colours, shapes, and what a change to one of them reaches.
   - `aimeat-writing`: any text a person reads, in English, Finnish or Spanish.
   - `aimeat-library-authoring`: shared code (served libs, cortex libs, extensions, packs).
   - `aimeat-imagery`: any picture (`scripts/gen_image.py`, run with `uv run python`).
   - `aimeat-organism-records`, `aimeat-pages-links`, `aimeat-video`: as their names say.
4. **The node, over MCP.** `aimeat_handbook_get` with no arguments is the node's operating guide
   and lists its skills by situation; `aimeat_skill_get` loads one. What the node says wins over
   what you remember.

## Building an app: the rules that were broken

- **A new app is built on the Atelier track, forked from a genre.** Load the skill
  `node:aimeat-app-builder-atelier` and read its specification: `aimeat_handbook_get { tier:
  "build-app-atelier" }`, in parts: `genre`, `libraries` and `patterns` before any code. The Classic track is
  for an app that is already Classic, or when Jouni asks for it by name. "Quicker to start" is not
  a reason, and a track is never changed in the middle of a build.
- **Ask the level first.** A quick prototype (the kit as it comes, no styling), an ordinary page
  (a ready layout and look from the Design Book), or the finest (a forked genre, the Book's parts,
  components of its own, and those put into the Book afterwards). All three are Atelier and
  bilingual, so a prototype is raised later without starting over. The page states it in
  `<meta name="aimeat-level" content="proto|plain|fine">`. Never pick a lower level silently.
- **Propose before you build, and wait.** On the finest level: two or three genres by name with why each fits, the
  languages, who signs in, the first screen in a sentence. Jouni chooses. He must not find out what
  you chose by looking at the result.
- **English and Finnish, always, unless he asks for one.** The language of the conversation is not
  the app's language list. Every string goes through a dictionary; the node's own sign-in bar
  carries the switch. Never write a header control or a language switch of your own.
- **The working screen is a mosaic inside the genre, and its arrangement comes from the Design
  Book.** The genre is the frame; the list, the numbers, the form and the history are
  `AIMEAT.atelier.mosaic({ target, sources, fallback })` mounted into one element of the genre
  page, with `fallback` taken from a Book fill. A genre page with no mosaic cannot use one part of
  the Book. The proposal owes one line: "From the Design Book I take: …" or "… I take nothing,
  because …".
- **The genre is the look.** A look preset with components stacked in it, under a genre's name, is
  the default page every app looks like, and it is what gets sent back.
- **Judge what it looks like, not only that it works.** Passing tests, contrast and page width do
  not make a page good. Put the result beside the genre it was forked from, at 390 and 1440 px, in
  both themes and both languages, and ask whether it holds up. A broken header in your own
  screenshot is a reason to stop, whatever else passed.
- **Look for a browser before you say you have none, and never let its absence hold a publish
  back.** List your tools and search them for `playwright`, `browser` and `chrome`: this machine
  has a Playwright MCP server driving Chrome, and a session that has it and does not look is the
  failure seen three builds in a row. With no browser, publish anyway, hand over the address, and
  say in one line what you could not check yourself.
- **Done means all of what was agreed.** Check every requirement against the result before you say
  done. Jouni is not the quality check you left out.

## Working in this repository

- Every session works in its own git worktree under `.worktrees/`, never in the main checkout.
- Never `git add -A`. Stage files by name. No `Co-Authored-By` trailer.
- A multi-line commit message goes in a file: `bash scripts/git-commit.sh <file>`.
- Edit files with your editing tool, never with `sed`, a heredoc or an inline script.
- Finished work is merged to `main` and pushed, after `pnpm gate`, and CI is checked green before
  the word "done".
- Answer in Finnish when Jouni writes Finnish, composed in Finnish, plain and short. The answer
  first, the evidence after it. No em-dashes.
- Ask before spending money, changing AI settings, touching infrastructure, deleting anything, or
  building something that was not agreed.
