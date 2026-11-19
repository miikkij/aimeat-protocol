/**
 * @file src/services/app/track-drift.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a publish says when a build left the Atelier track.
 *
 *   A new app is built on Atelier. On 2026-09-19 a model handed the developer a Classic app it had
 *   begun on Atelier: it had been pointed at a separate guide, judged the Classic shell quicker to
 *   start from, changed over, and then accepted a broken sign-in bar because its own tests passed.
 *   Nothing on the node noticed, since both tracks publish and both are valid apps.
 *
 *   Two things are knowable at publish time, and both are said as WARNINGS, never a refusal: an
 *   owner may ask for Classic, and sixty Classic apps on the production node are updated every
 *   week.
 *     - The publish carried the ATELIER spec token and the app is not an Atelier app. The token
 *       is a digest of that specification, so this session read it and then built something else.
 *     - The app is NEW and on Classic. Said once, at the first publish; an update of an app that
 *       is already Classic says nothing.
 *   The track-mixing check in app-artifact-lint.ts owns the third case (the kit loaded and no
 *   track declared), so an app that loads the kit is left to it.
 * @structure trackDriftFindings(input) → AppArtifactFinding[]
 * @usage
 *   const drift = trackDriftFindings({ isUpdate, track, loadsAtelier, carriedAtelierToken });
 * @version-history
 *   v2.0.0 — 2026-11-19 — One track (decision-atelier-is-the-only-app-build-guide-classic-and-t1-t2-t3-are):
 *     a NEW app that is not an Atelier app is warned that every app is built with the Atelier
 *     specification, and a page of its own goes inside the shell as `custom:<name>`; an update of a
 *     Classic app says nothing. The "began on Atelier, changed to Classic" warning is gone, because
 *     the retired Classic address now hands out the Atelier token as well.
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AppArtifactFinding } from './artifact-lint.js';

export interface TrackDriftInput {
  isUpdate: boolean;
  /** What the head declares, or what the previous version stored; undefined reads as Classic. */
  track: 'classic' | 'atelier' | undefined;
  loadsAtelier: boolean;
  /**
   * The publish carried the current Atelier specification's token. Read until 2026-11-19, when the
   * retired Classic address began handing out this token too, so it no longer says which guide a
   * build read; kept so the caller's shape does not change.
   */
  carriedAtelierToken: boolean;
}

const PITFALL = 'track-drift';
const finding = (message: string): AppArtifactFinding => ({ pitfall: PITFALL, severity: 'warn', message, url: `/v1/appdev/pitfalls/${PITFALL}` });

export function trackDriftFindings(input: TrackDriftInput): AppArtifactFinding[] {
  if (input.track === 'atelier' || input.loadsAtelier) return [];
  // An update of an app built before the Classic track was retired says nothing: it is changed with
  // the Atelier specification and moved when its owner chooses (section from-classic), and such
  // apps are updated every week.
  if (input.isUpdate) return [];
  return [finding(
    'This is a new app that is not an Atelier app: it loads no Atelier kit and does not declare the track. Every app is '
    + 'built with the Atelier specification (`aimeat_handbook_get { tier: "build-app-atelier" }`, skill '
    + '`node:aimeat-app-builder-atelier`): forked from a genre, or started from `shell-atelier`, with the served component '
    + 'kit carrying the header, the sign-in and the loading, empty and error states. A page with a look or an engine of its '
    + 'own goes inside the Atelier shell and names its register as `custom:<name>`. The Classic track that built pages like '
    + 'this one was retired on 2026-11-19. Tell the owner, and move the page to the shell before you hand it over.')];
}
