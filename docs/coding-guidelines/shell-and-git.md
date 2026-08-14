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

# Rewriting a file instead of editing it

Same family, different tool. `pathlib.Path.write_text` on Windows translates every `\n` to `\r\n`,
so a Python one-liner that reads a file, changes one line and writes it back changes every line.
On 2026-08-14 a 71-line change was committed as 1388 insertions and 1319 deletions; two earlier
commits carry the same churn, one of them 31,000 lines of it. The content was right in all three.
Nobody can review that.

**Use the editor tool for edits.** When a script really is the right instrument — the same small
change across ten files — read and write **bytes**:

```python
p.write_bytes(p.read_bytes().replace(b'old', b'new'))   # endings survive
p.write_text(p.read_text())                              # every line now CRLF
```

`pnpm check:line-endings` runs in the pre-commit hook. It compares what git says changed against
what changed with carriage returns at end of line ignored, and refuses a staged file where the gap
is large. A deliberate normalisation passes with `AIMEAT_ALLOW_EOL_CHURN=1`.

## Why not .gitattributes

The obvious answer is `* text=auto eol=lf`, and it is the wrong one here. **584 of this repo's 2864
tracked files are CRLF in their committed blobs**, and have been for years; nothing reads them
worse for it. Declaring `eol=lf` would mark all 584 modified in every working tree at once — every
parallel session's included — and land a renormalisation diff on top of whatever anyone had open,
to fix something that was not hurting anyone.

The mixed state is not the problem. A writer that flips a file wholesale is, and that is what the
gate catches. If the repo is ever normalised, it should be one deliberate commit on a quiet tree,
with the revision recorded in `.git-blame-ignore-revs`.
