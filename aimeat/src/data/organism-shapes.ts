/**
 * @file src/data/organism-shapes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The starting shapes for an organism: my own work, a team, a company, a family, a club
 *   and a project. Each is an organism type, a join policy and a visibility, and one or two
 *   workspaces with their spaces, schemas and a readme that says what the place is for and what is
 *   current (guided journey P5, brief doc-mupor242l3cq).
 *
 *   ONE SOURCE. The project shape is the "project" template the organism pages applied by writing
 *   the manifest and the schemas straight into memory (public/js/services/organisms.workspace-gen.js);
 *   it lives here now, and the page reads it from GET /v1/organisms/shapes and applies it through the
 *   workspace routes, which go through services/workspace-provision.ts and workspace-meta.ts.
 *
 *   The names are in the three languages the node ships, so a shape creates a workspace the person
 *   reads in their own language. A shape is a start, not a rule: every space can be renamed, added
 *   or archived afterwards.
 * @structure ORGANISM_SHAPES · shapeById · shapeWorkspaceInput(shape, index, lang) · publicShapes(lang)
 * @usage const input = shapeWorkspaceInput(shapeById('team')!, 0, 'fi');
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial. The project shape moved here from organisms.workspace-gen.js.
 */

export type ShapeLang = 'en' | 'fi' | 'es';
type L = Record<ShapeLang, string>;
export type ShapeId = 'own-work' | 'team' | 'company' | 'family' | 'club' | 'project';

interface ShapeSpace {
    name: string;
    namespace: string;
    mode: 'document' | 'records';
    writeRole: 'owner' | 'member';
    versioned: boolean;
    append?: boolean;
    schema?: Record<string, unknown>;
}

interface ShapeWorkspace { name: L; purpose: L; spaces: ShapeSpace[] }

export interface OrganismShape {
    id: ShapeId;
    type: string;
    joinPolicy: 'open' | 'approval_required' | 'invite_only';
    visibility: 'public' | 'listed' | 'private';
    label: L;
    hint: L;
    workspaces: ShapeWorkspace[];
    /** Manifest fields beyond the spaces, carried as they are (the project template's gate policy). */
    manifestExtra?: Record<string, unknown>;
}

const str = { type: 'string' };
const req = (fields: string[], properties: Record<string, unknown>) => ({ type: 'object', required: fields, properties });

/** Free-form pages: notes, guides, the handbook. Every shape has one. */
const pages: ShapeSpace = { name: 'page', namespace: 'shared.pages', mode: 'document', writeRole: 'member', versioned: true };

const decisions: ShapeSpace = {
    name: 'decision', namespace: 'shared.decisions', mode: 'records', writeRole: 'member', versioned: false, append: true,
    schema: req(['id', 'title', 'decision'], { id: str, title: str, decision: str, why: str, date: str, by: str }),
};

/** The project template, unchanged from organisms.workspace-gen.js PROJECT_SCHEMAS. */
const PROJECT_SPACES: ShapeSpace[] = [
    { name: 'goal', namespace: 'meta.goals', mode: 'records', writeRole: 'owner', versioned: true, schema: req(['id', 'title', 'status'], {
        id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['open', 'met', 'dropped'] },
        definitionOfDone: { type: 'array', items: { type: 'string' } }, gateId: str }) },
    { name: 'plan', namespace: 'meta.plans', mode: 'records', writeRole: 'owner', versioned: true, schema: req(['id', 'approach', 'version', 'status'], {
        id: { type: 'string', minLength: 1 }, approach: { type: 'string', minLength: 1 },
        version: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: ['proposed', 'approved', 'superseded'] },
        steps: { type: 'array', items: { type: 'string' } }, gateId: str }) },
    { name: 'deliverable', namespace: 'shared.deliverables', mode: 'records', writeRole: 'member', versioned: true, schema: req(['id', 'title', 'status'], {
        id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['proposed', 'in_progress', 'delivered', 'accepted', 'rejected'] },
        description: str, acceptanceCriteria: { type: 'array', items: { type: 'string' } } }) },
    { name: 'decision', namespace: 'meta.decisions', mode: 'records', writeRole: 'member', versioned: false, append: true, schema: req(['ts', 'kind', 'by', 'summary'], {
        ts: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['decision', 'plan-change', 'deliverable', 'rating'] },
        by: { type: 'string', minLength: 1 }, summary: { type: 'string', minLength: 1 } }) },
    { name: 'resource', namespace: 'shared.resources', mode: 'records', writeRole: 'member', versioned: true, schema: req(['id', 'kind', 'label', 'origin', 'pointer', 'visibility'], {
        id: { type: 'string', minLength: 1 }, kind: { type: 'string', enum: ['doc', 'code', 'asset', 'knowledge', 'link'] },
        label: { type: 'string', minLength: 1 }, origin: { type: 'string', enum: ['local', 'referenced', 'link'] },
        pointer: { type: 'string', minLength: 1 }, visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'] } }) },
];

export const ORGANISM_SHAPES: OrganismShape[] = [
    {
        id: 'own-work', type: 'project', joinPolicy: 'invite_only', visibility: 'private',
        label: { en: 'My own work', fi: 'Oma työni', es: 'Mi propio trabajo' },
        hint: {
            en: 'One place for your own work that every AI you connect reads. Invite someone later if you want.',
            fi: 'Yksi paikka omalle työllesi, jota kaikki yhdistämäsi tekoälyt lukevat. Voit kutsua muita myöhemmin.',
            es: 'Un solo lugar para tu propio trabajo que leen todas las IA que conectes. Puedes invitar a alguien después.',
        },
        workspaces: [{ name: { en: 'Notes', fi: 'Muistiinpanot', es: 'Notas' },
            purpose: { en: 'What I am working on, what I know, and what is current.', fi: 'Mitä teen, mitä tiedän ja mikä on nyt ajankohtaista.', es: 'En qué trabajo, lo que sé y lo que está vigente.' },
            spaces: [pages] }],
    },
    {
        id: 'team', type: 'team', joinPolicy: 'approval_required', visibility: 'private',
        label: { en: 'Team', fi: 'Tiimi', es: 'Equipo' },
        hint: {
            en: 'A handbook the team and its AIs read, and the decisions you made, with why.',
            fi: 'Käsikirja, jota tiimi ja sen tekoälyt lukevat, ja tehdyt päätökset perusteluineen.',
            es: 'Un manual que leen el equipo y sus IA, y las decisiones tomadas, con el porqué.',
        },
        workspaces: [{ name: { en: 'Team handbook', fi: 'Tiimin käsikirja', es: 'Manual del equipo' },
            purpose: { en: 'How we work, and what we decided.', fi: 'Miten teemme työtä ja mitä olemme päättäneet.', es: 'Cómo trabajamos y qué decidimos.' },
            spaces: [pages, decisions] }],
    },
    {
        id: 'company', type: 'company', joinPolicy: 'invite_only', visibility: 'private',
        label: { en: 'Company', fi: 'Yritys', es: 'Empresa' },
        hint: {
            en: 'What the company knows, and its customers, in one place every employee and AI reads.',
            fi: 'Mitä yritys tietää, ja sen asiakkaat, yhdessä paikassa, jota jokainen työntekijä ja tekoäly lukee.',
            es: 'Lo que sabe la empresa, y sus clientes, en un solo lugar que leen todo el personal y las IA.',
        },
        workspaces: [
            { name: { en: 'Company knowledge', fi: 'Yrityksen tieto', es: 'Conocimiento de la empresa' },
                purpose: { en: 'What the company knows and has decided.', fi: 'Mitä yritys tietää ja on päättänyt.', es: 'Lo que la empresa sabe y ha decidido.' },
                spaces: [pages, decisions] },
            { name: { en: 'Customers', fi: 'Asiakkaat', es: 'Clientes' },
                purpose: { en: 'Who our customers are and where each one stands.', fi: 'Keitä asiakkaamme ovat ja missä kunkin kanssa ollaan.', es: 'Quiénes son nuestros clientes y en qué punto está cada uno.' },
                spaces: [{ name: 'customer', namespace: 'shared.customers', mode: 'records', writeRole: 'member', versioned: true,
                    schema: req(['id', 'name'], { id: str, name: str, contact: str, status: str, notes: str }) }] },
        ],
    },
    {
        id: 'family', type: 'family', joinPolicy: 'invite_only', visibility: 'private',
        label: { en: 'Family', fi: 'Perhe', es: 'Familia' },
        hint: {
            en: 'Family notes and the things that need doing, read by everyone in the family and their AIs.',
            fi: 'Perheen muistiinpanot ja tehtävät, joita koko perhe ja heidän tekoälynsä lukevat.',
            es: 'Notas de la familia y lo que hay que hacer, leídas por toda la familia y sus IA.',
        },
        workspaces: [{ name: { en: 'Family', fi: 'Perhe', es: 'Familia' },
            purpose: { en: 'What the family needs to know, and who does what.', fi: 'Mitä perheen pitää tietää ja kuka tekee mitäkin.', es: 'Lo que la familia necesita saber y quién hace qué.' },
            spaces: [pages, { name: 'task', namespace: 'shared.tasks', mode: 'records', writeRole: 'member', versioned: true,
                schema: req(['id', 'title'], { id: str, title: str, who: str, due: str, done: { type: 'boolean' } }) }] }],
    },
    {
        id: 'club', type: 'club', joinPolicy: 'approval_required', visibility: 'listed',
        label: { en: 'Club', fi: 'Kerho', es: 'Club' },
        hint: {
            en: 'Club notes and events, where members join with your approval.',
            fi: 'Kerhon muistiinpanot ja tapahtumat; jäsenet liittyvät hyväksynnälläsi.',
            es: 'Notas y eventos del club; los miembros se unen con tu aprobación.',
        },
        workspaces: [{ name: { en: 'Club', fi: 'Kerho', es: 'Club' },
            purpose: { en: 'What the club does and when.', fi: 'Mitä kerho tekee ja milloin.', es: 'Qué hace el club y cuándo.' },
            spaces: [pages, { name: 'event', namespace: 'shared.events', mode: 'records', writeRole: 'member', versioned: true,
                schema: req(['id', 'title', 'date'], { id: str, title: str, date: str, place: str, notes: str }) }] }],
    },
    {
        id: 'project', type: 'project', joinPolicy: 'invite_only', visibility: 'private',
        label: { en: 'Project', fi: 'Projekti', es: 'Proyecto' },
        hint: {
            en: 'Goals, plans, deliverables, decisions and resources, the way the project template sets them.',
            fi: 'Tavoitteet, suunnitelmat, tuotokset, päätökset ja aineistot projektipohjan mukaan.',
            es: 'Objetivos, planes, entregables, decisiones y recursos, como los organiza la plantilla de proyecto.',
        },
        workspaces: [{ name: { en: 'Project', fi: 'Projekti', es: 'Proyecto' },
            purpose: { en: 'Goals, plans, deliverables and decisions.', fi: 'Tavoitteet, suunnitelmat, tuotokset ja päätökset.', es: 'Objetivos, planes, entregables y decisiones.' },
            spaces: PROJECT_SPACES }],
        // As the project template set it: agents may write, and these four wait for a person.
        manifestExtra: {
            entry: { loadHint: 'readme -> goals -> plans -> deliverables -> decisions' },
            policy: { agentAutonomy: 'L3', alwaysGate: ['external-release', 'spend', 'data-egress', 'data-model-change'] },
        },
    },
];

export function shapeById(id: unknown): OrganismShape | null {
    return ORGANISM_SHAPES.find(s => s.id === id) ?? null;
}

const pick = (l: L, lang: string): string => l[(['en', 'fi', 'es'].includes(lang) ? lang : 'en') as ShapeLang];

/** The readme every shaped workspace starts with: what it is for, and where what is current is said. */
function readmeFor(name: string, purpose: string, lang: string): string {
    const current = { en: 'What is current', fi: 'Mikä on nyt ajankohtaista', es: 'Qué está vigente' };
    const note = {
        en: 'Write here what matters now. When something stops mattering, say so here, or archive it.',
        fi: 'Kirjoita tähän, mikä on nyt tärkeää. Kun jokin lakkaa olemasta tärkeää, kerro se tässä tai arkistoi se.',
        es: 'Escribe aquí lo que importa ahora. Cuando algo deje de importar, dilo aquí o archívalo.',
    };
    return `# ${name}\n\n${purpose}\n\n## ${pick(current, lang)}\n\n${pick(note, lang)}\n`;
}

/** What services/workspace-provision.ts takes for one workspace of a shape. */
export function shapeWorkspaceInput(shape: OrganismShape, index: number, lang: string) {
    const ws = shape.workspaces[index];
    const name = pick(ws.name, lang);
    const purpose = pick(ws.purpose, lang);
    const manifest = {
        manifestVersion: '1.0', id: '', name, kind: shape.id, language: lang, summary: purpose, status: 'active',
        ...(shape.manifestExtra ?? {}),
        objectTypes: ws.spaces.map(s => ({
            name: s.name, schemaRef: `schema:${shape.id}/${s.name}@1`, namespace: s.namespace, mode: s.mode,
            cardinality: 'many', backing: 'memory', writeRole: s.writeRole, versioned: s.versioned,
            ...(s.append ? { append: true } : {}),
        })),
    };
    const schemas: Record<string, Record<string, unknown>> = {};
    for (const s of ws.spaces) if (s.schema) schemas[s.namespace] = s.schema;
    return { name, manifest, schemas, readme: readmeFor(name, purpose, lang) };
}

/** The list a page or an AI chooses from: id, label, hint and the workspaces it makes, in one language. */
export function publicShapes(lang: string) {
    return ORGANISM_SHAPES.map(s => ({
        id: s.id, type: s.type, join_policy: s.joinPolicy, visibility: s.visibility,
        label: pick(s.label, lang), hint: pick(s.hint, lang),
        workspaces: s.workspaces.map((_, i) => {
            const input = shapeWorkspaceInput(s, i, lang);
            return { name: input.name, spaces: input.manifest.objectTypes.map(o => ({ name: o.name, mode: o.mode })), manifest: input.manifest, schemas: input.schemas };
        }),
    }));
}
