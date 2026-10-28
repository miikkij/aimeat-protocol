/**
 * @file src/models/write-body-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The body schemas of the writing routes the node's own forms send free text to, which
 *   checked their bodies by hand before: an organism created and updated, a workspace created, a
 *   comment, a contact saved and edited, and the person's own profile. Each route runs one through
 *   validateBody, so a too-long value, a control character or a value of the wrong kind is refused
 *   with a 400 whose details name the field (models/validation-issues.ts), and the form shows the
 *   message under that field.
 *
 *   LOOSE ON PURPOSE. Each schema is a z.looseObject: it checks the fields it names and lets every
 *   other field through to the handler, which goes on reading req.body as it did. The schema adds
 *   refusals and changes nothing a valid request gets. Fields whose shape the handler or its service
 *   decides (an organism's `shape` and `location`, a comment's `anchor`, a provenance block) are not
 *   named here, so they are checked where they always were.
 *
 *   `.nullable()` where the handler treats null as "not given" or "clear it", so a form that sends
 *   null for an empty field is not refused.
 * @structure OrganismCreateBody · OrganismUpdateBody · WorkspaceCreateBody · CommentCreateBody ·
 *   CONTACT_LIMITS · ContactAddBody · ContactUpdateBody · ProfileUpdateBody
 * @usage router.post('/v1/organisms', requireAuth(), requireScope('organism:write'), validateBody(OrganismCreateBody, config.nodeId), …)
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import { z } from 'zod';
import { INPUT_LIMITS, safeText, requiredText, documentText } from './input-limits.js';

const word = () => z.string().max(INPUT_LIMITS.id).nullable().optional();
const tags = () => z.array(safeText(INPUT_LIMITS.name)).nullable().optional();
const links = () => z.array(z.looseObject({
    label: safeText(INPUT_LIMITS.name).nullable().optional(),
    url: z.string().max(INPUT_LIMITS.url),
})).nullable().optional();

const organismFields = {
    description: safeText(INPUT_LIMITS.description).nullable().optional(),
    type: word(),
    interests: tags(),
    join_policy: word(),
    visibility: word(),
    member_visibility: word(),
    lang: word(),
};

/** POST /v1/organisms. The service also refuses a name shorter than two characters. */
export const OrganismCreateBody = z.looseObject({
    name: requiredText(INPUT_LIMITS.name),
    ...organismFields,
});

/** PUT /v1/organisms/:id: every field optional; `readme` is a Markdown page. */
export const OrganismUpdateBody = z.looseObject({
    name: requiredText(INPUT_LIMITS.name).optional(),
    ...organismFields,
    readme: documentText().nullable().optional(),
});

/** POST /v1/organisms/:id/workspaces. `manifest` and `schemas` are checked by provisionWorkspace. */
export const WorkspaceCreateBody = z.looseObject({
    name: requiredText(INPUT_LIMITS.name),
    readme: documentText().nullable().optional(),
});

/** POST /v1/organisms/:id/comments. The stored body is cut at 10 000 characters, as before. */
export const CommentCreateBody = z.looseObject({
    ws: requiredText(INPUT_LIMITS.id),
    space: requiredText(INPUT_LIMITS.id),
    instance_id: requiredText(INPUT_LIMITS.key),
    body: requiredText(INPUT_LIMITS.text),
    parent_id: word(),
});

/**
 * A saved person's card keeps a name of 140 characters (services/outbound/outbound-service.ts cut a
 * longer one in silence), a note of 1 000 and a relation of 40, as openapi.yaml has always said. The
 * card's own numbers, not the general classes, so what is refused is exactly what would not be kept.
 */
export const CONTACT_LIMITS = Object.freeze({ name: 140, note: 1000, relation: 40 });

/** POST /v1/contacts: a person (name + email) or an identity (contact_id); parseAddInput decides which. */
export const ContactAddBody = z.looseObject({
    contact_id: z.string().max(INPUT_LIMITS.id).optional(),
    name: safeText(CONTACT_LIMITS.name).optional(),
    email: z.string().max(INPUT_LIMITS.email).optional(),
    note: safeText(CONTACT_LIMITS.note).nullable().optional(),
    tags: tags(),
    links: links(),
    relation: safeText(CONTACT_LIMITS.relation).nullable().optional(),
});

/** PATCH /v1/contacts/:contactId. */
export const ContactUpdateBody = z.looseObject({
    name: safeText(CONTACT_LIMITS.name).optional(),
    note: safeText(CONTACT_LIMITS.note).nullable().optional(),
    tags: tags(),
    links: links(),
    relation: safeText(CONTACT_LIMITS.relation).nullable().optional(),
});

/** PUT /v1/ghii: the person's own profile. Region and time zone are checked against their lists by the handler. */
export const ProfileUpdateBody = z.looseObject({
    display_name: safeText(INPUT_LIMITS.name).optional(),
    bio: safeText(INPUT_LIMITS.description).optional(),
    avatar: z.string().max(INPUT_LIMITS.url).optional(),
    locale: word(),
    region: word(),
    timezone: word(),
    notification_email: z.string().max(INPUT_LIMITS.email).nullable().optional(),
});
