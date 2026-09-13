---
description: A commit message for a real-shaped change; the skill says a commit message explains why the change exists and what it costs, without the AI tells.
tags: [english, commit]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
---

Write the commit message for this change. The retry logic for outbound webhooks used to live in two places: the MCP tool retried three times with no delay, and the REST route never retried at all, so the same webhook succeeded or failed depending on which door an agent used. I moved the retry into one service function that both call, with three attempts and a two-second backoff. A webhook receiver that is down now makes the REST call take up to six seconds longer before it fails. Reply with only the commit message.
