---
type: regex
pattern: '^\s*(?:```[^\r\n]*\r?\n\s*)?(?!```)(?:\S[^\r\n]{71,}\S|(?=\S)[^\r\n]*\r?\n\s*\S(?:\S|[^\S\r\n](?=[^\S\r\n]*\S)|[^\S\r\n]*\r?\n\s*(?=\S)(?!```\s*$)){600})'
match: not_contains
---
