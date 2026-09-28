---
description: A small app that makes a picture from a description; the skill says check the capability first, show the fix when it is off, ask for the capability and not a model, and tell the price first.
tags: [app, image]
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

On an AIMEAT node, write a single-file HTML app (id `poster-maker`) where a person types a description and presses a button to get a picture made from it. It uses the node's own libraries aimeat-auth.js and aimeat-ai.js from /v1/libs/. Reply with only the HTML file.
