---
paths:
  - "**/.claude/skills/**"
  - "**/.claude/evals/**"
---

<!-- Written 2026-09-13 with the first suite (wish-plugin-evals-for-the-repo-s-skills). It loads when Claude reads a skill or an eval case, not at session start. -->

## Changing a skill that has an eval suite

- **Measure before and after, and report the delta.** A skill with a suite under `.claude/evals/<skill>/` is changed with `pnpm eval:skill <skill> --model <model> --max-cost-usd <ceiling>` run on the version before the change and again after it. The report says the model, the runs per case, the with-skill and without-skill scores, and the delta per case. One run proves nothing: on 2026-09-13 two identical headless runs of one task cost $0.27 and $0.72, and the eval runs each case three times in both arms for that reason.
- **Read the baseline for what it is.** An eval run loads no CLAUDE.md, rules or other skills, so the without-skill arm is a bare Claude. A delta of zero on a case means that model already does the thing unaided, which is a reason to write a harder case, not a reason to delete the skill. Measured on the first `aimeat-writing` suite: Sonnet gained +0.08, +0.08 and +0.33 on its three cases; Opus gained 0, 0 and +0.33, the gain on both being the administrator help line.
- **A suite is written like a test.** Each case gets graders on the answer and one `tool_used: Skill` indicator. Prefer `regex` graders (free, stable); keep `llm` graders to short answers with PASS and FAIL conditions, and pass `--judge-model sonnet` when the rubric needs judgement a small model does not have, such as whether Finnish reads as translated. A grader that has never failed in any run has not been shown to work: before trusting it, make it fail once on purpose. In the first `aimeat-writing` suite, five of the twelve scored graders failed at least once (the em-dash check in two cases, the kept STARTTLS term, two rubrics) and seven never failed in 36 runs, so those seven are guards against rarer tells that nothing has yet exercised.
- **One home for the skill.** The runner (`scripts/eval-skill.mjs`) builds a throwaway plugin from `.claude/skills/<skill>/` for every run. Do not add a plugin manifest to a skill folder or copy a skill under a plugin directory to evaluate it: the first changes how every session loads the skill, the second is a copy that drifts.
