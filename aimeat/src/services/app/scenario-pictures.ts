/**
 * @file services/app/scenario-pictures.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pictures a scenario run takes: where each is kept, the address a caller reads
 *   it from, and how they go away.
 *
 *   WHY THE NODE TAKES THEM. A builder is asked to accept an app from pictures at the phone and the
 *   desktop size in both themes, and the scenario run answered in sentences only. On 2026-11-27
 *   five measured builds each installed a browser of their own and wrote a test driver to get
 *   those pictures; three of the five replaced the sign-in and storage libraries with stand-ins,
 *   because their driver could not sign in, and so looked at a page that was not the published
 *   app. The scenario run already opens the published app at those sizes, signed in as a member
 *   of its own, so it takes the picture there.
 *
 *   WHERE THEY ARE. In the app owner's own files, private, under `playtest/<app file>/`, one file
 *   per scenario, size and theme. They are the owner's: the Files page lists them, and they count
 *   as the owner's storage. Not under `apps/`, where every key is read as an app.
 *
 *   HOW THEY GO AWAY. A run writes over the files of the run before it under the same names, and
 *   removes every file under the app's prefix that it did not write (a scenario that was removed
 *   or renamed). Deleting the app removes the prefix (services/app/lifecycle.ts).
 *
 *   HOW A CALLER READS ONE. The answer names an address per picture: the node's presigned download
 *   (services/download-token.ts, GET /v1/download/:token), valid for an hour and for that version
 *   of the file only. No sign-in is sent with it, so a builder with a shell saves it with one
 *   command and a person opens it in a browser.
 * @structure PICTURE_SIZES · scenarioPictureKey() · keepScenarioPicture() · sweepScenarioPictures()
 *   · removeScenarioPictures() · withPictureAddresses()
 * @usage
 *   const keep = (p) => keepScenarioPicture(storage, ownerGaii, filename, p);
 *   const answer = await withPictureAddresses(storage, config, ownerGaii, result);
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-noden-selain-antaa-kuvat-skenaarioajosta-rakentaja-ei-asenna).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { generateDownloadToken } from '../download-token.js';
import { OWN_HANDLE_TTL_SECONDS } from '../file-refs.js';
import { SCENARIO_SIZES } from './scenarios.js';

/** The sizes a picture is taken at: the phone and the desktop an app is accepted at. */
export const PICTURE_SIZES: ReadonlyArray<{ width: number; height: number }> = SCENARIO_SIZES.slice(0, 2);

/** JPEG quality of a picture: text stays readable and a desktop picture stays near 100 kB. */
export const PICTURE_QUALITY = 70;

const PREFIX = 'playtest/';

/** One picture as the run hands it over. */
export interface ScenarioPicture {
  scenario: string;
  /** `390x844`. */
  size: string;
  theme: 'light' | 'dark';
  jpeg: Buffer;
}

/** Is a picture taken at this size? */
export function isPictureSize(size: { width: number; height: number }): boolean {
  return PICTURE_SIZES.some(s => s.width === size.width && s.height === size.height);
}

/** The prefix every picture of one app is under. */
export function scenarioPicturePrefix(filename: string): string {
  return `${PREFIX}${filename}/`;
}

/** The key of one picture. A scenario id is lowercase letters, digits and hyphens (scenarios.ts). */
export function scenarioPictureKey(filename: string, p: { scenario: string; size: string; theme: string }): string {
  return `${scenarioPicturePrefix(filename)}${p.scenario}-${p.size}-${p.theme}.jpg`;
}

/**
 * Keep one picture in the owner's files and answer its key, or null when it could not be kept: a
 * picture that fails to store never fails the run it came from.
 */
export async function keepScenarioPicture(
  storage: Storage, ownerGaii: string, filename: string, picture: ScenarioPicture,
): Promise<string | null> {
  const key = scenarioPictureKey(filename, picture);
  try {
    await storage.createStorageFile({
      key, ownerGaii, visibility: 'private', mimeType: 'image/jpeg',
      size: picture.jpeg.length, data: picture.jpeg, createdAt: new Date().toISOString(),
    });
    return key;
  } catch (err) {
    logger.warn('scenario pictures: a picture was not kept', { key, error: String(err) });
    return null;
  }
}

/** Remove every picture of the app that is not in `keep`; answers how many went. */
export async function sweepScenarioPictures(
  storage: Storage, ownerGaii: string, filename: string, keep: ReadonlySet<string>,
): Promise<number> {
  const prefix = scenarioPicturePrefix(filename);
  let removed = 0;
  try {
    const files = await storage.listStorageFiles(ownerGaii);
    for (const f of files) {
      if (!f.key.startsWith(prefix) || keep.has(f.key)) continue;
      if (await storage.deleteStorageFile(ownerGaii, f.key)) removed += 1;
    }
  } catch (err) {
    logger.warn('scenario pictures: the sweep did not finish', { prefix, error: String(err) });
  }
  return removed;
}

/** Remove every picture of the app: the app was deleted. */
export function removeScenarioPictures(storage: Storage, ownerGaii: string, filename: string): Promise<number> {
  return sweepScenarioPictures(storage, ownerGaii, filename, new Set());
}

/** A run as the note keeps it: the key of its picture, when it has one. */
interface RunWithPicture { picture_key?: string; picture?: string }

/** What a caller is told about the pictures, once per answer that has any. */
export const PICTURES_LINE = 'Each run at the phone and the desktop size has a `picture` of the screen after its last step, or at the step that failed: '
  + `GET that address (no sign-in is sent; it is valid for ${Math.round(OWN_HANDLE_TTL_SECONDS / 60)} minutes) and LOOK at it. `
  + 'It is the published app, signed in as the run\'s own member, so no browser of your own and no stand-in for a library is needed to see it. '
  + 'The files are in the owner\'s own files under `playtest/`, and the next run writes over them.';

/**
 * The answer with an address on every run whose picture is still in the owner's files. A picture
 * that is gone (a newer run wrote over it, or the app's files were cleared) gets no address.
 */
export async function withPictureAddresses<T extends { scenarios: Array<{ runs: RunWithPicture[] }> }>(
  storage: Storage, config: AimeatConfig, ownerGaii: string, answer: T,
): Promise<T & { pictures?: string }> {
  const base = config.baseUrl.replace(/\/+$/, '');
  let any = false;
  const scenarios = await Promise.all(answer.scenarios.map(async (s) => ({
    ...s,
    runs: await Promise.all(s.runs.map(async (run) => {
      if (!run.picture_key) return run;
      try {
        const file = await storage.getStorageFileMeta(ownerGaii, run.picture_key);
        if (!file) return run;
        const token = await generateDownloadToken(
          { sub: file.ownerGaii, key: file.key, mimeType: file.mimeType, size: file.size, version: file.createdAt, filename: file.key.split('/').pop() as string },
          OWN_HANDLE_TTL_SECONDS,
        );
        any = true;
        return { ...run, picture: `${base}/v1/download/${token}` };
      } catch (err) {
        logger.debug('scenario pictures: no address for a picture', { key: run.picture_key, error: String(err) });
        return run;
      }
    })),
  })));
  return { ...answer, scenarios, ...(any ? { pictures: PICTURES_LINE } : {}) };
}
