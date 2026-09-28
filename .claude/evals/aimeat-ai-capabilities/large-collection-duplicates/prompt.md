---
description: A positive case. 40 000 support tickets written by different people; finding the ones that describe the same problem in different words is where embeddings help, and the skill says to keep the model with every vector and not to put the vectors in one memory value.
tags: [embed, positive]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Our AIMEAT node holds about 40 000 support tickets from the last three years. Many describe the same problem in different words ("app freezes on login", "stuck at the sign-in screen"). I want a nightly automation that finds likely duplicates among new tickets. Describe how you would build it on the node, in at most twelve sentences.
