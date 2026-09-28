---
description: A two-capability app (transcription, then text); the skill says check both first and handle AI_CAPABILITY_UNAVAILABLE visibly.
tags: [app, transcription]
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
---

On an AIMEAT node, write the JavaScript for an app (id `voice-notes`) that takes a voice message already stored in the person's node storage (you get its storage key) and shows its transcript and a three-line summary. The app loads aimeat-auth.js and aimeat-ai.js from /v1/libs/. Reply with only the JavaScript.
