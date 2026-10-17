/**
 * @file src/services/app-publish-exposure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How exposed a published version is: listed or not, forkable or not, its access code
 *   and who may open it. An UPDATE carries the live version's state forward, so a new version never
 *   silently re-exposes a parked app, opens forking, drops a code or a sign-in. A FIRST publish takes
 *   the node's defaults for a new app (config apps.default_listing, apps.default_access,
 *   apps.default_access_code; plan doc-mvcn6c7e4e5q V2.4). Its own file because app-publish.ts is at
 *   the line ceiling.
 * @structure publishExposure() · generateAccessCode()
 * @usage const { parked, community, forkable, accessCode, access } = publishExposure(config, live, input.accessCode);
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (moved the carry-forward out of app-publish.ts and added the first-publish defaults).
 */
import { randomBytes } from 'node:crypto';
import type { AppRecord } from '../storage/interface.js';

/** The access-code part of a publish request: the caller named a code (or none), or said nothing. */
export type PublishAccessCodeInput = { mode: 'explicit'; value?: string } | { mode: 'carry' };

export interface PublishExposure {
  parked: boolean;
  community: boolean;
  forkable: boolean;
  accessCode: string | undefined;
  /** Who may open it, as stored: undefined for anyone, 'signed-in', or 'organism:<id>'. */
  access: string | undefined;
}

/** An access code a person can type: eight characters without look-alikes. */
export function generateAccessCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function publishExposure(
  config: { appDefaultListing?: 'listed' | 'community' | 'unlisted'; appDefaultAccess?: 'anyone' | 'signed-in'; appDefaultAccessCode?: boolean },
  live: AppRecord | null | undefined,
  codeInput: PublishAccessCodeInput,
): PublishExposure {
  const explicit = codeInput.mode === 'explicit' ? codeInput.value : undefined;
  if (live) {
    return {
      parked: !!live.parked,
      community: !!live.parked && !!live.community,
      forkable: !!live.forkable,
      accessCode: codeInput.mode === 'explicit' ? explicit : live.accessCode,
      access: live.access ?? undefined,
    };
  }
  const listing = config.appDefaultListing ?? 'listed';
  return {
    parked: listing !== 'listed',
    community: listing === 'community',
    forkable: false,
    accessCode: codeInput.mode === 'explicit' ? explicit : (config.appDefaultAccessCode ? generateAccessCode() : undefined),
    access: config.appDefaultAccess === 'signed-in' ? 'signed-in' : undefined,
  };
}
