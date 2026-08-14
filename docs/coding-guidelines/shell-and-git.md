# Passing text through a shell, and committing

This machine has two shells. PowerShell is primary on Windows; Bash sits beside it. Their
multi-line string syntaxes are not the same, and nothing warns you when you use one in the other:
the wrong syntax is usually valid *characters*, so the command succeeds and the text is wrong.

That is not hypothetical. Seven commits in this repo's history end with a stray `@`, and three of
them (2026-08-13) also carry it as their first line, so `git log --oneline` shows
`@ feat(agents): …` instead of the subject. The cause was one line:

```bash
git commit -m @'
feat(agents): …
'@
```

`@'…'@` is a PowerShell here-string. In Bash it is the character `@`, a quoted string, and another
`@`. Git accepted the message, the pre-commit hook passed, the push worked. A pushed subject line
can only be corrected by rewriting history, so the damage is permanent.

## The rule

**A multi-line string is never a shell argument.** Write it to a file, hand over the path.

| You want to | Do this |
|---|---|
| Commit with a message longer than one line | Write the message to a file, then `bash scripts/git-commit.sh <file>` |
| Commit with a one-line message | `git commit -m "…"` is fine — one line, one pair of quotes, no here-string |
| Write a file with any content | Use the editor / file-writing tool, never `echo`, `cat <<EOF` or `python -c` |
| Send a request body | `curl --data-binary @file` (also the only way UTF-8 survives on Windows) |

`scripts/git-commit.sh` exists so the message never touches a shell's quoting rules:

```bash
bash scripts/git-commit.sh /tmp/msg.txt          # any extra git args pass through
bash scripts/git-commit.sh /tmp/msg.txt --amend
```

## The gate

`.githooks/commit-msg` runs `pnpm check:commit-msg` on the message git is about to commit from,
after every quoting layer has had its say. It fires however the commit was made: a script, an IDE,
an assistant, either shell. It refuses:

- a first line that is nothing but shell quoting (`@`, `'@`, `"`, `EOF`, a lone backslash)
- a last line of the same kind, which is the closing half of the same mistake
- a non-blank line 2, which is what glues a body onto the subject
- an empty message, and the `Co-Authored-By` trailer this project does not use

It is structural, not stylistic. It does not judge tone, length (below a runaway threshold), mood or
wording — a gate that refuses the repo's own history gets bypassed, and then it protects nothing.
The first version of this one rejected a real 131-character subject and was corrected.

The validator is a pure function (`lintCommitMessage`) with unit tests in
`test/unit/commit-msg.test.ts`, so a new rule can be argued about against real examples.

## Why both

The script removes the failure. The hook catches it when someone does not use the script — which
will happen, because the shell is right there and `-m` is shorter. Neither alone is enough: a
convenience nobody is obliged to use is not a control, and a gate without an easy correct path
teaches people to work around it.
