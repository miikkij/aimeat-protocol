/**
 * @file app-draft-edit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Incremental editing of an app's draft slot, so an agent can build and iterate on a
 *   400 kB app without a filesystem and without pushing the whole file through its context.
 *
 *   The problem this solves is not size. A 400 kB app fits every body limit on this node. It is that
 *   no model emits 400 kB in one response, so a local agent writes the file to disk in pieces with
 *   its editor tools and uploads it afterwards. A server-side agent has no disk and is deliberately
 *   given no shell, because one process serves many owners. The draft slot is already a database row
 *   with a byte buffer on both backends, so it is the disk: append to it, do targeted replacements
 *   in it, read slices of it, and seed it from a published version.
 *
 *   Every write goes through stageAppDraft(), which is the same function PUT /v1/apps/:owner/:file/draft
 *   and aimeat_app_draft_save call. That keeps the filename rule, the size ceiling and the manifest
 *   inheritance in one place, and it is why the size check happens BEFORE anything is written.
 *
 *   Content is plain UTF-8 text, not base64. An app is HTML, the model emits it as text either way,
 *   and base64 would inflate the tool call by a third for nothing.
 * @structure
 *   - writeAppDraft()     — append to, or replace, the draft's bytes
 *   - replaceInAppDraft() — targeted old→new replacement with a uniqueness check
 *   - readAppDraft()      — a line range, never the whole file by accident
 *   - seedAppDraft()      — copy a published version's bytes into the draft, server-side
 * @usage
 *   const out = await writeAppDraft(storage, config, {
 *     ownerName, ownerGhii, filename: 'pong.html', content: '<!doctype html>…', mode: 'append',
 *   });
 *   if ('refusal' in out) { res.status(out.refusal.status).json(error(...)); return; }
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial implementation. Four operations so a hosted agent can build an app
 *     larger than one model response, and continue one it published a week ago (aimeat_app_get does
 *     not return source, and stageAppDraft only ever took bytes from its caller).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppDraftRecord } from '../storage/interface.js';
import type { PublishAppRefusal } from './app-publish.js';
import {
  stageAppDraft, type DraftManifestRequest, type StagedAppDraft,
} from './app-lifecycle.js';

/** The owner whose draft slot is being edited, already resolved from the principal at the door. */
export interface AppDraftEditScope {
  ownerName: string;
  ownerGhii: string;
}

/** Default number of lines readAppDraft() returns when the caller does not say. */
export const DRAFT_READ_DEFAULT_LINES = 400;
/** Hard ceiling on lines per read, so one call cannot pull a whole app into context. */
export const DRAFT_READ_MAX_LINES = 2000;
/**
 * Hard ceiling on characters per read. Below the MCP layer's own 100k truncation on purpose: a slice
 * that gets cut by the transport loses its tail silently, and a caller doing a replacement against a
 * silently truncated read would target text it never actually saw.
 */
export const DRAFT_READ_MAX_CHARS = 60_000;

export interface WriteAppDraftInput extends AppDraftEditScope {
  filename: string;
  /** The text to write. UTF-8, not base64. */
  content: string;
  /** `append` adds to the end (the default); `replace` overwrites the whole draft. */
  mode?: 'append' | 'replace';
  /**
   * Optional lost-update guard: the size the caller believes the draft currently has. A mismatch
   * refuses instead of writing, which is the only way a caller building a file across many calls can
   * notice that something else moved underneath it.
   */
  expectedSizeBytes?: number;
  /** Manifest fields, only meaningful when the draft is being created. */
  requested?: DraftManifestRequest;
}

export interface ReplaceInAppDraftInput extends AppDraftEditScope {
  filename: string;
  oldString: string;
  newString: string;
  /** Replace every occurrence instead of requiring exactly one. */
  replaceAll?: boolean;
}

export interface ReadAppDraftInput extends AppDraftEditScope {
  filename: string;
  /** First line to return, 1-based. Defaults to 1. */
  offset?: number;
  /** How many lines to return. Defaults to DRAFT_READ_DEFAULT_LINES. */
  limit?: number;
}

export interface SeedAppDraftInput extends AppDraftEditScope {
  /** The draft to write into. */
  filename: string;
  /** The published app to copy from. Defaults to `filename`. */
  fromFilename?: string;
  /** Which published version. Defaults to the newest. */
  version?: number;
}

export interface AppDraftSlice {
  filename: string;
  sizeBytes: number;
  totalLines: number;
  /** 1-based, inclusive. */
  fromLine: number;
  toLine: number;
  /** True when lines remain after `toLine`, or when the slice hit the character ceiling. */
  hasMore: boolean;
  content: string;
  mimeType: string;
  updatedAt: string;
}

export interface ReplacedAppDraft extends StagedAppDraft {
  /** How many occurrences were actually replaced. */
  replacements: number;
}

export interface SeededAppDraft extends StagedAppDraft {
  seededFrom: string;
  seededVersion: number;
}

function refuse(status: number, code: string, message: string): PublishAppRefusal {
  return { refusal: { status, code, message } };
}

/**
 * Load the draft, or refuse with an answer that says what to do about it. Every operation except
 * the creating write needs a draft to exist, and "not found" is the most common state a caller hits
 * on its first attempt, so the message names both ways out.
 */
async function requireDraft(
  storage: Storage, ownerGhii: string, filename: string,
): Promise<AppDraftRecord | PublishAppRefusal> {
  const draft = await storage.getAppDraft(ownerGhii, filename);
  if (!draft) {
    return refuse(
      404, 'NO_DRAFT',
      `No draft for "${filename}". Start one with a write in mode "replace", or copy the published `
      + 'version into the slot first.',
    );
  }
  return draft;
}

/**
 * Carry the draft's own manifest forward. stageAppDraft() falls back to the LIVE app's manifest,
 * which is right on the publish path and wrong here: a draft created before the app was ever
 * published has a manifest of its own, and an append that did not pass it would quietly rename the
 * app back to its filename on the second chunk.
 */
function carryManifest(
  draft: AppDraftRecord | null, requested?: DraftManifestRequest,
): DraftManifestRequest {
  const base = draft?.manifest;
  const carried: DraftManifestRequest = {
    name: requested?.name ?? base?.name,
    description: requested?.description ?? base?.description,
    category: requested?.category ?? base?.category,
    tags: requested?.tags ?? base?.tags,
    icon: requested?.icon ?? base?.icon,
    usesCortex: requested?.usesCortex ?? base?.usesCortex,
    protection: requested?.protection ?? base?.protection,
    mimeType: requested?.mimeType ?? draft?.mimeType,
  };
  return carried;
}

/**
 * Append to, or replace, the draft's bytes.
 *
 * The size ceiling is enforced by stageAppDraft() before it writes, so a chunk that would push the
 * draft past the limit leaves the previous content intact rather than truncating it.
 */
export async function writeAppDraft(
  storage: Storage, config: AimeatConfig, input: WriteAppDraftInput,
): Promise<StagedAppDraft | PublishAppRefusal> {
  const { ownerName, ownerGhii, filename, content } = input;
  const mode = input.mode ?? 'append';

  if (typeof content !== 'string') {
    return refuse(400, 'INVALID_CONTENT', 'content must be a string of UTF-8 text.');
  }

  const draft = await storage.getAppDraft(ownerGhii, filename);
  const current = draft?.data ?? Buffer.alloc(0);

  if (input.expectedSizeBytes !== undefined && input.expectedSizeBytes !== current.length) {
    return refuse(
      409, 'DRAFT_CHANGED',
      `Draft is ${current.length} bytes, not the expected ${input.expectedSizeBytes}. `
      + 'Read it again before writing.',
    );
  }

  const addition = Buffer.from(content, 'utf8');
  const next = mode === 'append' ? Buffer.concat([current, addition]) : addition;

  return stageAppDraft(storage, config, {
    ownerName, ownerGhii, filename,
    data: next,
    requested: carryManifest(draft, input.requested),
  });
}

/**
 * Replace `oldString` with `newString` inside the draft.
 *
 * Without `replaceAll` the match must be unique. Both refusals carry the actual count, because the
 * caller's next move differs: zero means the text is not there at all, and more than one means it
 * has to widen the surrounding context until the target is unambiguous. A count-free "did not work"
 * turns that into guessing.
 */
export async function replaceInAppDraft(
  storage: Storage, config: AimeatConfig, input: ReplaceInAppDraftInput,
): Promise<ReplacedAppDraft | PublishAppRefusal> {
  const { ownerName, ownerGhii, filename, oldString, newString } = input;

  if (!oldString) {
    return refuse(400, 'INVALID_MATCH', 'old_string must not be empty.');
  }
  if (oldString === newString) {
    return refuse(400, 'INVALID_MATCH', 'old_string and new_string are identical; nothing to do.');
  }

  const found = await requireDraft(storage, ownerGhii, filename);
  if ('refusal' in found) return found;

  const text = found.data.toString('utf8');
  const parts = text.split(oldString);
  const occurrences = parts.length - 1;

  if (occurrences === 0) {
    return refuse(
      404, 'NOT_FOUND',
      `old_string does not appear in the draft for "${filename}". Read the surrounding lines and `
      + 'match the text exactly, including indentation.',
    );
  }
  if (occurrences > 1 && !input.replaceAll) {
    return refuse(
      409, 'NOT_UNIQUE',
      `old_string appears ${occurrences} times in "${filename}". Include more surrounding text so `
      + 'the match is unique, or set replace_all.',
    );
  }

  const replacements = input.replaceAll ? occurrences : 1;
  const nextText = input.replaceAll
    ? parts.join(newString)
    : text.replace(oldString, newString);

  const staged = await stageAppDraft(storage, config, {
    ownerName, ownerGhii, filename,
    data: Buffer.from(nextText, 'utf8'),
    requested: carryManifest(found),
  });
  if ('refusal' in staged) return staged;

  return { ...staged, replacements };
}

/**
 * Return a line range of the draft.
 *
 * Bounded twice on purpose. A caller that asks for everything gets the first page and a `hasMore`
 * flag rather than a whole app in its context, and a slice that would exceed the character ceiling
 * is cut at a line boundary with the same flag set, so a later replacement is never aimed at text
 * the caller only half received.
 */
export async function readAppDraft(
  storage: Storage, input: ReadAppDraftInput,
): Promise<AppDraftSlice | PublishAppRefusal> {
  const { ownerGhii, filename } = input;

  const found = await requireDraft(storage, ownerGhii, filename);
  if ('refusal' in found) return found;

  const text = found.data.toString('utf8');
  const lines = text.split('\n');
  const totalLines = lines.length;

  const rawOffset = Math.trunc(input.offset ?? 1);
  if (Number.isNaN(rawOffset) || rawOffset < 1) {
    return refuse(400, 'INVALID_RANGE', 'offset is a 1-based line number and must be at least 1.');
  }
  const rawLimit = Math.trunc(input.limit ?? DRAFT_READ_DEFAULT_LINES);
  if (Number.isNaN(rawLimit) || rawLimit < 1) {
    return refuse(400, 'INVALID_RANGE', 'limit must be at least 1.');
  }

  const fromLine = Math.min(rawOffset, totalLines);
  const limit = Math.min(rawLimit, DRAFT_READ_MAX_LINES);

  const slice: string[] = [];
  let chars = 0;
  let toLine = fromLine - 1;
  for (let i = fromLine - 1; i < totalLines && slice.length < limit; i++) {
    const line = lines[i]!;
    // +1 for the newline that rejoins them; stop BEFORE exceeding so the slice is whole lines.
    if (chars > 0 && chars + line.length + 1 > DRAFT_READ_MAX_CHARS) break;
    slice.push(line);
    chars += line.length + 1;
    toLine = i + 1;
  }

  return {
    filename,
    sizeBytes: found.size,
    totalLines,
    fromLine,
    toLine,
    hasMore: toLine < totalLines,
    content: slice.join('\n'),
    mimeType: found.mimeType,
    updatedAt: found.updatedAt,
  };
}

/**
 * Copy a published version's bytes into the draft slot.
 *
 * The bytes never leave the server. Without this an app published a week ago cannot be continued at
 * all through MCP: aimeat_app_get returns the manifest and no source, and stageAppDraft has always
 * taken its bytes from the caller.
 */
export async function seedAppDraft(
  storage: Storage, config: AimeatConfig, input: SeedAppDraftInput,
): Promise<SeededAppDraft | PublishAppRefusal> {
  const { ownerName, ownerGhii, filename } = input;
  const from = input.fromFilename ?? filename;

  const live = await storage.getApp(ownerGhii, from, input.version);
  if (!live) {
    return refuse(
      404, 'NOT_FOUND',
      input.version
        ? `No version ${input.version} of "${from}" in your catalogue.`
        : `No published app "${from}" in your catalogue.`,
    );
  }

  // The SOURCE app's manifest is the base, which matters when seeding under a different filename:
  // stageAppDraft would otherwise inherit from whatever lives at the destination name.
  const staged = await stageAppDraft(storage, config, {
    ownerName, ownerGhii, filename,
    data: live.data,
    requested: {
      name: live.manifest.name,
      description: live.manifest.description,
      category: live.manifest.category,
      tags: live.manifest.tags,
      icon: live.manifest.icon,
      usesCortex: live.manifest.usesCortex,
      protection: live.manifest.protection,
      mimeType: live.mimeType,
    },
  });
  if ('refusal' in staged) return staged;

  return { ...staged, seededFrom: from, seededVersion: live.versionNumber };
}
