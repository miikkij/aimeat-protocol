---
name: aimeat-dev-notes
description: "Where a lesson learned while developing the AIMEAT platform or an app on it goes, and where it never goes: the build note on the node, the decision record, the pitfalls catalogue, the appdev knowledge base, the app's own skill, the wish's notes. Load when a piece of work is done and its record has to be written, or when looking for how something was built. Triggers on: development note, build note, where does this go, pitfalls, decision record, muistiinpano, mihin tämä kirjataan."
license: MIT
metadata:
  audience: agent
---

# One lesson, one home

The repo describes the platform; the node holds what it cost to build and what is still open;
a skill tells a user how to operate an app. Mixing them wastes the next session's hour.

| What was learned | Where it goes | How |
|---|---|---|
| How to use or operate an app | the app's own skill, public, `metadata.binding` to the app | `aimeat_skill_publish` |
| How an app was built: locked decisions, prod ids, traps, open questions | one document per app in **App Development Notes** (`ws-mslr8u99kzk`, organism `fbb51de5-56d5-4143-9871-b998a1187655`, space `appnote`) | `aimeat_workspace_write` + publish; extend the existing document, never a second one |
| What a platform capability's build cost and left open | one document per topic in **Platform Development Notes** (`ws-mslunjvcgxj`, same organism, space `platformnote`) | same |
| A ruling about how this project is built | a `decision` record in AIMEAT CODING CENTRAL (`da438a5f-609b-41e5-ad9f-8dd2cc76cbe1`, `ws-mtnpigaowk6`) | one sentence, the reason, the area, who, and where else it is written |
| A repeatable trap in platform code | `docs/pitfalls.md`, a new numbered section | check `git log origin/main -- docs/pitfalls.md` first; two sessions took the same number once |
| A trap that bites anyone building an app on top | the appdev KB | `aimeat_appdev_pitfall_report` |
| A rule every session must follow | `CLAUDE.md` or a skill (this one, `aimeat-dev-session`, `aimeat-subagent-brief`) | short, and pointing at the skill for the detail |
| What Jouni asked for and where it stands | the `wish` record in the wish bucket (`ws-mtemu9rieuk`) | status and notes; a `brief` document when it needs more than a paragraph |
| What a session left unfinished | a `handoff` document (`ws-mtnpikq83yg`) | the four sections the session skill names |

## Writing a build note

Sections: **What shipped** (with the commit), **What it cost** (each trap with its fix, so the
next reader does not pay it again), **Open** (what is left and why). Prose; numbers in tables;
ids as evidence inside sentences that work without them. English unless the lead hands you
Finnish. To change one part of an existing note, replace an H2 with
`aimeat_workspace_doc_section_replace`; replacing the H1 replaces the whole document.

## What never goes to a note

A local memory or a repo file only this session or this repo can see. A skill's operating text.
A changelog entry (that is for what a person gets, asked from the developer first). A secret,
a password, a token.
