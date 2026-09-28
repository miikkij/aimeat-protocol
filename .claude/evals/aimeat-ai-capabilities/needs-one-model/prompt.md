---
description: An app that truly needs one strong model; the skill says declare it in the aimeat-ai meta with models=<type>:<model id> rather than only naming it in the call.
tags: [app, meta]
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

On an AIMEAT node I am building a single-file HTML app (id `contract-check`) that reviews legal contracts. It must only ever run on Anthropic's Claude Opus 5.5 (reference `anthropic:claude-opus-5-5`), because weaker models miss clauses. Show the head of the HTML and the one function that sends a contract text for review, using aimeat-ai.js. Reply with only the code.
