/**
 * @file sdk-intake-connect.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entries of aimeat-intake.js (the public form: a visitor with no account
 *   submits one record into a workspace, and the owner defines the form) and aimeat-connect.js (a
 *   person's own accounts at outside services: connect, publish, and what each provider can do).
 *   Both libraries were served for months with no entry here, so GET /v1/libs, the build prompt and
 *   llms-full.txt never named them, and apps wrote the same form renderer and the same
 *   /v1/connections calls by hand. Its own file because library-packs/sdk.ts is near the line
 *   ceiling; placed in SDK_PACKS after aimeat-webhook, the other library that reaches outside.
 * @structure INTAKE_CONNECT_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 - 2026-10-01 - Initial: aimeat-intake (with fields() and the refusal's field) and
 *     aimeat-connect (with capabilities()).
 */
import type { LibraryPack } from './types.js';

export const INTAKE_CONNECT_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-intake',
    kind: 'sdk',
    category: 'core',
    title: 'Public forms (submissions without an account)',
    description: 'A form anyone can fill in without signing in (contact, lead, feedback, RSVP, questionnaire): the visitor submits one record into a workspace, the owner defines the form and its fields, and the node screens bots, limits the rate and checks the schema',
    url: '/v1/libs/aimeat-intake.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-intake.js"></script>'],
    requires: [],
    license: 'MIT',
    apiSurface: 'AIMEAT.intake',
    aiDoc: 'USE IT when a person with no account must send something into a workspace: a contact or lead form, feedback, an RSVP, a questionnaire. It is the ONLY write a visitor without a session can make. The visitor side needs no other library; the owner side needs aimeat-auth loaded first. THE VISITOR (no session): const form = await AIMEAT.intake.getForm(org, ws, formId) answers { form_id, title, fields: [{ key, label, type, required }], honeypot_field, success_message, redirect_url }; a missing or disabled form throws with err.code "NOT_FOUND". DRAW THE FIELDS FROM AIMEAT.intake.fields(form), which answers [{ name, label, type, required, options?, maxLength? }] in the form\'s order and leaves the honeypot out: type is one of text, textarea, email, tel, url, number, date, select, radio, checkbox, and any other type is text; options ([{ value, label }]) is on select and radio only, and a choice field without options comes back as text (the public descriptor carries the options and maxLength of each field, so a select read through getForm keeps its choices); maxLength is on the free-text types, the form\'s own limit or the node limit of 8000 characters. fields() also reads the definition you pass to defineForm, an entry of listForms (one text field per allowed field) or a bare field list. THE HONEYPOT: when form.honeypot_field is set, add one input of that name that people cannot see or reach (tabindex -1, aria-hidden, autocomplete off) and submit its value as it is. A bot fills it; the node then answers success { ok: true, id: null } and writes nothing, so a filled honeypot looks like a sent form. SUBMIT: await AIMEAT.intake.submit(org, ws, formId, values) answers { ok: true, id, mode } with mode "publish" or "draft" ("draft" when the form says so or the organism\'s publish review gate is on). The node keeps only the form\'s allowed fields and drops the rest, adds the form\'s defaults, strips control characters, and validates the record against the workspace\'s locked schema. THE REFUSAL is a thrown Error with err.code, err.message, err.details, err.status (HTTP) and err.field (the field it concerns, when the node names one): MISSING_FIELD (400, a required field is empty), INVALID_INPUT (400, a value over 8000 characters or more than 60 fields), SCHEMA_VALIDATION_FAILED (422, err.details is the list of violations [{ path, message, schema_rule, params }]), UNDECLARED_SPACE (422, the form\'s destination is no longer declared), RATE_LIMITED (429, 20 submissions per 15 minutes from one address), NOT_FOUND (404). Mark err.field on the form when it is set, and show the message otherwise. THE OWNER (signed in, the workspace creator or an organism admin, scope organism:write): await AIMEAT.intake.defineForm({ organism_id, ws, namespace, allowed_fields, required_fields, form_id, title, fields: [{ key, label, type, required }], defaults, mode: "publish" | "draft", honeypot_field, enabled, success_message, redirect_url }) answers { form_id, submit_url, discoverable, enabled, mode }. form_id is a slug of a-z, 0-9 and "-"; leave it out and the node makes an unguessable frm_ id, a private link (discoverable false). defaults are written into every record, and the values "{{now}}", "{{today}}" and "{{uuid}}" are filled in at each submission. The namespace must be a space the workspace declares, and its locked schema must list "id", every allowed field and every default, or defineForm throws (INTAKE_SCHEMA_MISMATCH names the missing properties). Defining a form id again updates it. AIMEAT.intake.listForms(org, ws) answers [{ form_id, namespace, mode, enabled, discoverable, title, allowed_fields, submit_url }], and AIMEAT.intake.deleteForm(org, ws, formId) answers { deleted } and stops the public link at once. The owner methods throw an Error with the node\'s message. A submission is a normal workspace record owned by the form owner, so the app reads and counts them as it reads any record of that space; the visitor never reads anything back.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['contact form', 'lead form', 'feedback form', 'rsvp', 'questionnaire', 'survey', 'sign-up form', 'public form', 'without an account', 'lomake', 'yhteydenotto', 'palaute', 'ilmoittautuminen', 'kysely', 'formulario', 'encuesta'],
    sizeEstimate: '~5KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'core',
    promptLine: '- aimeat-intake.js — a public form a visitor fills in WITHOUT an account (`AIMEAT.intake`): getForm(org, ws, formId), draw fields(form) plus a hidden input named form.honeypot_field, submit(org, ws, formId, values), and mark err.field on a refusal. The owner defines the form with defineForm({ organism_id, ws, namespace, allowed_fields, … }) (needs aimeat-auth).',
  },
  {
    id: 'aimeat-connect',
    kind: 'sdk',
    category: 'core',
    title: 'Connected accounts (outside services)',
    description: 'A person\'s own accounts at outside services (Mastodon, Bluesky, LinkedIn, X, YouTube, Gmail, Outlook): connect and disconnect them, see what each provider can do, publish to one and read back how it did, with the credential kept on the node and never on the page',
    url: '/v1/libs/aimeat-connect.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-connect.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.connect',
    aiDoc: 'USE IT when the app publishes to, or shows, the person\'s own accounts at outside services. THE PAGE NEVER HOLDS A TOKEN: the node keeps the credential and the app sees provider, accountLabel and status. PROVIDERS: await AIMEAT.connect.providers() answers [{ id, label, instanceScoped, credentialShape, capabilities, attachFields, nodeConfigured }]; the ids include mastodon, bluesky, linkedin, x, youtube, google-mail, google-mail-send, microsoft-mail, microsoft-mail-send, and the list holds only what this node offers. nodeConfigured false means the node has no app of its own there, and the person can still register their own with AIMEAT.connect.setClient(provider, clientId, clientSecret) (clients() lists theirs, removeClient(provider) removes one and is refused while an account depends on it). WHAT A PROVIDER CAN DO: await AIMEAT.connect.capabilities(x), where x is a provider id, an entry of providers() or a connection from list(), answers { provider, readMail, sendMail, publish, publishPost, publishVideo, readMetrics, readItems, names }. NEVER DECIDE IT FROM THE PROVIDER NAME: google-mail reads mail and google-mail-send sends it, so a match on "mail" picks the wrong account. ACCOUNTS: await AIMEAT.connect.list() answers [{ id, provider, mode, accountLabel, status }] with status "active", "needs_reauth" or "revoked"; show needs_reauth as a Reconnect button (start(provider) again), not as an error. CONNECT: await AIMEAT.connect.start(provider, { instance, mode, signal }) from a click (it opens the provider window, and a browser blocks a window that no click opened); instance is required where instanceScoped is true (Mastodon: "mastodon.social"); it answers { connected, connection } after the round ends, and connected false means the person cancelled or did not finish within three minutes. A provider with attachFields (Bluesky: an app password) has no window: AIMEAT.connect.attach(provider, fields) instead. Before either, show AIMEAT.connect.notes[provider] ({ needs, before, where }): what the person must know first. DISCONNECT: AIMEAT.connect.revoke(connectionId) answers { revoked, toldProvider }. PUBLISH: await AIMEAT.connect.publish({ connectionId, caption, storageKey, params }) answers { url, replay, status, attemptId, error }. Read status: "held" (awaiting moderation) and "queued" (the provider allowance is spent) are not errors and not yet published. The same arguments twice post once and answer replay true with the first outcome. HISTORY: AIMEAT.connect.history({ limit }) is what was tried, newest first, each with latest (null when never measured); AIMEAT.connect.measure(attemptId) asks the provider for the numbers now and costs a provider request (money on X), so call it only from a click, never on a timer or on render; series(attemptId) is every reading. AIMEAT.connect.on(fn) tells of a change to the set of accounts and returns the unsubscribe. THE PANEL: await AIMEAT.connect.panel({ target: "#accounts", strings, styles }) mounts the ready-made accounts panel (rows with Reconnect and Disconnect, the provider notes, a Connect control) in the page\'s own colours (currentColor, aim-conn-* classes) and answers { refresh }. REFUSALS throw an Error with err.code and err.permanent (true for NOT_MEASURABLE and REJECTED: a retry cannot work, so offer none); CONNECTIONS_DISABLED means the node has accounts switched off. MAIL: this library neither reads nor sends mail. An app reads through REST POST /v1/connections/:id/read/:resource (scope connections:read-through); sending has no REST route, and an agent sends with the MCP tool aimeat_mail_send. SCOPES: connections:read or connections:use to list and read history, connections:use to publish and measure, connections:write to connect, attach, revoke and register an app.',
    changelog: [],
    tierHint: 'T1',
    interviewTriggers: ['publish to', 'post to mastodon', 'bluesky', 'linkedin', 'youtube', 'social media', 'connected accounts', 'cross-post', 'gmail', 'outlook', 'mail account', 'somejulkaisu', 'julkaise someen', 'tilit', 'redes sociales', 'publicar en'],
    sizeEstimate: '~11KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'core',
    promptLine: '- aimeat-connect.js — the person\'s own accounts at outside services (`AIMEAT.connect`): list(), providers(), capabilities(providerOrConnection) for what each can do (never match on the provider name), start(provider) from a click, publish({ connectionId, caption }) and read its status, panel({ target }) for the ready-made accounts panel. The token stays on the node. Requires aimeat-auth.',
  },
];
