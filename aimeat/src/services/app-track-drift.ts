/**
 * @file src/services/app-track-drift.ts
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
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AppArtifactFinding } from './app-artifact-lint.js';

export interface TrackDriftInput {
  isUpdate: boolean;
  /** What the head declares, or what the previous version stored; undefined reads as Classic. */
  track: 'classic' | 'atelier' | undefined;
  loadsAtelier: boolean;
  /** The publish carried the current Atelier specification's token. */
  carriedAtelierToken: boolean;
}

const PITFALL = 'track-drift';
const finding = (message: string): AppArtifactFinding => ({ pitfall: PITFALL, severity: 'warn', message, url: `/v1/appdev/pitfalls/${PITFALL}` });

export function trackDriftFindings(input: TrackDriftInput): AppArtifactFinding[] {
  if (input.track === 'atelier' || input.loadsAtelier) return [];

  if (input.carriedAtelierToken) {
    return [finding(
      'You carried the Atelier specification\'s token, and this is not an Atelier app: it loads no Atelier kit and does not '
      + 'declare the track. So this build began on Atelier and changed to Classic on the way. The two guides do not describe '
      + 'each other, and the header, the sign-in and the loading, empty and error states that the Atelier shell carries were '
      + 'written by hand here. If the owner asked for Classic, tell them that is what they got. If they did not, tell them '
      + 'what happened before you hand this over, and go back to the genre you started from.')];
  }

  if (!input.isUpdate) {
    return [finding(
      'This is a new app on the Classic track. A new app is built on the Atelier track: forked from a genre, with the served '
      + 'component kit carrying the header, the sign-in and the states (`aimeat_handbook_get { tier: "build-app-atelier" }`, '
      + 'skill `node:aimeat-app-builder-atelier`). Classic is for improving an app that is already Classic, or when the '
      + 'owner asks for it by name. If that is the case here, say so to the owner; if it is not, the app they were promised '
      + 'is the Atelier one.')];
  }
  return [];
}
