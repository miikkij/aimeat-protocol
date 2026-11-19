/**
 * @file src/services/builder/atelier-other-owners.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier platform section `other-owners`: an app whose shared data people of
 *   other accounts, and those people's own AI agents, read and write. Served as
 *   `build-app-atelier/other-owners` beside the other platform sections (atelier-platform.ts).
 *
 *   WHY. An app built for one person and their own organism works on the first version. On
 *   2026-11-13 an app of that kind, a shared situation room where two people's agents log sessions
 *   and checks, took five published versions before both people and both people's agents saw the
 *   same thing. None of the causes was a node defect. Each was a rule that sits in a different part
 *   of the node and that no build text put in one place: the invitation waits for the person, the
 *   row space opens to an app only when it names the app, `session.fetch` answers an error instead
 *   of throwing, the `memory` live domain never reaches another account, a fenced space still lets
 *   an agent holding `organism:direct` write directly, and a log has no place for a proposal or a
 *   question to one person. This section is those rules, in the order a build meets them, and the
 *   two-account check that would have found all of them on the first version.
 *
 *   EVERY CLAIM WAS READ FROM THE CODE THAT ENFORCES IT: the invitation accept (routes/organisms/
 *   membership.ts, in person only), the direct add (POST /v1/organisms/:id/members), agent admission
 *   (services/organism/agent-access.ts), the fence and `organism:direct` (services/fenced-space.ts),
 *   the row space's app list (services/workspace-rows/row-service.ts authorizeApp), the workspace
 *   and extension live domains (services/event-bus.ts emitWorkspaceChange, services/extension-live/
 *   changed.ts), and the members-only refusal page (public/views/app-open.js).
 * @structure OTHER_OWNERS_SECTION · OTHER_OWNERS_POINTER
 * @usage if (id === 'other-owners') return { id, text: OTHER_OWNERS_SECTION };
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */

/** The section text. English, as every build text is; `##` because the Atelier text is cut at `## `. */
export const OTHER_OWNERS_SECTION = '## Other people\'s accounts and their AI agents use the app\n'
  + 'Read this when people of OTHER accounts use the app\'s shared data, and above all when their own AI agents read and write it: a situation room, a shared project floor, a log several people\'s agents keep. '
  + 'An app for one person and their own organism works on the first try. This shape did not: one such app needed five published versions before both people and both people\'s agents saw the same thing, '
  + 'and every round was one of the rules below. Decide each one before the first publish, and run the check at the end before you call the app done.\n\n'
  + '**1. Who is in, and how they get in.** The shared data lives in an organism workspace (sections `group` and `row-spaces`), and the app is opened to that organism\'s members (`open_to`). '
  + 'An invitation (`aimeat_organism_invite`, or by e-mail) is accepted by the invited PERSON, signed in themselves: no agent accepts it for them, and until they do, the app refuses them. '
  + 'The refusal page tells them an invitation waits; tell the person who invites the same, in one sentence. When they have agreed already, the organism\'s creator or an admin adds them at once instead (`aimeat_organism_member_add`). '
  + 'Then their agents: an organism admits all of its members\' agents (`agent_access: "all"`) or only the listed ones (`"listed"`, attached with `aimeat_organism_agent_attach`). '
  + 'Agents of a member write in that member\'s name, so decide which ones, and say on the app\'s help page how a member brings an agent in.\n\n'
  + '**2. Agents write through the app\'s own tools, from the first version.** A workspace write tool checks the schema and nothing else: another account\'s agent writes whatever its model typed. '
  + 'Put every write an agent makes behind an extension action that checks it (skill `node:aimeat-extension-builder`), publish those actions as the app\'s tools (`aimeat_app_tools_publish`), '
  + 'and FENCE the spaces they write: the space\'s object type names the extension (`"extensions": ["<installer>/<extension>"]`), and the node then refuses an agent\'s write that does not come through it. '
  + 'The person in the app, signed in, still writes directly. An agent whose session holds `organism:direct` (or `*`, or `organism:*`) also writes past the fence: that is a permission its owner gave on purpose, so the fence is a rule for the agents that do not hold it, not a lock. '
  + 'The organism\'s member list says which admitted agent holds it (`writes_past_app_rules`): show it on the app\'s members view. '
  + 'An agent calls an app tool with `aimeat_app_tool_invoke`, which needs `ext:invoke` and `exchange:write`; the app\'s help page names both.\n\n'
  + '**3. The app reads what other accounts wrote, and shows a refusal.** A record space of the workspace is read by the app as any member reads it. A ROW space opens to the app only when the space names it (`"apps": ["<owner>/<filename>"]`) and the person approved `organism:rows`; '
  + 'otherwise the read answers 403. The other way is to read through the same extension (its cortex library), which also lets the extension shape what each member sees; the app then declares `ext:invoke` in `<meta name="aimeat-scopes">` from the start, or every call is refused. '
  + 'Either way, read `ok` on every answer (section `calling-the-node`): `session.fetch` returns an error envelope and does not throw, so a refusal you do not show looks exactly like an empty list, and a whole team then debugs data that was never missing.\n\n'
  + '**4. Live updates that reach the other account.** The `memory` domain never reaches another account, so a view of shared data that listens to it updates only for the person who wrote. '
  + 'Subscribe to the workspace\'s own domain: `AIMEAT.live.subscribe([\'workspace:\' + organismId + \'/\' + workspaceId], reload)`. It fires for every member when a record, a draft, a row or a delete in that workspace changes; an app grant needs `organism:read` to hear it. '
  + 'Data an extension serves has its own domain, `ext:<installer>/<extension>`, which fires when the extension calls `ctx.changed()`; without `owners` it tells only the caller\'s own account, so an extension of a shared space passes the members: `ctx.changed({ owners: [...] })`.\n\n'
  + '**5. A place for what is not a log line.** People\'s agents will propose, ask and decide, and with only a log they write a proposal as three log lines and a question as a direct message nobody sees. '
  + 'Give the workspace a space for each kind the app\'s work has: a proposal or a delivery with a state (proposed, in progress, done, accepted), a question addressed to ONE person that closes with their answer, a decision with who decided it in their own words. '
  + 'The log then says only that one of these happened. The section `group` has how to write the data map for them.\n\n'
  + '**6. The check before you call it done: two accounts, both agents.** Signed in as the first person, write one entry through the app; have the first person\'s agent write one through the app\'s tool. '
  + 'Then as the SECOND person, in another browser profile: the app opens, both entries are there, and an entry the second person\'s agent writes appears on the first person\'s open screen within a few seconds, without a reload. '
  + 'Every round of the app named above would have failed this check on its first version. Write in the app\'s development notes which two accounts and which agents you checked it with.\n';

/** The line the sections `group` and `row-spaces` end with, so a builder who reads one finds this one. */
export const OTHER_OWNERS_POINTER = '\nIf people of other accounts, or their own AI agents, read and write this data, read the section `other-owners` before you publish: '
  + 'who gets in and how, writes through the app\'s own tools behind a fence, reads that show a refusal, live updates that reach the other account, and the two-account check.\n';
