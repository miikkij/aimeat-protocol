/**
 * @file src/services/build-data-map-step.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The DATA MAP STEP both build interviews include (Classic, build-app-prompt.ts, and
 *   Atelier, build-atelier-prompt.ts): three questions about who opens the app and whose each kind
 *   of data is, a scenario with named people that the person confirms before any code, and how the
 *   answers pick where the data lives.
 *
 *   WHY. The interviews asked "SHARED or PRIVATE?" (Classic) and "just you, or others too?"
 *   (Atelier), and a builder read "others too" as "every person keeps their own records". The case
 *   the developer named on 2026-10-17: a company on innokas.aimeat.io asked for ONE shared talent
 *   database and got TalentGrid, where every person keeps their own. The developer's words: an app
 *   is built without knowing whether it is for the person or for others too, whether others must
 *   see the same data, and it should check with examples drawn from what the person wants that it
 *   understood, and only then build. Plan doc-mvcn6c7e4e5q, step V7.
 *
 *   ITS OWN FILE because build-app-prompt.ts and build-atelier-prompt.ts are at the 800-line limit,
 *   and so the two tracks ask the same three questions in the same words.
 * @structure DATA_MAP_QUESTIONS (both tracks, in the interview) · dataMapSteer(track) (how the
 *   answers pick the build) · buildDataMapStep(track) (what each interview includes; Classic carries
 *   the steer in its own section, CLASSIC_DATA_MAP_STEER_HEADING) · ATELIER_DATA_MAP_STEER (the team
 *   branch of Atelier's "Data, in short") · ATELIER_DATA_MAP_PROPOSAL_LINE (the proposal states it)
 * @usage import { buildDataMapStep } from './build-data-map-step.js';
 *   full += buildDataMapStep('classic');
 * @version-history
 *   v1.0.1 — 2026-10-18 — One sentence shorter, so part `start` stays under 24 000 characters.
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V7).
 */

/** Which build specification the text is for. The two never teach each other's mechanics. */
export type DataMapTrack = 'classic' | 'atelier';

/**
 * The three questions and the confirmation. No markdown heading on purpose: it is read as part of
 * the interview section it follows, and the layered serving cuts the specification at headings.
 */
export const DATA_MAP_QUESTIONS = '**Then the data map: three more questions, before any code.** '
  + 'Ask them with the questions above, in plain words. Skipped, an app goes wrong unnoticed: a company asked for ONE shared list of candidates and got an app where every person keeps their own.\n'
  + '(a) Who opens the app: just you, your organisation (which organisation?), or anyone?\n'
  + '(b) For each kind of data the app keeps (name each one from the idea): whose is it? PERSONAL (each person their own), SHARED BY THE TEAM (one common set that everybody in the organisation reads and edits), or PUBLIC (anyone may see it)?\n'
  + '(c) Who may change the shared data: everyone in the team, or only some roles?\n'
  + '**Then confirm with a scenario, and wait for a yes.** Before you build, write back in the person\'s own language two or three sentences drawn from THEIR idea, with named people, for example: '
  + '"So I understood: when Teemu adds a candidate, Maija sees them at once in the same list. When Maija marks a candidate as a favourite, only Maija sees the mark. Nobody outside the company can open the app. Is that right?" '
  + 'Build only after they say yes. If they correct you, write the scenario again with the correction.\n\n';

/**
 * How the answers pick the build. Classic points at its GROUP section and may name the Atelier
 * kit's workspacePicker as a library block (CLASSIC_TRACK_NOTICE allows that); Atelier never
 * names anything of Classic.
 */
export function dataMapSteer(track: DataMapTrack): string {
  const picker = track === 'classic'
    ? '`AIMEAT.organism.findOrCreateWorkspace`, or the Atelier kit\'s `workspacePicker` library block, picks or creates it on the first run, and the section "If several people share it: a GROUP application" has the whole shape'
    : '`AIMEAT.atelier.workspacePicker({ target, app, onReady })` picks or creates it on the first run';
  const personal = track === 'classic' ? '`AIMEAT.data`' : '`AIMEAT.data.set/get`';
  return 'SHARED BY THE TEAM: ONE organism workspace that every member reads and writes, through `AIMEAT.organism` (read, writeDraft, publish); ' + picker + '. Never per-user memory for team data. '
    + 'PERSONAL: ' + personal + ', private to each person. '
    + 'PUBLIC: a record with `visibility: public`. '
    + 'WHO OPENS IT: the app\'s `open_to` setting, set when you publish (`anyone`, `signed-in`, or `organism:<id>` for one organisation\'s members) with `aimeat_app_manage` action `settings` or PATCH /v1/apps/:filename; the data map\'s `form` says the same (`group` or `organism-workspace` for a team app). '
    + 'THE TRAP: a team app built on per-user memory gives every person an empty copy of their own, and nobody sees what a colleague added.\n\n';
}

/** The heading of the Classic section that carries the steer; build-app-layers.ts places it. */
export const CLASSIC_DATA_MAP_STEER_HEADING = 'How the data map answers steer the build';

/**
 * The whole step for one track, as its interview includes it. Classic: the questions, then the
 * steer under its own heading (the layered serving puts that section in part `data`, because part
 * `start` is near the size one tool result carries). Atelier: the questions; its steer is the team
 * branch of "Data, in short" (ATELIER_DATA_MAP_STEER).
 */
export function buildDataMapStep(track: DataMapTrack): string {
  if (track === 'atelier') return DATA_MAP_QUESTIONS;
  return DATA_MAP_QUESTIONS + '### ' + CLASSIC_DATA_MAP_STEER_HEADING + '\n' + dataMapSteer('classic');
}

/** The team branch of the Atelier section "Data, in short". */
export const ATELIER_DATA_MAP_STEER = '**How the data map answers steer the build** (the three questions of the interview). '
  + dataMapSteer('atelier');

/** One bullet of the Atelier proposal (build-atelier-people.ts): the map is shown before code. */
export const ATELIER_DATA_MAP_PROPOSAL_LINE = '- **The data map, and the confirmed scenario.** For each kind of data: personal, shared by the team or public, who may change the shared data, and who opens the app. Repeat the scenario they said yes to; without that yes, ask it now.\n';
