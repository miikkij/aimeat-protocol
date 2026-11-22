# AGENTS.md

For coding agents that do not read `CLAUDE.md`: Codex, Cursor, Copilot, Gemini CLI and the rest.
Claude Code reads `CLAUDE.md`, and that file is the source of every rule here. This file is a
pointer, not a copy: it tells you what to read, and it names the rules that bite before you would
find them there. Where the two differ, `CLAUDE.md` wins. It was first written on 2026-09-19, after a
model working in this repository without these rules built the wrong thing three times in a row.

## This repository is public

Nothing in it names an organisation node or the company behind one: not its address or node id,
its members, its apps, organisms, customers or projects, a data map copied from it, or the state of
its compliance register. Write a fix found on such a node in general words in code, tests and
commit messages ("an organisation node", "an app that keeps colleagues' ratings"). Fixtures use
invented names (alice, bob, carol). The `commit-msg` and `pre-push` hooks refuse a term from that
node's lists. Once `AIMEAT_SESSION` is exported, they also refuse your commit when the list is
missing on the machine (`node aimeat/scripts/check-private-terms.mjs --where` says where it is).
An outside contributor holds no such names: point `AIMEAT_PRIVATE_TERMS` at an empty file of your
own, as `CONTRIBUTING.md` says. Push `main` only.

## The rules that bite first

- **Ask first** before release tags, CI builds and the full E2E sweep (about two hours; it runs only
  when Jouni asks or has approved the work). When he asks for a release, the full run its check
  needs is part of that request (`pnpm nightly:preflight --dispatch`); the tag and the publish stay
  his. Ask also before a new entry in `docs/known_gaps.md`, before publishing a roadmap item or a
  ruling, and at the end of every feature with the proposed `aimeat/public/changelog.json` entry.
- **A fix covers the whole defect**, not the reported symptom: a delete that leaves data behind is
  checked in every table and store that carries the id.
- **Never claim anything about production without probing it**: `curl <node>/v1/build` gives the
  commit that runs. Test at the size production has, not with two fixtures.
- **Every place you mention comes with its URL**: production, or your sandbox with the account and
  what to press.
- **The wish bucket stays true**: close the wish in the session that shipped it, before you say it
  is done (skill `user:happydude500001/aimeat-wish-bucket` on the node).
- **Replies to Jouni** use ASD-STE100 Simplified Technical English, or selkeä kieli in Finnish. No
  em-dashes, and none of the words and patterns `CLAUDE.md` bans ("delve", "robust", "it's not X,
  it's Y").

## Read these first, in this order

1. **`CLAUDE.md`, in full.** What the project is for, how Jouni works, the gates, where knowledge
   lives. Everything in this file is a pointer into it or a rule that bites before you would find it.
2. **`.claude/rules/*.md`.** Rules for one kind of code. The `paths` list at the top of each file
   says which files it covers. Claude Code loads them by itself when it opens a matching file; you
   run `pnpm rules:for <the files you will edit>` and read every file it names before the edit. It
   reads the same `paths` lists, so you get the rules Claude Code gets.
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

- **A new app is built on the Atelier track; on the finest level it is forked from a genre.** A
  quick prototype or an ordinary page starts from the Atelier shell with no genre. Load the skill
  `node:aimeat-app-builder-atelier` and read its specification: `aimeat_handbook_get { tier:
  "build-app-atelier" }`, in parts: `genre`, `libraries`, `book` and `patterns` before any code, and
  the platform sections the app needs. The Classic track was retired on 2026-11-19: an app built on
  it is changed with the Atelier specification and moved with its section `from-classic`.
- **The level is the finest unless the owner chose a lower one.** Do not ask it: say you build the
  finest (a forked genre, the Book's parts, components of its own, each written down with its
  reason), and that a quick prototype (the kit as it comes, no styling) or an ordinary page (a
  ready layout and look from the Design Book) is theirs to pick. All three are Atelier and
  bilingual, so a prototype is raised later without starting over. The page states it in
  `<meta name="aimeat-level" content="proto|plain|fine">`. Never pick a lower level yourself.
- **The phone and the desktop are two layouts of one app**, decided from the person's tasks: part
  `screens` of the Atelier specification. A desktop that is the phone column stretched is not done.
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
  the Book. The page names the parts (`<meta name="aimeat-book-parts">`) and carries the layout as
  data (`<script type="application/json" id="aimeat-layout">`); the publish counts the parts and
  stores the layout, so nothing is called afterwards. The proposal owes one line: "From the Design Book I take: …" or "… I take nothing,
  because …".
- **Write down why, as you choose, and put nothing into the Design Book because a build is
  finished.** The page carries `<script type="application/json" id="aimeat-build-notes">` with
  `took`, `passed` and `made`, one true sentence of why each; the publish keeps them with the
  version. Jouni rebuilt one app three times and liked the third: only an app its owner says
  turned out well teaches the Book anything. When he says so, record it with
  `aimeat_designbook_keep { filename }`, and then offer what the app made by hand as Design Book
  `component` parts (markup and a stylesheet under one class prefix, colours as `var(--ak-…)`
  tokens, no script), each with your honest judgement: `general` or `special`, and why. A general
  one is published by itself. Build hand-made pieces in that shape from the start.
- **The genre is the look.** A look preset with components stacked in it, under a genre's name, is
  the default page every app looks like, and it is what gets sent back.
- **Judge what it looks like, not only that it works.** Passing tests, contrast and page width do
  not make a page good. Check every page at 390×844, 1280×900 and 1280×460, in both themes and
  both languages; on the finest level, put the result at 390×844 and 1280×900 beside the genre it
  was forked from and ask whether it holds up. A broken header in your own
  screenshot is a reason to stop, whatever else passed.
- **Look for a browser before you say you have none, and never let its absence hold a publish
  back.** List your tools and search them for `playwright`, `browser` and `chrome`: this machine
  has a Playwright MCP server driving Chrome, and a session that has it and does not look is the
  failure seen three builds in a row. With no browser, publish anyway, give the address, and
  say in one line what you could not check yourself.
- **Done means all of what was agreed.** Check every requirement against the result before you say
  done. Jouni is not the quality check you left out.

## Working in this repository

- **Start the session with `pnpm agent:start`.** It prints what Claude Code's SessionStart hook
  prints: whether the session is named, whether you sit in your own worktree, main's CI and
  nightly state, and the board to read before the first edit. Claude Code runs it by itself; you
  run it. On Windows the hooks run in Git Bash, which the command finds from git itself; the
  `bash` in `C:\Windows\System32` is WSL and is never used. `AIMEAT_BASH` names another bash.
- Every session works in its own git worktree, never in the main checkout: `pnpm agent:worktree
  <name>` makes it the way Claude Code's WorktreeCreate hook does. Never copy `.env.test.*` by
  hand: the examples name one port and one database, and the runner empties that database between
  suites, so two sessions testing at once wipe each other.
- Coordination lives on aimeat.io, not in chat. Export the session and the project in the shell
  that commits (`AIMEAT_SESSION=<tool>-<owner>-<tag>`, `AIMEAT_PROJECT=aimeat-protocol`), read the
  Lifecycle Central board with your project (`board_read { project }`), and claim the paths and the
  E2E port before you edit (a free port in 40251-40499 that no active claim names). Apply that
  port with `AIMEAT_E2E_PORT=<port> pnpm test:env:init --force` from `aimeat/`: the worktree
  already has its env files, and without `--force` the script keeps them and the old port. Skill
  `aimeat-dev-session` on the node has the ritual. With `AIMEAT_SESSION` set, the git hooks treat
  you as a session: they stamp the `Session:` and `Project:` trailers and hold your commits and
  pushes to the session rules below.
- Look at a change on your own node: `pnpm sandbox` from `aimeat/`. Run the E2E suites the change
  can reach, one at a time with `--test=<suite>`. Never start the full sweep on your own: it takes
  about two hours and runs only when Jouni asks for it.
- Never `git add -A`. Stage files by name. No `Co-Authored-By` trailer.
- A multi-line commit message goes in a file: `bash scripts/git-commit.sh <file>`. On Windows that
  `bash` is Git Bash (`"C:\Program Files\Git\bin\bash.exe"` from PowerShell), never the WSL one.
  The subject is at most 72 characters and the body at most 600, and the body says why the change
  exists. It never says who approved or asked for it. It uses industry terms (endpoint, route, MCP
  tool), not metaphors, and its paragraphs are not hard-wrapped.
- Edit files with your editing tool, never with `sed`, a heredoc or an inline script.
- Reuse what exists. A new MCP tool, route, table or page type needs a reason that a memory record
  and a prompt could not cover.
- Finished work reaches `main` in three steps (2026-11-15): while developing, only the suites of the
  area the change reaches; when it looks done, `pnpm check:fast` once (fix every red line in one go);
  then `pnpm ready` from `aimeat/`, which runs the full E2E sweep and the builds on GitHub on a
  `ready/<session>` branch and puts the work on `main` only when green. The origin is public: push no
  other branch.
- Answer in Finnish when Jouni writes Finnish, composed in Finnish, plain and short. The answer
  first, the evidence after it: a status question is answered in the first sentence as "done",
  "done, except X, which needs your decision" or "not done, it is at X". No em-dashes.
- Ask before spending money, changing AI settings, touching infrastructure, deleting anything, or
  building something that was not agreed, and before everything in "The rules that bite first".
