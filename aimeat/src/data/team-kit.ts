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
 *   skill whose audience is the organism (services/skill-audience.ts).
 *
 *   The workspace and space names are written once per language and the team's working language
 *   picks one; a team is not translated after it is made.
 * @structure TEAM_LANGS · TeamLang · teamLang() · TEAM_KIT · TEAM_CONTEXT_SPACE · TEAM_CONTEXT_ID ·
 *   teamContextStart() · teamSkillMarkdown()
 * @usage
 *   const made = await applyOrganismShape(deps, orgId, owner, TEAM_KIT, 'fi');
 *   const md = teamSkillMarkdown({ lang: 'fi', skillName, teamName, orgId, ws });
 * @version-history
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
                    schema: req(['id', 'title', 'decision'], { id: str, title: str, decision: str, why: str, date: str, by: str }) },
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

const CONTEXT_START: Record<TeamLang, (team: string, what: string) => string> = {
    fi: (team, what) => `# ${team}\n\n${what || 'Kerro tähän, mitä tiimi tekee.'}\n\n## Mikä on nyt auki\n\nEi vielä mitään. Jäsenten AI:t täydentävät tätä työn edetessä.\n`,
    en: (team, what) => `# ${team}\n\n${what || 'Write here what the team does.'}\n\n## What is open now\n\nNothing yet. The members' AIs add to this as the work goes on.\n`,
    es: (team, what) => `# ${team}\n\n${what || 'Escribe aquí lo que hace el equipo.'}\n\n## Lo que está abierto ahora\n\nNada todavía. Las IA de los miembros lo completan a medida que avanza el trabajo.\n`,
};

/** The first text of a team context: the team's name and what the person said the team does. */
export function teamContextStart(lang: TeamLang, team: string, what: string): string {
    return CONTEXT_START[lang](team, what.trim());
}

interface SkillArgs { lang: TeamLang; skillName: string; teamName: string; orgId: string; ws: { shared: string; decisions: string; waiting: string } }

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
export function teamSkillMarkdown(a: SkillArgs): string {
    const { description, body } = SKILL_TEXT[a.lang](a);
    const fm = `---\nname: ${a.skillName}\ndescription: ${JSON.stringify(description)}\nlicense: MIT\nmetadata:\n  audience: agent\n---\n\n`;
    return fm + body;
}
