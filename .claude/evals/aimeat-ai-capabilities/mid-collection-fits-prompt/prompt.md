---
description: A negative case. 800 meeting notes of about 150 words each, and the person asks for "search by meaning". The collection fits one prompt (about 160 000 tokens), so the skill says to give it to a text model whole or use word search, and not to propose embeddings.
tags: [embed, negative]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

My team keeps about 800 meeting notes on our AIMEAT node, each around 150 words. I want to ask things like "when did we decide to drop the old billing system, and why?" and get an answer from the notes, even when the notes use other words. How should I build this? Answer in at most eight sentences, with the approach you recommend.
