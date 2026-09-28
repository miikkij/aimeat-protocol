---
description: A negative case. A person with 120 recipes wants search; the skill says embeddings are not worth it for a few hundred texts, so the answer should propose word search or the whole collection in a prompt.
tags: [embed, negative]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

I keep my 120 family recipes as memory records on my AIMEAT node, one record per recipe. I want an app where I can type something like "a quick soup without dairy" and find the right recipes. How should the app search? Answer in at most eight sentences, with the approach you recommend.
