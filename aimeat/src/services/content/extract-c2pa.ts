/**
 * @file src/services/content/extract-c2pa.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The C2PA manifest a file carries, read with @trustnxt/c2pa-ts (pure TypeScript, no
 *   native binary): whether a manifest is present, whether the library judges it valid, the claim
 *   generator, the signer from the signing certificate's subject, the title, the action names and the
 *   digital source types those actions declare. provenance-read.ts maps the source types to an AI
 *   verdict (types.ts AiMarks['c2pa']).
 *
 *   FORMATS. c2pa-ts reads JPEG, PNG, HEIC/HEIF, MP3 and MP4/BMFF. For any other format the answer is
 *   null, which means "not readable here", as opposed to `{ present: false }`, which means "readable,
 *   and no manifest". Chain of trust is not checked by the library, so `valid` says that the
 *   manifest's hashes and signature hold, not who is behind the certificate.
 *
 *   REFLECT METADATA. c2pa-ts loads @peculiar/x509, which loads tsyringe, and tsyringe throws at load
 *   time unless `Reflect.getMetadata` exists. The `reflect-metadata` package (Apache-2.0, the one
 *   tsyringe documents) is imported before the library, which is imported dynamically, so the node
 *   pays for neither until the first picture or video is read.
 *
 *   NEVER THROWS. Any error after a manifest was found gives `{ present: true, error }`; any error
 *   before that gives null.
 * @structure readC2pa · subjectName · loadC2pa
 * @usage const c2pa = await readC2pa(bytes); // null | { present: false } | { present: true, ... }
 * @version-history
 *   v1.0.1 — 2026-10-20 — The hand-written Reflect metadata functions are replaced by the
 *     reflect-metadata package.
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { logger } from '../../utils/logger.js';
import type { AiMarks } from './types.js';

type C2paFacts = NonNullable<AiMarks['c2pa']>;

type C2paModules = {
  asset: typeof import('@trustnxt/c2pa-ts/asset');
  jumbf: typeof import('@trustnxt/c2pa-ts/jumbf');
  manifest: typeof import('@trustnxt/c2pa-ts/manifest');
};

let loaded: Promise<C2paModules> | null = null;

/** The three c2pa-ts entry points, imported once, after reflect-metadata. */
function loadC2pa(): Promise<C2paModules> {
  if (!loaded) {
    loaded = import('reflect-metadata').then(() => Promise.all([
      import('@trustnxt/c2pa-ts/asset'),
      import('@trustnxt/c2pa-ts/jumbf'),
      import('@trustnxt/c2pa-ts/manifest'),
    ])).then(([asset, jumbf, manifest]) => ({ asset, jumbf, manifest }));
    loaded.catch((err: unknown) => {
      logger.warn(`[content] c2pa-ts did not load: ${errText(err)}`);
      loaded = null;
    });
  }
  return loaded;
}

/** "CN=Example Signer, O=Example Ltd, C=FI" gives "Example Signer (Example Ltd)". */
function subjectName(subject: string | undefined): string | undefined {
  if (!subject) return undefined;
  const field = (name: string): string | undefined =>
    new RegExp(`(?:^|,\\s*)${name}=((?:\\\\,|[^,])+)`).exec(subject)?.[1]?.replace(/\\,/g, ',').trim();
  const cn = field('CN');
  const o = field('O');
  if (cn && o && cn !== o) return `${cn} (${o})`;
  return cn ?? o ?? subject;
}

const errText = (err: unknown): string => ((err as Error)?.message || String(err)).slice(0, 300);

/**
 * The C2PA manifest summary of a file.
 * @param {Buffer} bytes - The file.
 * @returns {Promise<object|null>} null when c2pa-ts does not read the format; `{ present: false }`
 *   when it reads it and finds no manifest; otherwise the active manifest's summary.
 */
export async function readC2pa(bytes: Buffer): Promise<C2paFacts | null> {
  let found = false;
  try {
    const { asset: assetMod, jumbf: jumbfMod, manifest: manifestMod } = await loadC2pa();
    let asset: Awaited<ReturnType<typeof assetMod.createAsset>>;
    try {
      asset = await assetMod.createAsset(new Uint8Array(bytes));
    } catch (err) {
      // createAsset throws on any format it does not read; null is the documented answer for that.
      logger.debug(`[content] c2pa-ts does not read this format: ${errText(err)}`);
      return null;
    }
    const raw = await asset.getManifestJUMBF();
    if (!raw) return { present: false };
    found = true;

    const store = manifestMod.ManifestStore.read(jumbfMod.SuperBox.fromBuffer(raw));
    const active = store.getActiveManifest();
    const out: C2paFacts = { present: true };
    if (active?.claim) {
      const claim = active.claim;
      const gen = [claim.claimGeneratorName, claim.claimGeneratorVersion].filter(Boolean).join(' ');
      if (gen) out.claimGenerator = gen;
      else if (claim.claimGeneratorInfo) out.claimGenerator = claim.claimGeneratorInfo;
      if (claim.title) out.title = claim.title;
    }
    const signer = subjectName(active?.signature?.signatureData?.certificate?.subject);
    if (signer) out.signer = signer;

    const actions: string[] = [];
    const sourceTypes: string[] = [];
    for (const assertion of active?.assertions?.getActionAssertions() ?? []) {
      for (const a of assertion.actions ?? []) {
        if (a.action && !actions.includes(String(a.action))) actions.push(String(a.action));
        if (a.digitalSourceType && !sourceTypes.includes(String(a.digitalSourceType))) sourceTypes.push(String(a.digitalSourceType));
      }
    }
    if (actions.length) out.actions = actions;
    if (sourceTypes.length) out.digitalSourceTypes = sourceTypes;

    try {
      const result = await store.validate(asset);
      out.valid = result.isValid;
    } catch (err) {
      out.valid = false;
      out.error = errText(err);
    }
    return out;
  } catch (err) {
    logger.debug(`[content] C2PA read failed: ${errText(err)}`);
    return found ? { present: true, error: errText(err) } : null;
  }
}
