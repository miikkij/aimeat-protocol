/**
 * @file assets/index.js
 * @description The aimeat-assets library. Exposes AIMEAT.assets: the asset manager for a game or
 *   any app made mostly of media, so nobody has to invent one again.
 *
 *     manifest(spec)     one validated, frozen record listing every file and text an app uses
 *     library(spec)      the store around it: load, add, save, check, hand it to Phaser
 *     upload(file, …)    a file into storage, public, and the /v1/pub address it answers with
 *     packAtlas(images)  many small pictures into one sheet plus its JSON, in the browser
 *     sound.toWav / .record   a synth voice rendered offline into a file a pack can carry
 *     preview(target, …) the manifest as a gallery on the Atelier tokens
 *
 *   THREE PLACES, ONE FOR EACH KIND OF THING. The FILES live in storage, public, at
 *   /v1/pub/<owner>/<key>, which is the address a player's browser can read with no account. The
 *   MANIFEST is ONE memory record, public, so a game loads its own library signed out through
 *   AIMEAT.data.getPublic(ownerGhii, key). The CODE is this library, which holds neither.
 *
 *   ONE KEY, NOT ONE PER FILE. The node allows 1024 kB per memory value and 1000 keys per person,
 *   so a key per sprite spends a person's whole allowance on one game. The manifest is a record
 *   that a person opens as a unit, which is exactly what a memory value is for.
 *
 *   NOTHING RUNS ON ITS OWN. There is no polling, no background sync and no cache warming here.
 *   check() reaches the network, uploads reach the network, packAtlas() loads the pictures it was
 *   handed, and a gallery draws the images it shows. Everything else is local.
 * @structure the AIMEAT.assets surface, assembled from manifest.js · library.js · upload.js ·
 *   pack.js · sound.js · preview.js (texts.js sits behind library.t)
 * @usage
 *   <link rel="stylesheet" href="/lib/aimeat-assets.css">
 *   <script src="/v1/libs/aimeat-assets.js"></script>
 *   const lib = AIMEAT.assets.library({ app: 'ridge' });
 *   await lib.load();
 *   AIMEAT.phaser.preloadPack(this, lib.toPack());
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the manifest, the library, uploads, the atlas packer, the WAV
 *     renderer and the gallery.
 */
import { attach } from '../_core/namespace.js';
import { manifest, MANIFEST_SPEC, KINDS, absolute } from './manifest.js';
import { library } from './library.js';
import { upload, publicAddress } from './upload.js';
import { packAtlas } from './pack.js';
import { sound } from './sound.js';
import { preview } from './preview.js';

const assets = {
  /**
   * The library version. It MUST match the newest entry in /lib/aimeat-assets.css's version
   * history; e2e-libs.ts fails when the two drift, because a version string that never moves is
   * worse than none.
   */
  version: '1.0.0',

  /** The shape name every manifest carries, so a record found in memory explains itself. */
  spec: MANIFEST_SPEC,

  /** The kinds of file a manifest holds, in the order a listing shows them. */
  kinds: KINDS,

  // ── The record ──
  manifest, library,

  // ── Files in and out ──
  upload, publicAddress, absolute,

  // ── Making assets rather than collecting them ──
  packAtlas, sound,

  // ── Seeing what you have ──
  preview,
};

attach('assets', assets);
