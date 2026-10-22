/**
 * @file src/services/app-publish-delegate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app settings a developer of another account may not change when they publish the
 *   owner's app under a development right (services/app-dev-grant.ts). publishApp asks it above its
 *   dry-run return, so a dry run answers what the real publish answers, and every publish route
 *   (inline, presigned upload, draft, restore, MCP) gets the same answer from the one function.
 *
 *   The pacing amount and the licence are never a delegate's to change. Protection, bundled cortex
 *   agents, usesCortex and the access code need the `operate` act (the full right). So does the
 *   ?format=md handler (services/app-format-md.ts formatMdDelegateRefusal): which of the owner's
 *   extension actions the node runs in the owner's name for every reader.
 * @structure DelegatedSettingsInput · delegatedSettingsRefusal(input)
 * @usage
 *   const refused = delegatedSettingsRefusal({ ownerName, level, requested, prev, liveAccessCode, accessCode, formatMd });
 *   if (refused) return { refusal: refused };
 * @version-history
 *   v1.0.0 — 2026-10-22 — Extracted unchanged from app-publish.ts (line limit), with the ?format=md
 *     rule added after it (secaudit 2026-10, r54).
 */
import { isDeepStrictEqual } from 'node:util';
import { mayAct } from './app-dev-grant.js';
import { formatMdDelegateRefusal, type FormatMdDeclaration } from './app-format-md.js';
import type { AppManifest, AppProtection } from '../storage/interface.js';

export interface DelegatedSettingsInput {
  /** Bare owner name of the app. */
  ownerName: string;
  /** The caller's development rung on this app (effectiveDevLevel). */
  level: number;
  /** The manifest fields the caller stated; `undefined` means not mentioned (app-publish.ts RequestedManifest). */
  requested: {
    tollMorsels?: number; licenseType?: AppManifest['licenseType']; protection?: AppProtection;
    cortexAgents?: Record<string, unknown>[]; usesCortex?: string[];
  };
  /** The live version's manifest, undefined on a first publish. */
  prev: AppManifest | undefined;
  liveAccessCode: string | undefined;
  accessCode: { mode: 'explicit'; value?: string } | { mode: 'carry' };
  /** The ?format=md declaration read from the new bytes, already checked as usable. */
  formatMd: FormatMdDeclaration | null;
}

/** Why this delegated publish may not go through, or null when it may. */
export function delegatedSettingsRefusal(input: DelegatedSettingsInput): { status: number; code: string; message: string } | null {
  const { requested, prev, level } = input;
  const forbidden = (requested.tollMorsels !== undefined && requested.tollMorsels !== (prev?.tollMorsels ?? 0))
    || (requested.licenseType !== undefined && requested.licenseType !== prev?.licenseType)
    || (!mayAct(level, 'operate') && (
      (requested.protection !== undefined && !isDeepStrictEqual(requested.protection, prev?.protection ?? {}))
      || (requested.cortexAgents !== undefined && !isDeepStrictEqual(requested.cortexAgents, prev?.cortex?.agents ?? []))
      || (requested.usesCortex !== undefined && !isDeepStrictEqual(requested.usesCortex, prev?.usesCortex ?? []))
      || (input.accessCode.mode === 'explicit' && input.accessCode.value !== input.liveAccessCode)
    ));
  if (forbidden) return { status: 403, code: 'FORBIDDEN', message: 'Your development right does not permit changing these app settings.' };
  const formatMd = formatMdDelegateRefusal({ ownerName: input.ownerName, decl: input.formatMd, live: prev?.formatMd, mayOperate: mayAct(level, 'operate') });
  return formatMd ? { status: 403, code: 'FORBIDDEN', message: formatMd } : null;
}
