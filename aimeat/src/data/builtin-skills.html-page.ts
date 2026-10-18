/**
 * @file src/data/builtin-skills.html-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-html-page` built-in skill: how an AI makes an HTML page in a workspace (a
 *   presentation, a report with charts, a page with pictures and a little interaction), shares it and
 *   hands out its link, in three calls, and the rules a page follows to work in its isolated frame.
 *   wish-kevyet-html-esitykset-ilman-sovellusta-eristetty-html-sivu-j, brief doc-mvb4bmxr8eyg.
 *
 *   It must agree with services/html-page.ts (the value, the file names, the frame's policy and the
 *   version window), services/workspace-share.ts (the end dates and their default), the catalog
 *   entries of aimeat_workspace_write and aimeat_workspace_share, and the ready-made prompt in
 *   public/js/services/html-pages.js htmlPagePrompt, which gives an AI outside MCP the same rules.
 * @structure HTML_PAGE_SKILL_ENTRY
 * @usage import { HTML_PAGE_SKILL_ENTRY } from './builtin-skills.html-page.js';
 * @version-history
 *   v1.5.0 — 2026-10-18 — A first share without `access` gets the node's starting level; `share.access` says which (plan doc-mvcn6c7e4e5q, V5.5).
 *   v1.4.0 — 2026-10-18 — Sharing names `publish_request`: when the node asks the person first, the link
 *     opens on their approval and the agent hands over the `approve_url` (plan doc-mvcn6c7e4e5q, V4).
 *   v1.3.0 — 2026-10-17 — A share can be for the organisation's members only (access `organism`, plan V3.4).
 *   v1.2.0 — 2026-10-17 — `window_url`: the page alone in the whole browser window, and the strip's
 *     button that copies it.
 *   v1.1.0 — 2026-10-16 — "Say how the page was made": ai_provenance on the write, and when the
 *     shared page shows the AI label. A file its classification keeps back does not load. Full
 *     screen shows only the page, with the AI label at the bottom-left corner.
 *   v1.0.0 — 2026-10-16 — Initial.
 */
/** The shape of a BuiltinSkill, named here rather than imported so this file closes no import cycle
 *  with builtin-skills.ts, which imports it; the compiler checks the two agree where it is listed. */
type BuiltinSkillEntry = { name: string; skillMd: string; visibility?: 'members' | 'public' };

export const HTML_PAGE_SKILL_ENTRY: BuiltinSkillEntry = {
  name: 'aimeat-html-page',
  visibility: 'public',
  skillMd: `---
name: aimeat-html-page
description: How to make an HTML page in an AIMEAT workspace (a presentation, a report with charts, a page with pictures and some interaction), share it with people outside the organism and hand out its link, in three tool calls, and the rules a page follows to work in its isolated frame. Use when the person wants a presentation, slides, a visual report or an interactive page they can show or send, and an app would be more than the job needs.
license: MIT
metadata:
  audience: agent
---

# HTML pages: a presentation without building an app

## What it is

An HTML page is a page of a workspace's document space, beside the Markdown pages. It holds one
whole HTML document. The node shows it in a frame that is isolated from everything else: the page's
script runs, but it has no network, no storage that outlives the tab, and no way to reach the
person's account or anybody else's. It is shared like any page: with the workspace's members, or
with a link (anyone, signed-in people, only the organisation's members, or a password). The node writes the page's text into the
page itself, so search and every AI that reads the workspace read it as text.

Choose it when the person wants something to SHOW: slides, a one-off presentation, a report with a
chart, a page with pictures. Choose something else when:

- the page needs sign-in, the person's own data, or AI calls: that is an app (\`aimeat_app_publish\`);
- it is text the group edits together: a Markdown page;
- it is a training deck run again and again, with timers, speaker notes and participants' answers:
  the Atelier deck.

## Three calls

1. **Write it** into a document space: \`aimeat_workspace_write\` with \`space\` and
   \`value: { title, html, files? }\`. The answer names the page's \`id\`. Writing again with the same
   \`id\` replaces the draft.
2. **Publish it**: \`aimeat_workspace_publish\` with the space's \`namespace\` and the \`id\`. Only
   published pages are ever shown outside. A page keeps its last five versions.
3. **Share it**: \`aimeat_workspace_share\` with \`space\`, \`id\` and \`shared: true\` (and \`access\` when the
   person wants a password, signed-in readers only (\`account\`), or the organisation's members only
   (\`organism\`)). A workspace shared for the first time without \`access\` gets the level this node
   gives a first share: anyone with the link unless the operator chose otherwise. The answer's
   \`share.access\` says which, so pass \`access: "open"\` when the person wants anyone to read it.
   Give the person the \`viewer_url\` from the
   answer. A link to an HTML page ends after 90 days unless you pass \`until\` (an ISO date, or "none");
   say so, and when it ends (\`ends_at\`). The answer also carries \`window_url\`: the same page alone
   in the whole browser window, with only its AI label at the bottom-left. Give that one when the
   person wants the page to fill the screen, for a presentation or a page to post. When the answer
   also carries \`publish_request\`, the node asks the person before anything opens to anyone with the
   link: the link works once they approve, so give them its \`approve_url\` as well.

Find a document space first with \`aimeat_workspace_read\` (the index lists the spaces and their
pages). Only the workspace's creator or an organism admin, or their own agent, may share. To stop
sharing: \`aimeat_workspace_share\` with \`shared: false\`.

**Say how the page was made.** Pass \`ai_provenance\` on the write (\`level\`, your own \`model\`, and
\`human_involvement\` only if the person read the substance and could reject it). Silence is recorded
as model-written. A page shared on an open link then shows the EU AI label in the strip around its
frame, as the law asks; behind a password or for signed-in readers only it owes none.

## The rules a page follows

The frame is strict on purpose. A page that breaks a rule does not break the node; it just shows
less than the person expected. So write it this way:

- **One complete HTML document.** CSS and JavaScript inline, in \`<style>\` and \`<script>\`.
- **No network.** \`fetch\`, XMLHttpRequest, WebSocket, a form that submits and an \`<iframe>\` all reach
  nothing. Put every number and every line the page needs into the page.
- **Libraries only from https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net or https://unpkg.com**,
  and fonts from Google Fonts. Pin a version.
- **Pictures** inline (a \`data:\` URL or an \`<svg>\`), or by file name: upload each with
  \`aimeat_storage_upload\` (presigned for anything over a kilobyte), then map the name the page uses
  to the upload's \`embed_url\` in \`files\`, for example \`{ "kaavio.png": "/v1/pub/…/kaavio.png" }\`, and
  write \`<img src="kaavio.png">\`. A name is letters, digits, \`.\`, \`-\` and \`_\`, in segments split by
  \`/\`. Up to 50 files. Pictures from any other address do not load, and neither does a file whose
  classification keeps it from the reader or, on a shared page, inside the organism.
- **localStorage and cookies work, and are forgotten when the page closes.** Never keep anything a
  reader needs only there.
- **Links** to a source open in a new tab after the reader confirms the address. \`window.open\` and
  \`target="_top"\` do nothing else. A link inside the page (\`#section\`) works as usual.
- **Size:** the HTML at most 1 MB. Big pictures go into files, not inline.
- **Phone and wide screen.** A presentation takes the arrow keys and a visible next button.

## What the reader sees

The page in its frame, under a strip the page cannot draw over: a line that a user made the page,
the AI label when one is owed, Full screen, a button that copies the page-alone link
(\`window_url\`), and Report. That strip is why a page cannot pass itself off as the node's own
sign-in. Full screen and the page-alone link show only the page, with the AI label at the
bottom-left corner as on an app; the reader leaves full screen with Esc. On a node without a page host the reader sees the page's text instead; tell the person that the
node's operator can turn the page host on.

## Keeping it current

The workspace index marks each page with \`kind: "html"\`, the day it was last opened
(\`last_opened\`) and \`stale: true\` when nobody opened or changed it for six months. Offer to archive a
stale page (\`aimeat_organism_archive\` with the level \`record\`), and to extend a link that is about
to end. The person decides.

## A person whose AI cannot connect

The "+ HTML page" dialog in the workspace carries a ready-made prompt with these same rules. They run
it in any AI chat, paste the answer, and save. Point them there.
`,
};
