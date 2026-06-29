<!--
@file docs/coding-guidelines/prompt-writing.md
@description How we write prompts in AIMEAT: positive framing (say what TO do) and the wider prompt
  framework. Applies to every prompt string in the codebase — LLM system/user prompts, prompts the app
  generates for the user to paste into an AI chat (e.g. the Secretary setup interview), re-plan prompts,
  etc. The rule of thumb: an instruction describes the behaviour we want, affirmatively.
@usage Read before writing or editing any prompt string. Check a prompt against §6 before shipping it.
@version-history
  v1.0.0 — 2026-06-29 — Initial: positive framing rule + conversion move + framework + checklist.
-->

# Prompt Writing — Positive Framing & Framework

How we write prompts in this project. This is the standard to follow when writing or editing any prompt
string (LLM prompts, prompts the app hands the user to paste into an AI chat, re-plan prompts, …).

Core rule source: Anthropic prompt engineering, "Be clear and direct"
(<https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/be-clear-and-direct>):

> Tell Claude what to do instead of what not to do.
> - Instead of: "Do not use markdown in your response"
> - Try: "Your response should be composed of smoothly flowing prose paragraphs."

## 1. The core rule — say what TO do

Every instruction is written affirmatively: it describes the behaviour we **want**. A negative
instruction ("don't / never / avoid / no …") makes the model fixate on the forbidden thing and leaves
the wanted behaviour undefined. For every urge to write "don't X", ask **"what should it do instead?"**
and write THAT.

Warning words that signal a rewrite is needed: `not`, `don't`, `never`, `no`, `avoid`, `instead of`,
`rather than`, `stop`, `without`.

## 2. The conversion move (negative → positive)

Real examples from the Secretary setup prompt:

| ✗ Negative | ✓ Positive |
|-----------|-----------|
| "You are NOT a form-filler." | "Treat this as a real, flowing conversation between two people." |
| "Do not rush to the JSON." | "Lead with the conversation; capture the JSON once we share a picture that feels right." |
| "Do NOT ask about organisms/workspaces." | "Keep your words human and plain, and work out any structure quietly on your own." |
| "Never present assumptions to rubber-stamp." | "Offer your hunches as suggestions I can shape, and let me steer." |
| "Don't invent facts." | "Ground everything in what I actually told you." |
| "Output ONLY the JSON, no commentary." | "Output the single JSON code block on its own." |

## 3. The wider framework (anatomy of a good prompt)

1. **Identity stated positively** — "You are a warm, curious colleague who…", describing what it IS.
2. **Goal as a destination** — describe what the finished state looks like, so the model steers there.
3. **Behaviour as affirmative directives** — the whole body is "do this", "lead with that".
4. **Give it what it needs to succeed** (context, the tools it has, an example) over a list of pitfalls.
5. **Match the prompt's voice to the output you want** — want plain, warm, human replies? Write the
   prompt plain, warm, and human (Anthropic: matching style steers style).
6. **Quality modifiers when you want more** — e.g. "go beyond the basics", "be thorough and specific".
7. **Describe the ideal end-state and let the model reason**, over micromanaging steps.
8. **End with the one concrete next action** you want the person to take.

## 4. Language & voice conventions

- **Prompt source is ALWAYS English.** The prompt instructs the model to converse with the user in the
  user's own language, so a Finnish user still gets Finnish replies — the source stays English.
- Plain, everyday language. Skip corporate filler. Match the voice you want back.

## 5. Before / after (the Secretary interview, condensed)

**Before** (negative, infuriating): *"Act as the Secretary. You are NOT a form-filler. Do not rush to
the JSON. Do NOT ask about organisms or workspaces. Reflect the structure back and do not output JSON
until I confirm."*

**After** (positive, what we want): *"You are that Secretary, and this is the start of us working
together. Treat it as a real, flowing conversation. Be useful from the first message. Lead with the
conversation; keep your words human and plain and work out any structure quietly on your own. Keep
exploring with me until we share a picture that feels right to me; once I say it clicks, capture it as
the JSON."*

## 6. Checklist before shipping a prompt

- [ ] Zero negative-instruction words (`not` / `don't` / `never` / `no` / `avoid` / `instead of`). Every
      line says what TO do.
- [ ] Identity + goal stated as a positive destination.
- [ ] It is told how to behave and given what it needs, rather than a list of pitfalls.
- [ ] The prompt's voice matches the voice we want back.
- [ ] Source is English; it converses in the user's language.
- [ ] Ends with the single concrete next action.
