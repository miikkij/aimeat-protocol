---
name: aimeat-pages-links
description: How to build a link to a document or record in AIMEAT Pages, and when to give the public viewer link instead. Use whenever you are about to hand Jouni or anyone else a link to a workspace document, a record, a handbook page or a development note.
---

# Linking to a page in AIMEAT Pages

**Do not hand out a `/v1/profile?tab=organisms...` link and expect someone to click their way to a
document.** Pages takes a deep link straight to the item.

## The link

```
https://aimeat-pages.apps.aimeat.io/#org=<organismId>&ws=<wsId>&doc=<docId>
```

A record is the same shape with `record` instead of `doc`:

```
https://aimeat-pages.apps.aimeat.io/#org=<organismId>&ws=<wsId>&record=<recordId>
```

Worked example, the Handbook page "What is AIMEAT":

```
https://aimeat-pages.apps.aimeat.io/#org=fbb51de5-56d5-4143-9871-b998a1187655&ws=ws-mq6653ry24h&doc=hb-overview
```

## The rules the app enforces

- The parameters are `org`, `ws`, `doc`, `record`. At least one must be present or the fragment is
  ignored entirely.
- **No space name is needed.** The app searches every space in the workspace for the id.
- If both `doc` and `record` are given, `doc` wins.
- Values are URL-encoded. It makes no difference for ordinary ids and every difference for an
  organism name or anything with a special character in it.
- The fragment survives sign-in, so the link works for a member who is currently signed out.
- **The link needs membership.** If the organism is not on the recipient's list the app says
  "Linked organism is not in your list", and likewise for the workspace and the item.

## Where the ids come from

- `aimeat_organism_list` gives the organism id.
- `aimeat_workspace_list` gives the ws id.
- `aimeat_workspace_overview` gives document and record ids as a table, and
  `aimeat_organism_search` finds an id by text.

Fastest route with no tools at all: open the document in Pages and copy the address bar. The app
rewrites the hash to match the open view on every click.

## For someone outside

The link above does nothing for a person who is not a member. A publicly shared document has its own
address, the viewer:

```
https://aimeat.io/v1/publicworkspaceviewer?org=<org>&ws=<ws>&type=<spaceName>&id=<docId>
```

Here `type` IS the space name (`handbook`, `platformnote`, …), unlike the Pages link which does not
need it. Two preconditions, and the viewer 404s or refuses without either: the document is **shared**
from the Pages share modal, and it is **published** (only published versions reach the public link).
Its **classification** decides too, when classification is on: a document whose classification keeps
it inside its organism, or hides it from the reader, answers 404 on the viewer like one that is not
shared. The share's own access check (`account`, `password`) answers first, and the classification is
read only for a visitor that check lets in. When a shared, published document still 404s, read its
classification (`aimeat_classification` action `get`) before you look for anything else.

Pages' share modal offers both, as "Copy Pages link" and "Copy viewer link".

An **HTML page** (a document whose value holds `html`) uses the same viewer link. The viewer shows it
in a sandboxed frame served from the node's page host (pages.aimeat.io), and a shared HTML page
ends after 90 days unless its share names another end date.

## Turning sharing on when you have no browser

Use the MCP tool `aimeat_workspace_share` (all three agent surfaces since 2026-10-16): `organism_id`,
`ws`, `space` and `id` for one page (`space` alone for a whole space, neither for the workspace),
`shared: true`, and `access`. Its answer carries `viewer_url`, the link to hand out. `until` takes an
ISO date for the end of the share, or `"none"` to remove the end. Only the workspace creator, an
organism admin or their own agent may change sharing, and only published pages are shown.

Without MCP, the tool runs the same route:

```bash
# token: POST https://aimeat.io/v1/ghii/login with the owner credentials (docs/internal/TESTING.md or docs/internal/prod-login-*.json; both are gitignored and exist only in the MAIN checkout on the developer's main machine, never in a worktree, so ask the developer when they are absent)
curl -s -X PUT "https://aimeat.io/v1/organisms/<org>/workspace/share?ws=<ws>" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data-binary @share.json
# share.json: {"docs":{"<spaceName>/<docId>":true},"access":"account"}
```

The `docs` map is keyed **`spaceName/docId`**. `until` is a map of end dates keyed the same way
(`*` for the workspace, `space:<name>` for a space, `<spaceName>/<docId>` for a page), each an ISO
date or `null` to remove it. `access` is `open` (the internet), `account` (any
signed-in identity on this node), `organism` (the members of the workspace's own organism) or `password`. For anything developer-facing use `account`; `open`
puts it on the internet and posts a line to the node's public activity feed.

`GET` the same path to read the current state before changing it: the PUT merges, but `access` is
workspace-wide and you can clobber someone else's setting.

## LOOM target

```
https://loom.apps.aimeat.io/?target=TARGET-NNN
```

## One thing to check before repeating it

The instructions this skill came from say the app's `parseDeepLink` reads neither `share` nor
`space`, so the share modal's "Copy Pages link" (`#share=1&org=…&ws=…&space=…&doc=…`) behaves as an
ordinary deep link and still needs a sign-in. The app source carries a block labelled "no-login share
view (#share=1&…)", so that may have changed in a later version. When it matters, hand out the
viewer link, which is unambiguous either way.
