/**
 * @file src/services/app-design-spec.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design spec of an app: one markdown document kept beside the app, written and
 *   read by the people who build it.
 *
 *   WHY IT EXISTS (Jouni, 2026-10-02). A developer shared the right to build an app with him, and
 *   nothing anywhere said what the app was for, how it was put together or what had been decided.
 *   The roadmap says what changed, one line per version; the audit log says which settings were
 *   touched; the source says what the code does today. None of them says what the app IS, so a
 *   second builder reads the whole source to find out, and an AI asked to change the app starts
 *   from nothing every time. The spec is that missing document, and it lives beside the app so
 *   every builder and every builder's AI finds it in the same place.
 *
 *   BESIDE THE APP, LIKE THE ROADMAP. The same storage shape as services/app-roadmap.ts: a record
 *   in a platform namespace, keyed by the app id, written with a compare-and-swap so two builders'
 *   AIs cannot overwrite each other unseen, and a stamp on the manifest so a listing can say when
 *   the spec was last written without loading the prose.
 *
 *   STALE BY APP VERSION. The record carries the app version that was live when it was written.
 *   A publish that moves the app past that version makes the spec stale, and the publish response
 *   says so (designSpecHint); writing the same text again marks it current for the new version
 *   without a new revision, so confirming a spec costs one call. It is a hint, never a refusal: a
 *   publish refused over a document is a publish worked around, and the app then ships with less
 *   care rather than more (the same reasoning as services/app-spec-gate.ts).
 *
 *   WHO READS IT. The owner and everybody holding a development right (services/app-dev-grant.ts,
 *   any rung). It is a builder's document: it names data keys, decisions and open questions, which
 *   are not a shop window. Opening it to readers outside the build is a later decision.
 * @structure
 *   - AppDesignSpec / AppDesignSpecStamp / APP_DESIGN_SPEC_SPEC / APP_DESIGN_SPEC_MAX_BYTES — the record
 *   - APP_DESIGN_SPEC_TEMPLATE — the outline a first spec starts from
 *   - appDesignSpecKey / readAppDesignSpec / writeAppDesignSpec / deleteAppDesignSpec — storage
 *   - checkDesignSpecMarkdown — what a write accepts
 *   - designSpecStamp / isDesignSpecStale / designSpecHint / designSpecMeaning — what a reader is told
 * @usage
 *   const spec = await readAppDesignSpec(storage, 'alice/paja.html');
 *   const out = await writeAppDesignSpec(storage, { appId, markdown, by, principal, appVersion });
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */
import type { Storage } from '../storage/interface.js';
import { appKeySegment, readAppRecord, equalAppId } from './app-record-keys.js';

export const APP_DESIGN_SPEC_SPEC = 'aimeat.appdesignspec/1' as const;

/** The most bytes one spec may hold, UTF-8. Sixty-four kilobytes is twenty pages of prose. */
export const APP_DESIGN_SPEC_MAX_BYTES = 65536;

/** The platform's own namespace, so the record is not writable through the memory API. */
const NS_SPEC = 'app-design-spec';

export interface AppDesignSpec {
  spec: typeof APP_DESIGN_SPEC_SPEC;
  appId: string;
  /** The document. Markdown, LF line ends, at most APP_DESIGN_SPEC_MAX_BYTES. */
  markdown: string;
  /** The account that last wrote it. */
  updatedBy: string;
  /** The principal that last wrote it (GHII, GAII or GEAI): whether a person or an agent did. */
  updatedByPrincipal: string;
  updatedAt: string;
  /** The app version that was live when it was last written or confirmed. */
  version: number;
  /** This document's own counter, from 1. A write may name the revision it expects to replace. */
  revision: number;
  createdAt: string;
}

/** What the manifest carries, so a listing never has to load the prose. */
export interface AppDesignSpecStamp {
  at: string;
  by: string;
  version: number;
  revision: number;
  bytes: number;
}

/**
 * The outline a first spec starts from. The headings are the questions a second builder asks in
 * the order they ask them; the line under each says what goes there. English, because the spec is
 * read by every builder's AI and the builders choose the language of what they write under it.
 */
export const APP_DESIGN_SPEC_TEMPLATE = `# Design spec

## Purpose
Who this app is for, and the one job it does for them.

## Screens
Each screen or view: what it shows, and what a person can do there.

## Data
Where the app keeps its records (memory keys, workspaces and their contracts), what each record holds, and who may read and write it.

## Rules and decisions
What was decided and why. A decision written here is settled: change it here before changing the code.

## AI and agents
What the app asks a model to do, the agents it ships, and what they may touch.

## Open questions
What is not settled yet, and what is waiting on whom.

## Traps
What bit a builder of this app, so the next one does not meet it again.
`;

export const appDesignSpecKey = (appId: string) => `appdesignspec.${appKeySegment(appId)}`;

/** This app's design spec, or null when nobody has written one. Null is a real answer. */
export async function readAppDesignSpec(storage: Storage, appId: string): Promise<AppDesignSpec | null> {
  const rec = await readAppRecord(storage, NS_SPEC, appDesignSpecKey(appId), appId);
  const v = rec?.value as AppDesignSpec | undefined;
  if (!v || v.spec !== APP_DESIGN_SPEC_SPEC || !equalAppId(v.appId, appId)) return null;
  return v;
}

/**
 * What a write accepts: a string, line ends normalised to LF, trailing whitespace off, at least a
 * few characters, and under the byte ceiling. The refusal is the sentence the caller sees.
 */
export function checkDesignSpecMarkdown(input: unknown): { ok: true; markdown: string } | { ok: false; message: string } {
  if (typeof input !== 'string') return { ok: false, message: 'markdown is required: the whole design spec as one markdown document.' };
  const markdown = input.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim() + '\n';
  if (markdown.trim().length < 3) return { ok: false, message: 'markdown is required: the whole design spec as one markdown document.' };
  const bytes = Buffer.byteLength(markdown, 'utf8');
  if (bytes > APP_DESIGN_SPEC_MAX_BYTES) {
    return { ok: false, message: `The design spec is ${bytes} bytes; the most it may hold is ${APP_DESIGN_SPEC_MAX_BYTES}. Shorten it, or move the long part into a workspace document and link it.` };
  }
  return { ok: true, markdown };
}

/**
 * Write the whole document. Returns the record as written, or the record that is there when the
 * caller named a revision it expected to replace and that is not the one stored.
 *
 * THE SAME TEXT AGAIN IS A CONFIRMATION: the revision stays, the version becomes the app's live
 * version, and the writer and time are recorded. That is how a builder says "still true at v13"
 * for the price of one call, which is what the publish hint asks for.
 */
export async function writeAppDesignSpec(
  storage: Storage,
  input: { appId: string; markdown: string; by: string; principal: string; appVersion: number; expectedRevision?: number },
): Promise<{ spec: AppDesignSpec; replacedRevision: number | null; unchanged: boolean } | { conflict: AppDesignSpec }> {
  if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) throw new Error('Design spec writes require atomic storage.');
  for (let attempt = 0; attempt < 40; attempt++) {
    const existing = await readAppRecord(storage, NS_SPEC, appDesignSpecKey(input.appId), input.appId);
    const current = existing?.value as AppDesignSpec | undefined;
    const live = current && current.spec === APP_DESIGN_SPEC_SPEC ? current : null;
    if (typeof input.expectedRevision === 'number' && (live?.revision ?? 0) !== input.expectedRevision) {
      return { conflict: live ?? emptySpec(input.appId) };
    }
    const now = new Date().toISOString();
    const unchanged = !!live && live.markdown === input.markdown;
    const spec: AppDesignSpec = {
      spec: APP_DESIGN_SPEC_SPEC,
      appId: input.appId,
      markdown: input.markdown,
      updatedBy: input.by,
      updatedByPrincipal: input.principal,
      updatedAt: now,
      version: input.appVersion,
      revision: unchanged ? live.revision : (live?.revision ?? 0) + 1,
      createdAt: live?.createdAt ?? now,
    };
    const record = {
      key: appDesignSpecKey(input.appId), ownerGaii: NS_SPEC, value: spec,
      visibility: 'private' as const, tags: ['app-design-spec'], ttlHours: null,
      version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    const saved = existing
      ? await storage.setMemoryIfVersion(record, existing.version)
      : await storage.createMemoryIfAbsent(record);
    if (saved) return { spec, replacedRevision: live?.revision ?? null, unchanged };
  }
  throw new Error('The design spec changed repeatedly. Retry this write.');
}

/** Take the document away. Returns whether there was one. */
export async function deleteAppDesignSpec(storage: Storage, appId: string): Promise<boolean> {
  const existing = await readAppRecord(storage, NS_SPEC, appDesignSpecKey(appId), appId);
  if (!existing) return false;
  await storage.deleteMemory(NS_SPEC, appDesignSpecKey(appId));
  return true;
}

function emptySpec(appId: string): AppDesignSpec {
  const now = new Date().toISOString();
  return {
    spec: APP_DESIGN_SPEC_SPEC, appId, markdown: '', updatedBy: '', updatedByPrincipal: '',
    updatedAt: now, version: 0, revision: 0, createdAt: now,
  };
}

/** The manifest's copy: enough for a listing and for the publish hint, never the prose. */
export function designSpecStamp(spec: AppDesignSpec | null): AppDesignSpecStamp | undefined {
  if (!spec) return undefined;
  return {
    at: spec.updatedAt, by: spec.updatedBy, version: spec.version, revision: spec.revision,
    bytes: Buffer.byteLength(spec.markdown, 'utf8'),
  };
}

/** Was the app published past the version the spec was written or confirmed against? */
export function isDesignSpecStale(spec: { version: number } | null | undefined, appVersion: number): boolean {
  return !!spec && spec.version < appVersion;
}

/**
 * What a publish response says about the spec. Undefined when there is nothing to say: an app one
 * person builds alone, with no spec, gets no separate hint here, because next_steps says it
 * (`design_spec`, app-publish-next-steps.ts, since 2026-10-10; until then this comment claimed
 * next_steps listed it and it did not). A shared app without a spec is told once per publish, because the people who
 * lose by its absence are the other builders. A stale spec is told on every app, because the
 * question "did this change alter what the spec describes?" has to be asked of whoever published.
 */
export function designSpecHint(input: { stamp: AppDesignSpecStamp | undefined; newVersion: number; shared: boolean }): string | undefined {
  if (!input.stamp) {
    if (!input.shared) return undefined;
    return 'This app is built by more than one person and has no design spec yet. Write one with '
      + 'aimeat_app_manage { action: "spec_set", owner, filename, markdown }: what the app is for, its screens, '
      + 'where its data lives, the decisions made and what is open. The people building it with you read it '
      + 'before they change anything; the action "spec" answers an outline to start from.';
  }
  if (!isDesignSpecStale(input.stamp, input.newVersion)) return undefined;
  return `The design spec was written against version ${input.stamp.version}; this publish made version ${input.newVersion}. `
    + 'Read it with aimeat_app_manage { action: "spec" } and, when this change altered what it describes, update it with '
    + '{ action: "spec_set" }. Sending the same text again marks it current for this version.';
}

/** The sentence a reader of the spec gets with it. */
export function designSpecMeaning(spec: AppDesignSpec | null, appVersion: number): string {
  if (!spec) {
    return 'Nobody has written one yet. A write with `markdown` starts it; `template` is the outline to start from. '
      + 'Say what the app is for, its screens, where its data lives, what was decided and what is open.';
  }
  if (isDesignSpecStale(spec, appVersion)) {
    return `Written against version ${spec.version}; the app is at version ${appVersion}. Read it, then confirm it `
      + '(write the same text) or update it, so the next builder reads a document that describes the app as it is.';
  }
  return `Describes the app as it is at version ${spec.version}. Read it before you change the app, and write it back `
    + 'with what changed after you publish.';
}
