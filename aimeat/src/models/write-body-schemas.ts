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
 * @structure OrganismCreateBody · OrganismUpdateBody · AccessRequestBody · WorkspaceCreateBody ·
 *   CommentCreateBody · CONTACT_LIMITS · ContactAddBody · ContactUpdateBody · ProfileUpdateBody
 * @usage router.post('/v1/organisms', requireAuth(), requireScope('organism:write'), validateBody(OrganismCreateBody, config.nodeId), …)
 * @version-history
 *   v1.4.0 — 2026-11-15 — TeamDecisionShareBody: share a team decision with other teams (T19).
 *     TeamSetupTeams: `approval_gate` (T7). TeamOnboardingBody (T11).
 *   v1.3.0 — 2026-11-14 — TeamSetupTeams: `type`, the team type (TEAM_TYPE_IDS).
 *   v1.2.0 — 2026-11-14 — TeamSetupBody and TeamSetupTeams: POST /v1/teams/setup and aimeat_team_setup.
 *   v1.1.0 — 2026-11-12 — AccessRequestBody: the optional message of an access request.
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

const teamLang = z.enum(['fi', 'en', 'es']);
/** The ids of data/team-kit.ts TEAM_TYPES; test/unit/team-types.test.ts holds the two lists equal. */
export const TEAM_TYPE_IDS = ['general', 'leadership', 'ai-strategy', 'sales', 'design', 'software', 'hardware', 'mechanics',
    'marketing', 'hr', 'finance', 'support', 'project', 'partner', 'board'] as const;
const teamName = () => safeText(INPUT_LIMITS.name);
const teamPerson = z.union([
    z.string().max(INPUT_LIMITS.email).describe('An email address or an account name.'),
    z.object({
        email: z.string().max(INPUT_LIMITS.email).optional().describe('The person\'s email address.'),
        account: z.string().max(INPUT_LIMITS.id).optional().describe('An account name on this node, when there is no address.'),
        language: teamLang.optional().describe('The language of this person\'s invitation; the team\'s language when left out.'),
        until: z.string().max(10).optional().describe('The last day of a temporary membership (YYYY-MM-DD). The person leaves the team after it, and the leads are told a week before.'),
    }),
]);

/** The teams of POST /v1/teams/setup and aimeat_team_setup (tool-catalog/definitions/teams.ts). */
export const TeamSetupTeams = z.array(z.object({
    organism_id: z.string().max(INPUT_LIMITS.id).optional().describe('A team that exists: add leads and members, or correct its names. Leave out to make a new team.'),
    name: teamName().optional().describe('The team\'s name in its working language.'),
    names: z.object({ fi: teamName().optional(), en: teamName().optional(), es: teamName().optional() }).optional()
        .describe('The name in each language, written by you. Every member sees the name in their own language.'),
    language: teamLang.optional().describe('The team\'s working language: its workspaces, context and skill are written in it. The caller\'s language when left out.'),
    kind: z.enum(['team', 'virtual']).optional().describe('"virtual" for a team formed around a theme across other teams.'),
    type: z.enum(TEAM_TYPE_IDS).optional().describe('What the team works on, for a new team: it adds the spaces that work needs (sales gets customers, software gets incidents, the AI strategy group gets the register of AI uses, a board gets minutes) and a line in the team skill. "general" when left out.'),
    description: safeText(2000).optional().describe('What the team does, in a sentence or two. It starts the team context.'),
    descriptions: z.object({ fi: safeText(2000).optional(), en: safeText(2000).optional(), es: safeText(2000).optional() }).optional()
        .describe('The description in each language, written by you, as with `names`. Every member reads it in their own language.'),
    leads: z.array(teamPerson).max(200).optional().describe('Leads besides you. A lead who is already a member becomes one at once; anyone else is invited and becomes a lead on accepting.'),
    members: z.array(teamPerson).max(200).optional().describe('Members to invite. Each gets an invitation in their own language.'),
    remove: z.array(teamPerson).max(200).optional().describe('People to take out of a team that exists ("Pekka leaves"). Their own AI loses its access with them; what they wrote stays. The last lead is never removed this way.'),
    ends_on: z.string().max(10).nullable().optional().describe('The team\'s last day (YYYY-MM-DD), for a project team; null clears it. The team is archived after it, and the leads are told a week before.'),
    depends_on: z.array(z.object({
        organism_id: z.string().max(INPUT_LIMITS.id).describe('A team this one needs something from.'),
        what: safeText(300).optional().describe('What it needs, in a few words.'),
    })).max(30).optional().describe('The teams this team depends on, shown on the team map. Replaces the list.'),
    approval_gate: z.boolean().optional().describe('On (the default for a new team): when an AI deletes in the team\'s workspaces, or an agent that works for the team sends or pays, it waits until a lead approves. Only a lead turns it off.'),
})).max(30);

/** POST /v1/teams/:id/paste: an AI's tagged answer brought back into the team (services/team/prompt.ts). */
export const TeamPasteBody = z.looseObject({
    text: documentText(),
    dry_run: z.boolean().optional(),
});

/** POST /v1/teams/:id/onboarding (services/team/onboarding.ts): the caller confirms for themselves; nothing else is read. */
export const TeamOnboardingBody = z.strictObject({});

/** POST /v1/teams/:id/decisions/:decision/share (services/team/share-decision.ts). */
export const TeamDecisionShareBody = z.looseObject({
    to: z.array(z.string().min(1).max(100)).min(1).max(20),
    withdraw: z.boolean().optional(),
    dry_run: z.boolean().optional(),
});

/** POST /v1/teams/setup. The service reads the people and refuses what is not an address or an account. */
export const TeamSetupBody = z.looseObject({
    teams: TeamSetupTeams,
    dry_run: z.boolean().optional(),
});

/** PUT /v1/organisms/:id: every field optional; `readme` is a Markdown page. */
export const OrganismUpdateBody = z.looseObject({
    name: requiredText(INPUT_LIMITS.name).optional(),
    ...organismFields,
    readme: documentText().nullable().optional(),
});

/**
 * POST …/access-request (an app, a welcome page, a company front page): an optional note to the
 * people who decide. The whole body may be absent. The limit is the service's
 * JOIN_REQUEST_MESSAGE_MAX (services/organism-join-requests/requests.ts).
 */
export const AccessRequestBody = z.looseObject({
    message: safeText(1000).nullable().optional(),
}).nullish();

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
