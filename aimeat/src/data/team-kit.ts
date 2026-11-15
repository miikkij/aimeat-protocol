/**
 * @file src/data/team-kit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a team set up by services/team/setup.ts starts with, in the three languages the
 *   node ships: three workspaces (shared knowledge, decisions, waiting for a person), the first text
 *   of the team context, and the team skill every member's AI reads to know how the team works.
 *
 *   A SHAPE, NOT A NEW KIND OF THING. The workspaces are an OrganismShape (data/organism-shapes.ts)
 *   applied by applyOrganismShape(), the same code path the starting shapes take, so the manifests,
 *   schemas and readmes are made and checked exactly as there. The team context is one record in
 *   the shared-knowledge workspace (space `context`, id `team`), so every member and every member's
 *   AI with a contributor grant writes it, as with any other record there. The skill is a user
 *   skill whose audience is the organism (services/skill/audience.ts).
 *
 *   The workspace and space names are written once per language and the team's working language
 *   picks one; a team is not translated after it is made.
 * @structure TEAM_LANGS · TeamLang · teamLang() · TEAM_KIT · TEAM_CONTEXT_SPACE · TEAM_CONTEXT_ID ·
 *   teamContextStart() · teamSkillMarkdown()
 * @usage
 *   const made = await applyOrganismShape(deps, orgId, owner, TEAM_KIT, 'fi');
 *   const md = teamSkillMarkdown({ lang: 'fi', skillName, teamName, orgId, ws });
 * @version-history
 *   v1.3.0 — 2026-11-15 — The team skill ends with the AI onboarding section (T11, EU AI Act art. 4).
 *   v1.2.0 — 2026-11-15 — A decision may carry where it was shared from, and a record may withdraw a share (T19).
 *   v1.1.0 — 2026-11-14 — TEAM_TYPES, teamTypeOf, teamKitFor and the type line in the team skill (T18).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T1, T5, T24).
 */
import type { OrganismShape } from './organism-shapes.js';

export const TEAM_LANGS = ['fi', 'en', 'es'] as const;
export type TeamLang = typeof TEAM_LANGS[number];

/** A language tag (fi, fi-FI, EN) as one of the three, or null. */
export function teamLang(raw: unknown): TeamLang | null {
    if (typeof raw !== 'string') return null;
    const two = raw.trim().slice(0, 2).toLowerCase();
    return (TEAM_LANGS as readonly string[]).includes(two) ? two as TeamLang : null;
}

const str = { type: 'string' };
const req = (fields: string[], properties: Record<string, unknown>) => ({ type: 'object', required: fields, properties });

/** The space and record that hold the team context in the shared-knowledge workspace. */
export const TEAM_CONTEXT_SPACE = 'shared.context';
export const TEAM_CONTEXT_ID = 'team';

/** Index of each workspace in TEAM_KIT.workspaces. */
export const TEAM_WS = { shared: 0, decisions: 1, waiting: 2 } as const;

export const TEAM_KIT: OrganismShape = {
    id: 'team-kit', type: 'team', joinPolicy: 'invite_only', visibility: 'private',
    label: { en: 'Team', fi: 'Tiimi', es: 'Equipo' },
    hint: {
        en: 'A team and each member\'s own AI on the same material.',
        fi: 'Tiimi ja jokaisen jäsenen oma AI samassa työssä.',
        es: 'Un equipo y la IA de cada miembro sobre el mismo material.',
    },
    workspaces: [
        {
            name: { en: 'Shared knowledge', fi: 'Yhteinen tieto', es: 'Conocimiento compartido' },
            purpose: {
                en: 'What the team knows and what is open. The team context is here.',
                fi: 'Mitä tiimi tietää ja mikä on auki. Tiimin konteksti on täällä.',
                es: 'Lo que sabe el equipo y lo que está abierto. El contexto del equipo está aquí.',
            },
            spaces: [
                { name: 'page', namespace: 'shared.pages', mode: 'document', writeRole: 'member', versioned: true },
                { name: 'item', namespace: 'shared.items', mode: 'records', writeRole: 'member', versioned: true,
                    schema: req(['id', 'title'], { id: str, title: str, status: { type: 'string', enum: ['open', 'done'] }, notes: str, owner: str }) },
                { name: 'context', namespace: TEAM_CONTEXT_SPACE, mode: 'records', writeRole: 'member', versioned: true,
                    schema: req(['id', 'core'], { id: str, name: str, summary: str, core: str }) },
            ],
        },
        {
            name: { en: 'Decisions', fi: 'Päätökset', es: 'Decisiones' },
            purpose: {
                en: 'What the team decided, why, and who decided.',
                fi: 'Mitä tiimi päätti, miksi ja kuka päätti.',
                es: 'Qué decidió el equipo, por qué y quién lo decidió.',
            },
            spaces: [
                { name: 'decision', namespace: 'shared.decisions', mode: 'records', writeRole: 'member', versioned: false, append: true,
                    // from, shared_by and shared_at: a copy shared from another team; status and
                    // withdraws: the record that withdraws such a copy (services/team/share-decision.ts).
                    schema: req(['id', 'title', 'decision'], {
                        id: str, title: str, decision: str, why: str, date: str, by: str,
                        from: { type: 'object', properties: { organism_id: str, team: str, decision_id: str } },
                        shared_by: str, shared_at: str, status: str, withdraws: str, withdrawn_at: str,
                    }) },
            ],
        },
        {
            name: { en: 'Waiting for you', fi: 'Odottaa sinua', es: 'Pendiente de ti' },
            purpose: {
                en: 'What waits for a person: a send, a payment, a delete, an approval, a change to the team skill.',
                fi: 'Mikä odottaa ihmistä: lähetys, maksu, poisto, hyväksyntä tai muutos tiimiskilliin.',
                es: 'Lo que espera a una persona: un envío, un pago, un borrado, una aprobación o un cambio en la skill del equipo.',
            },
            spaces: [
                { name: 'waiting', namespace: 'shared.waiting', mode: 'records', writeRole: 'member', versioned: true,
                    schema: req(['id', 'title', 'kind'], {
                        id: str, title: str, detail: str, for: str, by: str,
                        kind: { type: 'string', enum: ['send', 'pay', 'delete', 'approve', 'skill-change', 'other'] },
                        status: { type: 'string', enum: ['open', 'approved', 'rejected', 'done'] },
                    }) },
            ],
        },
    ],
};

type L = Record<TeamLang, string>;
type Space = OrganismShape['workspaces'][number]['spaces'][number];
const status = (values: string[]) => ({ type: 'string', enum: values });
const recordSpace = (name: string, namespace: string, required: string[], props: Record<string, unknown>): Space =>
    ({ name, namespace, mode: 'records', writeRole: 'member', versioned: true, schema: req(['id', ...required], { id: str, ...props }) });

/** What a team type adds: spaces in the shared-knowledge workspace, and one line for the team skill. */
export interface TeamType { id: string; label: L; spaces: Space[]; skillLine: L }

/** The team types the setup knows (team setup T18). Each is the same team, with what its work needs. */
export const TEAM_TYPES: TeamType[] = [
    { id: 'general', label: { en: 'Team', fi: 'Tiimi', es: 'Equipo' }, spaces: [], skillLine: { en: '', fi: '', es: '' } },
    { id: 'leadership', label: { en: 'Management team', fi: 'Johtoryhmä', es: 'Comité de dirección' }, spaces: [],
        skillLine: { en: 'This is a management team: what is prepared here stays here until it is decided, and a decision is shared only with the teams it concerns.', fi: 'Tämä on johtoryhmä: valmisteltava asia pysyy täällä, kunnes se on päätetty, ja päätös jaetaan vain niille tiimeille, joita se koskee.', es: 'Es un comité de dirección: lo que se prepara aquí se queda aquí hasta que se decide, y una decisión se comparte solo con los equipos a los que afecta.' } },
    { id: 'ai-strategy', label: { en: 'AI strategy group', fi: 'AI-strategiaryhmä', es: 'Grupo de estrategia de IA' },
        spaces: [recordSpace('ai-use', 'shared.ai-uses', ['name'], { name: str, purpose: str, provider: str, risk: status(['minimal', 'limited', 'high']), owner: str })],
        skillLine: { en: 'This group keeps the register of how the organisation uses AI (space ai-use): every use, its purpose, its provider and its risk class.', fi: 'Tämä ryhmä pitää rekisteriä siitä, miten organisaatio käyttää tekoälyä (tila ai-use): jokainen käyttö, sen tarkoitus, toimittaja ja riskiluokka.', es: 'Este grupo lleva el registro de cómo usa la IA la organización (espacio ai-use): cada uso, su finalidad, su proveedor y su clase de riesgo.' } },
    { id: 'sales', label: { en: 'Sales', fi: 'Myynti', es: 'Ventas' },
        spaces: [recordSpace('customer', 'shared.customers', ['name'], { name: str, contact: str, status: str, notes: str })],
        skillLine: { en: 'Customers are records in the space customer. A draft to a customer always waits for a person.', fi: 'Asiakkaat ovat tietueita tilassa customer. Luonnos asiakkaalle odottaa aina ihmistä.', es: 'Los clientes son registros en el espacio customer. Un borrador para un cliente siempre espera a una persona.' } },
    { id: 'design', label: { en: 'Design', fi: 'Design', es: 'Diseño' }, spaces: [],
        skillLine: { en: 'Pictures and large files go to the file store; a page here links them. An approved look is recorded as a decision.', fi: 'Kuvat ja isot tiedostot tallennetaan tiedostovarastoon, ja täällä oleva sivu linkittää ne. Hyväksytty ilme kirjataan päätökseksi.', es: 'Las imágenes y los archivos grandes van al almacén de archivos; una página aquí los enlaza. Un aspecto aprobado se registra como decisión.' } },
    { id: 'software', label: { en: 'Software development', fi: 'Ohjelmistokehitys', es: 'Desarrollo de software' },
        spaces: [recordSpace('incident', 'shared.incidents', ['title'], { title: str, status: status(['open', 'done']), notes: str, owner: str })],
        skillLine: { en: 'Something broken is an incident (space incident) until it is fixed; an architecture choice is a decision with its reason.', fi: 'Rikki oleva asia on häiriö (tila incident), kunnes se on korjattu. Arkkitehtuurivalinta on päätös perusteluineen.', es: 'Algo roto es una incidencia (espacio incident) hasta que se arregla; una elección de arquitectura es una decisión con su motivo.' } },
    { id: 'hardware', label: { en: 'Hardware design', fi: 'Laitesuunnittelu', es: 'Diseño de hardware' },
        spaces: [recordSpace('requirement', 'shared.requirements', ['title'], { title: str, status: status(['open', 'done']), notes: str }),
            recordSpace('change-request', 'shared.change-requests', ['title'], { title: str, status: status(['proposed', 'approved', 'rejected']), why: str })],
        skillLine: { en: 'Requirements and change requests are records; a change request waits for a lead\'s approval.', fi: 'Vaatimukset ja muutospyynnöt ovat tietueita. Muutospyyntö odottaa vetäjän hyväksyntää.', es: 'Los requisitos y las solicitudes de cambio son registros; una solicitud de cambio espera la aprobación de un responsable.' } },
    { id: 'mechanics', label: { en: 'Mechanics', fi: 'Mekaniikka', es: 'Mecánica' },
        spaces: [recordSpace('requirement', 'shared.requirements', ['title'], { title: str, status: status(['open', 'done']), notes: str }),
            recordSpace('change-request', 'shared.change-requests', ['title'], { title: str, status: status(['proposed', 'approved', 'rejected']), why: str })],
        skillLine: { en: 'Requirements, test results and change requests are records; compare a test result with its requirement.', fi: 'Vaatimukset, testitulokset ja muutospyynnöt ovat tietueita. Vertaa testitulosta sen vaatimukseen.', es: 'Los requisitos, los resultados de pruebas y las solicitudes de cambio son registros; compara un resultado con su requisito.' } },
    { id: 'marketing', label: { en: 'Marketing', fi: 'Markkinointi', es: 'Marketing' },
        spaces: [recordSpace('campaign', 'shared.campaigns', ['title'], { title: str, status: status(['open', 'done']), due: str, notes: str })],
        skillLine: { en: 'Anything made public waits for its owner\'s approval first.', fi: 'Kaikki julkiseksi tehtävä odottaa ensin omistajan hyväksyntää.', es: 'Todo lo que se hace público espera primero la aprobación de su propietario.' } },
    { id: 'hr', label: { en: 'HR', fi: 'HR', es: 'Recursos humanos' }, spaces: [],
        skillLine: { en: 'Personal data stays here; nothing about a person is written or changed without a person.', fi: 'Henkilötiedot pysyvät täällä. Ihmisestä ei kirjoiteta eikä muuteta mitään ilman ihmistä.', es: 'Los datos personales se quedan aquí; nada sobre una persona se escribe o cambia sin una persona.' } },
    { id: 'finance', label: { en: 'Finance', fi: 'Talous', es: 'Finanzas' }, spaces: [],
        skillLine: { en: 'Every payment waits for a person.', fi: 'Jokainen maksu odottaa ihmistä.', es: 'Cada pago espera a una persona.' } },
    { id: 'support', label: { en: 'Customer support', fi: 'Asiakastuki', es: 'Atención al cliente' },
        spaces: [recordSpace('ticket', 'shared.tickets', ['title'], { title: str, status: status(['open', 'done']), notes: str, owner: str })],
        skillLine: { en: 'A customer\'s matter is a ticket; a reply to a customer is a draft that waits for a person.', fi: 'Asiakkaan asia on tiketti. Vastaus asiakkaalle on luonnos, joka odottaa ihmistä.', es: 'Un asunto de un cliente es un ticket; una respuesta a un cliente es un borrador que espera a una persona.' } },
    { id: 'project', label: { en: 'Project', fi: 'Projekti', es: 'Proyecto' },
        spaces: [recordSpace('deliverable', 'shared.deliverables', ['title'], { title: str, status: status(['open', 'done']), due: str })],
        skillLine: { en: 'The project ends on its last day; deliverables are records with their due day.', fi: 'Projekti päättyy viimeisenä päivänään. Tuotokset ovat tietueita määräpäivineen.', es: 'El proyecto termina en su último día; los entregables son registros con su fecha.' } },
    { id: 'partner', label: { en: 'Partner team', fi: 'Kumppanitiimi', es: 'Equipo con socios' }, spaces: [],
        skillLine: { en: 'People from another company work here; write only what may be shared with them.', fi: 'Täällä työskentelee toisen yrityksen ihmisiä. Kirjoita vain se, minkä saa jakaa heille.', es: 'Aquí trabajan personas de otra empresa; escribe solo lo que se puede compartir con ellas.' } },
    { id: 'board', label: { en: 'Board', fi: 'Hallitus', es: 'Consejo' },
        spaces: [{ name: 'minutes', namespace: 'shared.minutes', mode: 'document', writeRole: 'member', versioned: true }],
        skillLine: { en: 'Minutes are documents in the space minutes, and are signed with the node\'s signing.', fi: 'Pöytäkirjat ovat dokumentteja tilassa minutes, ja ne allekirjoitetaan sähköisesti.', es: 'Las actas son documentos en el espacio minutes, y se firman electrónicamente.' } },
];

export function teamTypeOf(id: unknown): TeamType {
    return TEAM_TYPES.find(t => t.id === id) ?? TEAM_TYPES[0];
}

/** TEAM_KIT with a type's spaces added to the shared-knowledge workspace. */
export function teamKitFor(type: TeamType): OrganismShape {
    if (!type.spaces.length) return TEAM_KIT;
    const workspaces = TEAM_KIT.workspaces.map((w, i) => i === TEAM_WS.shared ? { ...w, spaces: [...w.spaces, ...type.spaces] } : w);
    return { ...TEAM_KIT, workspaces };
}

const CONTEXT_START: Record<TeamLang, (team: string, what: string) => string> = {
    fi: (team, what) => `# ${team}\n\n${what || 'Kerro tähän, mitä tiimi tekee.'}\n\n## Mikä on nyt auki\n\nEi vielä mitään. Jäsenten AI:t täydentävät tätä työn edetessä.\n`,
    en: (team, what) => `# ${team}\n\n${what || 'Write here what the team does.'}\n\n## What is open now\n\nNothing yet. The members' AIs add to this as the work goes on.\n`,
    es: (team, what) => `# ${team}\n\n${what || 'Escribe aquí lo que hace el equipo.'}\n\n## Lo que está abierto ahora\n\nNada todavía. Las IA de los miembros lo completan a medida que avanza el trabajo.\n`,
};

/** The first text of a team context: the team's name and what the person said the team does. */
export function teamContextStart(lang: TeamLang, team: string, what: string): string {
    return CONTEXT_START[lang](team, what.trim());
}

interface SkillArgs { lang: TeamLang; skillName: string; teamName: string; orgId: string; ws: { shared: string; decisions: string; waiting: string }; typeLine?: string }

const SKILL_TEXT: Record<TeamLang, (a: SkillArgs) => { description: string; body: string }> = {
    fi: a => ({
        description: `Näin tiimi ${a.teamName} toimii: mihin mikin kirjataan, mikä odottaa ihmistä ja mistä tiimin konteksti löytyy. Lue ennen kuin kirjoitat tiimille.`,
        body: `# Näin tiimi ${a.teamName} toimii

Toimit yhden tiimin jäsenen puolesta. Tiimissä on muitakin ihmisiä, ja heillä on omat AI:nsa, jotka lukevat samaa materiaalia.

## Ennen kuin vastaat tiimiä koskevaan asiaan

Lue tiimin konteksti: \`aimeat_team_status { organism_id: "${a.orgId}" }\`. Se kertoo, mitä tiimi tekee, ketkä siinä ovat ja mikä on auki.

## Mihin mikin kirjataan

- Avoin asia tai tieto, jota muut tarvitsevat: työtila Yhteinen tieto (\`${a.ws.shared}\`), tila \`item\`.
- Päätös, perustelu ja päättäjä: työtila Päätökset (\`${a.ws.decisions}\`), tila \`decision\`.
- Kaikki, mikä odottaa ihmistä: työtila Odottaa sinua (\`${a.ws.waiting}\`), tila \`waiting\`.
- Kun jokin olennainen muuttuu, päivitä tiimin konteksti: työtila Yhteinen tieto, tila \`context\`, tietue \`team\`.

Tiimin asia kirjataan tiimin työtilaan, ei henkilön omaan muistiin.

## Mikä odottaa ihmistä

Lähettäminen tiimin ulkopuolelle, maksaminen ja poistaminen odottavat aina ihmisen hyväksyntää. Kirjoita luonnos ja kirjaa se Odottaa sinua -tilaan. Älä lähetä, maksa tai poista itse.

## Muutos tähän skilliin

Jäsen ei muuta tätä skilliä suoraan. Kirjaa ehdotus Odottaa sinua -tilaan lajilla \`skill-change\`, ja tiimin vetäjä hyväksyy sen.
`,
    }),
    en: a => ({
        description: `How the team ${a.teamName} works: where each thing is written, what waits for a person and where the team context is. Read it before you write for the team.`,
        body: `# How the team ${a.teamName} works

You act for one member of a team. The team has other people, and their own AIs read the same material.

## Before you answer anything about the team

Read the team context: \`aimeat_team_status { organism_id: "${a.orgId}" }\`. It says what the team does, who is in it and what is open.

## Where each thing is written

- An open matter, or something the others need to know: workspace Shared knowledge (\`${a.ws.shared}\`), space \`item\`.
- A decision, why, and who decided: workspace Decisions (\`${a.ws.decisions}\`), space \`decision\`.
- Everything that waits for a person: workspace Waiting for you (\`${a.ws.waiting}\`), space \`waiting\`.
- When something that matters changes, update the team context: workspace Shared knowledge, space \`context\`, record \`team\`.

A matter of the team is written in the team's workspaces, not in the person's own memory.

## What waits for a person

Sending outside the team, paying and deleting always wait for a person's approval. Write a draft and put it in Waiting for you. Do not send, pay or delete yourself.

## A change to this skill

A member does not change this skill directly. Put the proposal in Waiting for you with kind \`skill-change\`, and a team lead approves it.
`,
    }),
    es: a => ({
        description: `Cómo trabaja el equipo ${a.teamName}: dónde se escribe cada cosa, qué espera a una persona y dónde está el contexto del equipo. Léela antes de escribir para el equipo.`,
        body: `# Cómo trabaja el equipo ${a.teamName}

Actúas en nombre de un miembro de un equipo. El equipo tiene más personas, y sus propias IA leen el mismo material.

## Antes de responder sobre el equipo

Lee el contexto del equipo: \`aimeat_team_status { organism_id: "${a.orgId}" }\`. Dice qué hace el equipo, quién está en él y qué está abierto.

## Dónde se escribe cada cosa

- Un asunto abierto, o algo que los demás necesitan saber: espacio de trabajo Conocimiento compartido (\`${a.ws.shared}\`), espacio \`item\`.
- Una decisión, el porqué y quién decidió: espacio de trabajo Decisiones (\`${a.ws.decisions}\`), espacio \`decision\`.
- Todo lo que espera a una persona: espacio de trabajo Pendiente de ti (\`${a.ws.waiting}\`), espacio \`waiting\`.
- Cuando cambia algo importante, actualiza el contexto del equipo: Conocimiento compartido, espacio \`context\`, registro \`team\`.

Un asunto del equipo se escribe en los espacios de trabajo del equipo, no en la memoria propia de la persona.

## Lo que espera a una persona

Enviar fuera del equipo, pagar y borrar siempre esperan la aprobación de una persona. Escribe un borrador y ponlo en Pendiente de ti. No envíes, pagues ni borres por tu cuenta.

## Un cambio en esta skill

Un miembro no cambia esta skill directamente. Pon la propuesta en Pendiente de ti con el tipo \`skill-change\`, y un responsable del equipo la aprueba.
`,
    }),
};

/** The team skill's SKILL.md in the team's working language. */
/**
 * The onboarding section every team skill ends with (team setup T11, EU AI Act article 4): the
 * member's AI goes through how the team uses AI with the person, and records it only on their word
 * (services/team/onboarding.ts).
 */
const ONBOARDING_TEXT: Record<TeamLang, (orgId: string) => string> = {
    fi: orgId => `\n## Perehdytys tekoälyn käyttöön tässä tiimissä\n\nKun `
        + `aimeat_team_status kertoo kohdassa \`ai_onboarding.you\`, ettei ihminen ole vielä käynyt perehdytystä, tarjoa sitä kerran. `
        + `Käy hänen kanssaan läpi tämän ohjeen kohdat: mihin tiimi käyttää tekoälyä, mitä tekoäly tekee itse ja mikä odottaa ihmistä (lähetys, maksu ja poisto odottavat vetäjän hyväksyntää), `
        + `mitä muut tiimissä näkevät ja mistä ihminen itse vastaa: hän tarkistaa tekoälyn tuottaman tekstin ennen kuin se lähtee eteenpäin. `
        + `Kysy lopuksi, ymmärsikö hän nämä. Kun hän sanoo kyllä omin sanoin, kutsu aimeat_team_onboarding_done { organism_id: "${orgId}" }. `
        + `Älä kutsu sitä ilman hänen vastaustaan. Kirjaus on organisaation todiste siitä, että se on huolehtinut tekoälyn käyttäjien osaamisesta (EU:n tekoälyasetus, artikla 4).\n`,
    en: orgId => `\n## Onboarding to how this team uses AI\n\nWhen `
        + `aimeat_team_status says under \`ai_onboarding.you\` that the person has not gone through it yet, offer it once. `
        + `Go through these points of this guide with them: what the team uses AI for, what the AI does on its own and what waits for a person (a send, a payment and a delete wait for a lead's approval), `
        + `what the others in the team see, and what the person answers for: they check text the AI produced before it goes on. `
        + `Then ask whether they understood these. When they say yes in their own words, call aimeat_team_onboarding_done { organism_id: "${orgId}" }. `
        + `Never call it without their answer. The record is the organisation's evidence that it saw to the AI literacy of the people who use AI (EU AI Act, article 4).\n`,
    es: orgId => `\n## Introducción al uso de la IA en este equipo\n\nCuando `
        + `aimeat_team_status indique en \`ai_onboarding.you\` que la persona aún no la ha hecho, ofrécesela una vez. `
        + `Repasa con ella estos puntos de esta guía: para qué usa el equipo la IA, qué hace la IA por su cuenta y qué espera a una persona (un envío, un pago y un borrado esperan la aprobación de un responsable), `
        + `qué ven los demás del equipo y de qué responde la persona: revisa el texto que la IA produjo antes de que siga adelante. `
        + `Después pregúntale si lo ha entendido. Cuando diga que sí con sus propias palabras, llama a aimeat_team_onboarding_done { organism_id: "${orgId}" }. `
        + `No la llames nunca sin su respuesta. El registro es la prueba de la organización de que se ocupó de la alfabetización en IA de quienes la usan (Reglamento de IA de la UE, artículo 4).\n`,
};

export function teamSkillMarkdown(a: SkillArgs): string {
    const { description, body } = SKILL_TEXT[a.lang](a);
    const fm = `---\nname: ${a.skillName}\ndescription: ${JSON.stringify(description)}\nlicense: MIT\nmetadata:\n  audience: agent\n---\n\n`;
    const heading = { fi: 'Tämän tiimin työ', en: 'This team\'s work', es: 'El trabajo de este equipo' }[a.lang];
    return fm + body + (a.typeLine ? `\n## ${heading}\n\n${a.typeLine}\n` : '') + ONBOARDING_TEXT[a.lang](a.orgId);
}
