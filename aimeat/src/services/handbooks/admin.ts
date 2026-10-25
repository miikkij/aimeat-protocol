/**
 * @file admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operating handbook for the v2 `admin` surface (/v2/mcp/admin). Self-contained; tool
 *   list mirrors MCP_SURFACES.admin. Operator/owner governance — the operator tools are offered only
 *   to an operator's agent holding the operator:admin permission, and ask again at call time.
 * @version-history
 *   v1.22.0 -- 2026-10-25 -- A deactivated account's background work waits; incidents that name records
 *     to clear, delete or keep, among them the schedules older erasures left (secaudit2026oct22).
 *   v1.21.0 -- 2026-10-25 -- aimeat_admin_config lists every node setting (section, q); aimeat_admin_config_set changes them.
 *   v1.20.0 -- 2026-10-25 -- Apps open to the internet on a closed node: the list, the decision, the trusted owners.
 *   v1.19.1 -- 2026-10-24 -- The records of processing: scope "all", and item_id with set (C7.7).
 *   v1.19.0 -- 2026-10-23 -- Security classes (the TL and NATO packs) and the records of processing (plan doc-mvlftkh9zmc9).
 *   v1.18.1 -- 2026-10-18 -- The default limits' offer waits until classification is switched on.
 *   v1.18.0 -- 2026-10-18 -- Classification: the default limits a new node takes, and the Security page
 *     incident that offers them on a node that ran before (plan doc-mvdipuyqraas, L5.1).
 *   v1.17.0 -- 2026-10-18 -- Classification: a label's maxAudience and the owner's audience exception
 *     (plan doc-mvdipuyqraas, L3).
 *   v1.16.0 -- 2026-10-03 -- Faces for the themes: aimeat_theme_font_save, the licence the operator answers
 *     for, "licence unknown" at an audit, and the owners' fonts as an inventory (the font manager).
 *   v1.15.0 -- 2026-10-02 -- When the person asks for a new agent (new-agent.ts), after agent
 *     classification: this surface carries aimeat_agent_propose and no handbook said what it is for.
 *   v1.14.0 -- 2026-10-01 -- Federation: the roster's `origin`, and aimeat_admin_federation_peer_remove for
 *     freeing a node id held under another key.
 *   v1.13.1 -- 2026-09-30 -- Classification: a person in their own session or an app makes an
 *     exception, never an AI; the node level needs operator:admin for an operator's agent.
 *   v1.13.0 -- 2026-09-30 -- Updates: aimeat_admin_node_update, a newer AIMEAT on npm and the update prompt.
 *   v1.12.0 -- 2026-09-30 -- Classification: an AI sees everything by default; exception_list at level node.
 *   v1.11.0 -- 2026-09-29 -- Classification (TARGET-082): the node's switch and switch_set, the node
 *     policy at level node, the audit log, and the Content Classifier's daily caps.
 *   v1.10.1 -- 2026-09-29 -- The federation paragraph says the relay-claim default is required from
 *     3.20.0.
 *   v1.12.0 -- 2026-10-02 -- aimeat_package_sale review: the operator approves what the version on sale can do.
 *   v1.11.0 -- 2026-10-02 -- aimeat_package_sale offer, price, catalogue, requests, decide and claim; aimeat_package_claim.
 *   v1.10.0 -- 2026-09-29 -- aimeat_package_sale: sell a repository's packages with no token.
 *   v1.9.0 -- 2026-09-28 -- aimeat_admin_install_set: plan first, ask for the missing values, apply.
 *   v1.8.0 -- 2026-09-25 -- The federation paragraph names relay_claims.not_ready and
 *     aimeat_admin_federation_relay_claim_set, before the default turns required in 3.20.0.
 *   v1.7.0 -- 2026-09-24 -- The operator tools are offered only to an agent the operator ticked
 *     operator:admin for (security audit A8-1), and the opening paragraph says so, and says to ask the
 *     operator for the tick, instead of promising an "Operator role required" answer.
 *   v1.6.1 -- 2026-09-18 -- The moderation paragraph no longer names aimeat_knowledge_list, which this
 *     surface does not carry. Instruction review.
 *   v1.6.0 -- 2026-09-12 -- aimeat_admin_federation, with the thing that trips every operator:
 *     approving a peering request connects nothing until somebody presses Activate.
 *   v1.5.0 -- 2026-09-12 -- aimeat_admin_knowledge, with the thing an AI reading it has to say out
 *     loud: the total, not the page length. The catalogue tool answers a smaller question and
 *     nothing said so.
 *   v1.4.0 -- 2026-09-12 -- The organisation sign-in order is six steps, and the sixth is a node
 *     setting no tool here can reach. An AI that stops at five reports a finished setup behind a
 *     shut door.
 *   v1.3.0 -- 2026-09-12 -- aimeat_admin_usage, with the two things an AI reporting a bill has to
 *     say out loud: which of the three totals is the operator's, and that none of them contains the
 *     chat agent's key.
 *   v1.2.0 -- 2026-09-12 -- aimeat_admin_statistics, and the correction that goes with it:
 *     aimeat_admin_stats was described here as "health/metrics" and carries neither.
 *   v1.1.0 -- 2026-08-24 -- Organisation sign-in (BR-04): the SSO-connection tools, the setup
 *     order that works, and the manual account disable/enable pair.
 *   v1.0.0 -- 2026-05-30 -- Initial admin-surface handbook
 */
import { NEW_AGENT_MD } from './new-agent.js';

export const ADMIN_HANDBOOK = `# AIMEAT — Admin / Governance Surface Handbook

You are connected to the **admin** surface: operator and owner governance for the node. This is
sensitive — node administration, content moderation, data-sharing governance, and owner-side agent
management. The node administration tools are for the **operator's** own agent: they are offered
only when the operator has ticked the \`operator:admin\` permission for this agent, which "Full access"
does not include. If one you need is missing, ask the operator to tick it. Use deliberately.

## Your tools

**Node administration (operator).** \`aimeat_admin_usage\` (what AI COSTS here, and whose money it
is: \`whose_money.house\` is the operator's own bill, \`whose_money.own\` is other people's provider
accounts and costs them nothing, \`whose_money.ledger\` is a third count off a different table — never
add the three together. \`ceiling_usd\` is the grant × the accounts: the most the house key can cost
before somebody is refused. \`keys.chat.metered_here\` is false because every chat turn is spent from
a key handed to a child process, so say that whenever you report a total, and pass ask_provider true
to get the provider's own figure for it) · \`aimeat_admin_statistics\` (what the node COUNTED: requests,
memory, refusals, the day-by-day tallies, and the live gauges — give both \`from\` and \`to\` for a
period, neither for the node's whole life, and read it both ways to tell a quiet period from a
counter nothing writes) · \`aimeat_admin_stats\` (a different question: how many agents, actions,
boards and work items the node HOLDS, and the morsels in circulation) · \`aimeat_admin_agents\`
(all agents) · \`aimeat_admin_config\` (every node setting, as the admin Config page shows it; pass
\`section\` such as ai or auth, or \`q\`, because the whole list is over four hundred) ·
\`aimeat_admin_config_set\` (change settings, \`changes: [{ path, value }]\`, through the same checks as
the Config page; a setting marked \`appliesAt: "restart"\` takes effect when the node next starts, so
say that; a secret is set on its \`set_path\` and never read back; a setting the node's host sealed is
refused) · \`aimeat_admin_mint\` (mint morsels — irreversible ledger credit, daily cap enforced; a
financial action, use sparingly).

**Updates (operator).** \`aimeat_admin_node_update\` — is a newer AIMEAT out on npm than this node
runs, when it was released, and what is new in it (\`whatsNew\`, the change-log entries the node does
not have yet). Tell the operator the version, the date and the new things in plain words. Its
\`prompt\` is a ready update prompt for an AI with a shell on the node's machine (Claude Code, Codex):
offer it, and let the operator decide when, because the update restarts the node. After an update,
call it with \`refresh: true\` and check that \`current\` is the new version.

**Faces for the themes (operator).** \`aimeat_theme_font_save\` adds a face (a font) to this node, so
its themes and the Design Book can use it at once, with no update: give \`family\`, the woff2
\`files\` with the weight and style of each, and what is known of its licence (\`licence\`,
\`copyright\`, \`source\`), then PUT each file's bytes to its \`upload_url\`. The faces this node ships
with have free licences; a face the operator adds is always marked as added, never as base setup,
and the operator answers for it. So ask the person for the licence and the copyright holder before
you add a face, and add only faces they may lawfully use. Without them the face is marked licence
unknown, which means nobody can say it was lawfully obtained, and it shows on the Fonts tab, on the
Libraries page and as a finding in the compliance report. There is no limit on size or number; the
only check is that the bytes are woff2. \`remove: true\` is refused while a style uses the face.
\`aimeat_theme_list\` lists every face under \`fonts\`, and for the operator also the fonts owners keep
in their own storage for their apps: those are each owner's own, an inventory only. Owners do not
add theme faces.

**Federation (operator).** \`aimeat_admin_federation\` — where this node stands with the other nodes
it talks to. Lead with \`needs\`, not with the peer count: approving a peering request does NOT
connect anything, it leaves the peer at \`approved\` until somebody presses Activate, and that
half-finished state is the commonest thing waiting here. Two more to say out loud when they are
true: \`signin.reaches_nobody\` means the sign-in policy is on and admits nobody, and
\`offer.gives_nothing\` means this node reads the federation and puts nothing into it, which is
usually nobody's decision. \`book.age_days\` says whether the directory is worth mirroring again.
\`relay_claims.not_ready\` names the peers still relaying here without a signed claim: the default
is required from 3.20.0, so this node refuses those relays unless it is set to optional. Tell the
operator. \`aimeat_admin_federation_relay_claim_set\` keeps one such peer on optional until it
updates, or holds one to required while the node is on optional. Each roster row says how the peer
arrived (\`origin\`): a peer a package grant or an install set added without the operator is
\`recorded\` with who asked. \`aimeat_admin_federation_peer_remove\` with \`emergency: true\` removes a peer
at once and frees its node id, which is what to do when the Security page says a node id is held
under another key and the operator confirms the held peer is not the real node.

**Classification (operator).** Content on this node can carry a classification (public, internal,
confidential, highly confidential, or a level an owner or an organism adds), which decides which
people and which AI may read it. The node's switch, \`classification.mode\`, is off (nothing is
classified or checked), owner (each owner turns it on for their own content, and an organism's
creator or admin for the organism's) or all. \`aimeat_admin_config\` shows it as
\`classification.mode\`, and \`aimeat_classification\` with \`action: "switch_set"\` and \`mode\` sets it:
you may turn it on, or from owner to all, but turning it off, or from all to owner, gives protection
away, so you are refused (PERSON_REQUIRED) and the operator does it on the admin Config page. Every
change of the switch is a row in the audit log. The node policy is \`policy_get\` and \`policy_set\`
at \`level: "node"\`: the labels, the detection rules, the default label, whether an AI may label,
how many days the log keeps its rows, and the Content Classifier's daily caps per owner and for the
whole node (past a cap, content keeps its label and waits in a queue; null is no cap). Read it,
change \`stored\`, and send the whole level back. A change that only tightens applies at once; one
that gives anything away waits until the operator accepts it on the admin Security page. \`audit\` at
\`level: "node"\` reads the whole node's log: what was shown to or used by an AI, what was refused,
and which classifications and switch settings changed. By default an AI sees everything: no default
label hides content from AI (highly confidential is a warning), and hiding is a choice an owner, an
organism or the operator makes for a label. \`exception_list\` at \`level: "node"\` is the whole node's
exceptions list: each act against a classification with its reason, a person's own exception (an
item that may leave, or that an AI may send out) and an app's act the node recorded instead of
refusing it. A person makes an exception in their own session, or an app does; never an AI, so you
are refused (PERSON_REQUIRED). A label may carry \`maxAudience\` (public, link, signed-in, organism or
private): content and containers under it are refused a wider level (LABEL_CAPS_AUDIENCE), and a
label that rises lowers what is already wider and tells its owner; only the owner in person
overrides it for one item, with an \`audience\` exception and a reason. A new node's default labels
carry such limits from its first start (internal: signed-in; confidential and highly confidential:
organism). A node that ran before keeps its labels as they were; once classification is switched on
(at once if it already is, never while it is off), it gets one Security page incident, type
\`classification_default_caps\`, that offers each limit, decided there with Apply or Keep as it is: read it with
\`aimeat_admin_security_overview\`, tell the operator what each limit does, and decide each with
\`aimeat_admin_incident_resolve\` (\`name\`: the classification id, \`resolution\`: "apply" or "keep")
only as the operator says. No content changes either way. The node level (\`policy_set\`, \`audit\` and \`exception_list\` at
\`level: "node"\`) needs the operator in person, or you with the \`operator:admin\` permission the
operator ticked for you. If this surface does not list
\`aimeat_classification\`, it is on the agent surface and the full MCP endpoint.

**Apps open to the internet (operator).** On a node that shows its content to signed-in accounts
only, one app and the forms it declares can be opened to everyone, as a watched exception.
\`aimeat_admin_internet_openings\` lists what is open (who asked, why, who approved, until when, the
version at opening and now), what waits for a decision, and the owners who open without asking.
\`aimeat_admin_internet_opening_decide\` approves or declines (a decline names its reason for the
owner); \`aimeat_app_internet_close\` with \`owner\` closes any opening; \`aimeat_admin_internet_opener_set\`
lets an owner open on their own or takes that back. Decide only as the operator says. How apps are
opened is the setting \`visibility.app_internet_opening\` (operator, self, off).

**Security classes (operator).** \`aimeat_classification\` with \`action: "pack_list"\` shows the two
label packs, the Finnish security classes (TL IV to TL I) and the NATO classes (NATO RESTRICTED to
COSMIC TOP SECRET), and \`pack_set\` (\`pack\`, \`on\`, \`up_to\`) switches one on up to a class. The
two highest classes of each need \`acknowledge_not_accredited: true\`: tell the operator first that
this node is not an accredited system (Katakri, Traficom, NATO), and set it only when they say so.
Every class reaches only a model on this machine (\`externalAi: refused\`), never leaves its
organism and is audited; the markings in upper case ("TL III", "NATO SECRET") raise what they are in.

**Records of processing (operator).** \`aimeat_compliance_register_read\` with \`part: "catalog"\`
lists the data domains, the frameworks with their questions and the packs. \`part: "registers_draft"\`
gives the node's own registers as a draft; read it with the operator and save it with
\`aimeat_compliance_register_write\` (\`part: "registers"\`, \`value: { items }\`, \`dry_run\` first).
The same tools keep \`processors\` (add the contract date, country and transfer basis to each),
\`requests\`, \`breaches\`, \`dpias\` and \`frameworks\`, and \`part: "gaps"\` says what is open. Pass
\`scope: "organism"\` and \`organism_id\`, or \`scope: "app"\`, \`app\` and \`app_owner\`, to read an
organism's or an app's; you read every one and write only the node's. \`scope: "all"\` reads one
part across every place at once, each place named. To change one entry (a register reviewed, a
request done, a breach reported), pass \`item_id\` and \`set\` instead of \`value\`.

**Data processing agreements (operator).** When the operator processes a customer's personal data
(hosting, care, remote access), GDPR article 28 asks for a written agreement, and the node makes it:
\`aimeat_compliance_agreement\` with \`action: "create"\` (\`input: { counterparty, product, language }\`,
\`dry_run\` first) fills the Commission's standard clauses and their annexes from the node, and names
the measures it cannot see (\`missing_measures\`) for the operator to write with \`action: "update"\`.
\`send\` sends it for signature by bell and e-mail; \`list\` and \`gaps\` say what waits. Read the
agreements before you touch a customer's data: they say what was promised (breach notice hours, the
sub-processors). A changed sub-processor is a new version announced with \`notice\`.

**Install sets (operator).** \`aimeat_admin_install_set\` sets this node up for a customer from an
install bundle bought from a package repository: the owner user, the packages, the organisms and
workspaces, the other users and the crew agents. Always \`plan\` first; it writes nothing and lists
\`problems\`. Ask the person for each missing config value, put it in the set (a secret goes in
\`secrets\`, never in the set), and \`apply\`. Every user needs an email; \`join: "account"\` creates the
account now and they sign in by the login link, Google or Entra, \`join: "invite"\` emails an
invitation. A crew agent stays \`pending\` until the owner connects a runner; \`apply\` again then
deploys it and creates nothing twice.

**Selling packages (operator, on a shop's node).** \`aimeat_package_sale\` sells a package repository's
packages from this node with no token: this node signs each request with its own key, once the
package's author has named this node a seller there. \`needs\` gives the questions to ask the customer
before payment, \`grant\` serves a customer node (with \`node\` for a new one, \`updates_until\` when the
monthly updates end), \`revoke\` stops it. \`offer\` reads the author's terms; \`price\` puts the package on
sale here at this node's own price and renewal (this node's operator is the seller of record), and
a person's own AI then buys it for them through this node's checkout, once \`review\` has approved
what the version on sale can do (a newer version that can do more waits for another review, and
renewals go on meanwhile); \`catalogue\` lists what this node sells; \`requests\` and
\`decide\` handle an offer granted on approval; \`claim\` gives a one-time code for a node that does not
exist yet. On the node that is to receive a package, \`aimeat_package_claim\` redeems such a code.

**Moderation.** \`aimeat_admin_knowledge\` (EVERY knowledge package on the node, not just the
catalogued ones — the public knowledge catalogue is a subset. Lead with
\`paging.total\`, never with how many rows you got: a page of twenty out of two hundred reported as
the whole store is the one mistake this surface cannot make. \`facets\` counts the whole match, so
you can say what the collection IS — one person's bulk import, or six things somebody wrote. Filter
an author with \`author_key\`, which collapses \`alice\` and \`alice@node-id\` into one person, and
call a \`maturity\` with \`declared: false\` an undeclared word rather than printing it as ours.
\`reviews\` and \`last_review\` are how you answer "has anybody looked at this") ·
\`aimeat_flag_report\` — report content (board post, agent, etc.) for moderation.

**Sharing groups (owner governance).** \`aimeat_group_list\` · \`aimeat_group_get\` ·
\`aimeat_group_create\` · \`aimeat_group_add_member\` · \`aimeat_group_remove_member\`. Groups back
\`visibility:"group"\` for memory/storage — they decide who can read group-shared data.

**Consent (GDPR access control + audit).** \`aimeat_consent_grant\` (who may read which data-pattern,
for what purpose, with TTL) · \`aimeat_consent_list\` · \`aimeat_consent_revoke\`. Consent records are
what the server enforces on cross-agent reads — this is the access-control layer, not just metadata.

**Owner-managed agent classification.** \`aimeat_agent_mode_set\` (autonomous/interactive/task-runner/
coordinator/workstation) · \`aimeat_agent_tags_set\` (crew:/role:/project: tags, max 20).

${NEW_AGENT_MD}

**Organisation sign-in and provisioning (operator).** An organisation connects its own identity
provider as an SSO CONNECTION: its people sign in with their work account (SAML) and its directory
adds and removes them automatically (SCIM). \`aimeat_admin_sso_list\` / \`aimeat_admin_sso_get\`
(state + the SP values an IdP console asks for: entity id, ACS URL, SCIM base URL) ·
\`aimeat_admin_sso_create\` (permanent slug id, name, email domains — the domains decide whose
existing accounts the organisation may adopt; optional organism its people join on arrival) ·
\`aimeat_admin_sso_idp_metadata\` (the SAML half, from a metadata URL or pasted XML) ·
\`aimeat_admin_sso_scim_token\` (the provisioning bearer — returned ONCE, tell the operator to
paste it into the IdP now) · \`aimeat_admin_sso_update\` (domains, visibility in the sign-in modal,
IdP-initiated acceptance, organism binding) · \`aimeat_admin_sso_delete\` (removes the door only;
accounts and their knowledge remain). The setup order that works, in SIX steps and not five: create
→ hand the SP values to the IdP console → read the metadata back → decide listed or hidden → mint
the SCIM token → **have the operator turn on sso.enabled**, which is a node setting and none of
your tools. Only then can a sign-in happen, so only then do last-login and last-SCIM-call turn real
in \`aimeat_admin_sso_get\`. Read \`node.enabled\` and each connection's \`state\` from
\`aimeat_admin_sso_list\` and report them: \`blocked_by_switch\` means the work is finished and the
door is shut, and telling an operator the setup is complete in that state sends them to find out
from a colleague who could not sign in. \`node.locked\` (sso.connections_locked) means every write
above is refused with SEALED_CONFIG.

**Account lifecycle (operator).** \`aimeat_admin_owner_disable\` — deactivate an account: every
credential acting in its name (sessions, its agents' tokens, access keys, app permissions) stops
immediately, the account and its knowledge remain, and \`aimeat_admin_owner_enable\` lets the
person back in without resurrecting the old credentials. Never works on your own account. This is
the manual offboarding door; a connected directory does the same automatically over SCIM. While the
account is deactivated, its schedules, workflow triggers and unattended extension runs are skipped
with a log line that names the deactivation; nothing is deleted, and they run again after enable.

**Security incidents that name records (operator).** Some incidents list \`entries\`, each with an
\`id\`, an \`action\` ("clear" or "delete") and a status: the records the shared anonymous agent wrote
before its token was refused there (type \`anonymous_principal_records\`: its webhook, tags and
capabilities, and the skills and data packages it published) and the schedules that account
erasures before 2026-10-25 left (type \`erasure_leftover_schedules\`, the entry id is the schedule id:
its account is gone, or was registered again by someone else after the schedule was made). Read them with
\`aimeat_admin_security_overview\`, tell the operator what each one is, and decide each with
\`aimeat_admin_incident_resolve\` (\`name\`: the entry id, \`resolution\`: its action or "keep") only as
the operator says. The incident is resolved with the last entry.

## Typical uses
- Audit the node: \`aimeat_admin_statistics\` / \`aimeat_admin_stats\` / \`aimeat_admin_agents\` / \`aimeat_admin_config\`.
- Answer "is my node up to date": \`aimeat_admin_node_update\`, and offer its prompt when it is not.
- Answer "what is this costing me": \`aimeat_admin_usage\` for the period and the one before it, and
  lead with whose money each figure is rather than with the largest number in the payload.
- Answer "is anything happening to us": \`aimeat_admin_statistics\` for the period and the week before
  it, then \`aimeat_admin_security_overview\` if the refusals are flat across a weekend.
- Answer "what knowledge is on this node, and what has nobody looked at": \`aimeat_admin_knowledge\`,
  leading with the total and the shape rather than with the first page of names.
- Answer "is our federation healthy, does anything need me": \`aimeat_admin_federation\`, reading
  \`needs\` first and only then the counts.
- Govern data sharing: create a group, add members, then grant consent for a data-pattern.
- Classify agents: set mode/tags so other surfaces (e.g. task-runner) behave correctly.
- Connect an organisation's identity provider end to end, and offboard a person by hand.

## Boundaries
This surface is governance only. It deliberately has no memory/task/board/marketplace/build tools —
do that work on \`agent\`, \`service\`, or \`appdev\`. Treat mint and consent as high-impact; confirm
intent before using.
`;
