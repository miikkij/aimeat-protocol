/**
 * @file src/data/library-packs/types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three shapes a library pack is described by: the pack itself, one entry of its
 *   changelog, and one recorded AEB proof. A leaf module, so the six pack lists under this
 *   directory can name their own type without standing in a cycle with library-packs.ts, which
 *   re-exports all three because every caller in the repo asks that file for them.
 *
 *   RECONSTRUCTED, NOT AUTHORED. c932f2f17 (feat(worksheet), 2026-09-05) moved these three
 *   interfaces out of library-packs.ts into this file and re-pointed eight imports at it — and
 *   committed the eight edits without the new file. The pre-commit hook reads the worktree, where
 *   the untracked file existed, so it passed; every other checkout then failed to typecheck
 *   (LibraryPack resolved to `any`) and, because sdk.ts also value-imports ./sdk-science.js, failed
 *   to BOOT. The body below is the text of those interfaces as they stood in library-packs.ts at
 *   the commit before the move, taken from git history and unchanged, so nothing here is a guess
 *   about what the author meant. → docs/pitfalls.md on the hook reading the worktree.
 * @structure PackChange · PackProof · LibraryPack
 * @version-history
 *   v1.0.0 — 2026-09-05 — Restored from history after c932f2f17 shipped without it.
 */

export interface PackChange {
  /** The pack version this entry describes. */
  version: string;
  /** ISO date of the change. */
  date: string;
  /** Written FOR AN AI reading it later: what changed and what it means for existing apps. */
  summary: string;
  /** Present ONLY when existing apps must change something (rare — majors ship as new files). */
  breaking?: string;
}

/**
 * One recorded AEB proof: the pack run on ONE model, against a shared test set.
 * The ledger is append-only — a new model's run adds an entry, never overwrites another.
 * See tools/aeb/acceleration-tiers.md ("Add your own proof") for how these are produced.
 */
export interface PackProof {
  /** Model id the run used, e.g. 'claude-haiku-4-5', 'claude-opus-4-8'. */
  model: string;
  /** Did the pack accelerate/render on this model, per the checklist + browser verify. */
  verdict: 'pass' | 'fail';
  /** The shared test set id under tools/aeb/specs/, e.g. 'pixi' → pixi.spec.md + pixi.checklist.md. */
  testSet: string;
  /** Repo-relative evidence file (tokens, checklist, browser findings), e.g. 'tools/aeb/results/aeb3-pixi-perpack.md'. */
  evidence: string;
  /** Output tokens the treatment arm spent, when recorded. */
  tokens?: number;
  /** ISO date of the run. */
  date: string;
}

export interface LibraryPack {
  /** Stable id, e.g. 'chartjs', 'aimeat-charts', 'styling'. */
  id: string;
  /** sdk = /v1/libs wrapper · cortex = node-bundled cortex lib · vendored = /lib third-party · bundle = multi-file set. */
  kind: 'sdk' | 'cortex' | 'vendored' | 'bundle';
  category: 'core' | 'ai' | 'ui' | 'visualization' | 'diagrams' | 'canvas' | 'game' | '3d' | 'maps' | 'realtime' | 'economy' | 'media';
  title: string;
  /** One line (English) — shown in the index, catalogue and pack pickers. */
  description: string;
  /** Canonical path of the main file (root-relative). */
  url: string;
  /** Exact include line(s) in load order; {{BASE_URL}} is substituted at render time. */
  include: string[];
  /** Pack ids this pack needs loaded first. */
  requires: string[];
  /** Pinned version (vendored/bundle) or the cortex spec.version. SDK packs omit it (always served live from the node). */
  version?: string;
  /** The frozen-major filename contract, e.g. 'chartjs@4' — see public/lib/VENDORED.md. */
  majorPin?: string;
  license: string;
  sourceUrl?: string;
  /** The global/API namespace an app talks to, e.g. 'AIMEAT.charts', 'window.Phaser'. */
  apiSurface: string;
  /** The acceleration payload: a 10–40 line usage doc an AI reads BEFORE writing code with the pack. */
  aiDoc: string;
  /** What changed and what it means for existing apps — newest last. */
  changelog: PackChange[];
  /** app-templates id of the demo that proves the pack (required for status 'stable'). */
  demoTemplateId?: string;
  /** node:-scoped skill carrying deep docs (@semver-pinnable), when the aiDoc is not enough. */
  skillRef?: string;
  /** Which app-shell tier the pack implies (cortex packs → T2 shell). */
  tierHint: 'T1' | 'T2' | 'T3';
  /** Idea-text keywords that pre-select this pack in the interview / catalog picker. */
  interviewTriggers: string[];
  sizeEstimate: string;
  /** stable REQUIRES a demo template + a recorded AEB acceleration result. */
  status: 'preview' | 'stable' | 'deprecated';
  /**
   * The pack id that replaces this one, on a deprecated pack. `phaser` → `phaser4`.
   *
   * WITHOUT IT, DEPRECATION ONLY SAYS STOP. That is half an instruction: a model told not to use
   * phaser 3 has no way to learn that phaser 4 sits on the same node under a different id, so it
   * either uses the deprecated pack anyway or writes the game without one. The deprecation is also
   * the ONLY moment this can be said, because the old pack is what an existing app still names.
   */
  supersededBy?: string;
  /** Where the pack is seen working (the Design Book, a showcase app): a public address, when one exists. */
  showcaseUrl?: string;
  /**
   * The strongest model-strength this pack is reliably-and-accelerated on — a WARNING label, not a
   * gate (an unlabelled pack still ships). Driven by API-version drift from training data:
   *   'any'       — pin == the API models know; a mid-tier model codes it correctly from memory.
   *   'frontier'  — breaking API vs the version most examples show; weak models write the old API
   *                 from memory and crash → carry an `apiCaveat` and prefer forcing the ai_doc.
   *   'needs-doc' — AIMEAT-authored/wrapper, no training-data priors; must fetch the ai_doc to use
   *                 it at all (no crash, just a silent no-op if skipped).
   * Derivable from `proofs` (strongest model with a 'pass'); set explicitly until proofs exist.
   * Full scheme + how a pack earns this: tools/aeb/acceleration-tiers.md.
   */
  modelTier?: 'any' | 'frontier' | 'needs-doc';
  /**
   * The per-model AEB proof ledger — which models this pack has actually been demonstrated on.
   * Lets a client/pipeline pick a pack proven on the model it is about to use. Append-only.
   */
  proofs?: PackProof[];
  /**
   * For `modelTier:'frontier'` packs ONLY: the one-line breaking-API idiom a weak model gets wrong
   * from stale memory. The build-app prompt INLINES this next to the pack (so a model that skips the
   * ai_doc still gets corrected), e.g. pixi's "v8 Graphics chains .rect().fill(), NOT beginFill()/
   * drawRect() (v7, removed)". Keep it to the single most load-bearing gotcha.
   */
  apiCaveat?: string;
  /** Exact line used in the build-app prompt (sdk/cortex packs that the prompt lists). */
  promptLine?: string;
  /** Build-app-prompt grouping for sdk packs. */
  promptGroup?: 'core' | 'ai' | 'economy' | 'media';
}
