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
| Change part of an existing file | Use the editing tool, never `sed -i`, `perl -pi` or a rewrite-in-place script |
| Read or search a file | The shell is the right tool: `cat`, `head`, `sed -n`, `grep`, `find` |
| Send a request body | `curl --data-binary @file` (also the only way UTF-8 survives on Windows) |

The reading half and the writing half are not the same question. Reading through the shell is
cheap and reversible; `sed -n '40,80p'` that lands on the wrong lines shows you the wrong lines and
you notice. Writing through it is neither. `sed -i` with a pattern that matches twice edits both,
matches zero times and edits nothing, or matches inside a string literal — and all three exit 0.
The editing tool refuses when its anchor is not unique or not found, which converts the same
mistake into a message on the spot.

An assistant working here may be told by its own harness to prefer the shell for edits, because in
bypass-permissions mode Bash prompts less. That instruction also says to fall back to a dedicated
tool when the shell cannot do the job. On a source file in this repo it cannot, for the reasons
above, and the fallback is the default rather than the exception.

A bulk edit across many files is the one case that earns a script, and the rules for writing one are
in *Rewriting a file instead of editing it* below.

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

Same family, different tool. `pathlib.Path.write_text` on Windows translates every newline to a
carriage return plus newline, so a Python one-liner that reads a file, changes one line and writes
it back changes every line in it.
On 2026-08-14 a 71-line change was committed as 1388 insertions and 1319 deletions, and a 394-line
change as 31,678. The content was right in all of them. Nobody can review that.

**This can no longer reach the repository.** `.gitattributes` declares `* text=auto eol=lf`, so git
normalises on `git add` whatever the file looks like on disk: a tool that writes CRLF produces no
diff at all. The repo was normalised in one commit on 2026-08-14 (599 files, 158,498 lines, zero
content changes), and that revision is listed in `.git-blame-ignore-revs` so it does not shadow
`git blame`.

Two exceptions are declared rather than detected: `*.bat` and `*.cmd` stay CRLF because Windows
shells want them that way, and the binary extensions are named explicitly instead of trusting a
heuristic, because a false "text" guess corrupts a file on checkout.

**Still prefer the editor tool for edits.** The endings are handled now, but a script that rewrites
a whole file still risks everything else about it, and `write_bytes(read_bytes()...)` costs nothing:

```python
p.write_bytes(p.read_bytes().replace(b'old', b'new'))
```
