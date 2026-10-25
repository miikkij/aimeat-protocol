/**
 * @file src/services/internet-opening/opening-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The records of an app opened to the internet on a closed node: one opening per app,
 *   with its whole history, and the list of owners an operator trusts to open on their own. A node
 *   with `contentAccess: 'signed-in'` serves nothing to strangers (middleware/content-access-gate.ts);
 *   an opening is the watched exception for one app and the intake forms it declares
 *   (services/app-intake-forms.ts). Who opened it, why, when, who approved it and until when are
 *   fields; every change is an event in `history`.
 *
 *   Both records live under the node's own principal `system@<node>`, a reserved account name
 *   (utils/gaii.ts RESERVED_NAMES), so no account can write them.
 * @structure IntakeFormRef · OpeningState · OpeningRequest · OpeningEvent · InternetOpening · TrustedOpener ·
 *   OpenersRecord · openingOwner · openingKey · OPENING_PREFIX · OPENERS_KEY · REQUEST_DAYS · REMIND_DAYS · HISTORY_MAX
 * @usage import { openingKey, type InternetOpening } from './opening-types.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
/** One public intake form, by the three ids its address names (/v1/intake/:org/:ws/:formId). */
export interface IntakeFormRef { org: string; ws: string; formId: string }

/**
 * requested: waits for an operator, not open yet. open: served to everyone. declined: an operator
 * said no. request_expired: nobody decided within REQUEST_DAYS. expired: its end date passed.
 * closed: the owner or an operator closed it, or the app was hidden or deleted.
 */
export type OpeningState = 'requested' | 'open' | 'declined' | 'request_expired' | 'expired' | 'closed';

/** Why an opening needed no operator's approval, or that one gave it. */
export type OpenedUnder = 'operator-approval' | 'operator' | 'trusted-opener' | 'self-mode';

/**
 * What waits for an operator. `open`: the first opening. `extend`: a new end date for an opening that
 * is open. `forms`: forms a new version added, which stay closed until approved.
 */
export interface OpeningRequest {
  kind: 'open' | 'extend' | 'forms';
  reason: string;
  days: number;
  /** The principal that asked: the owner, or their agent or app (then the owner approved first). */
  by: string;
  at: string;
  expiresAt: string;
  /** `forms` only: the forms waiting. */
  forms?: IntakeFormRef[];
}

export interface OpeningEvent {
  at: string;
  kind: 'requested' | 'opened' | 'approved' | 'declined' | 'request_expired' | 'extended'
    | 'version' | 'forms_added' | 'forms_removed' | 'forms_requested' | 'reminded' | 'expired' | 'closed';
  /** The principal that did it; absent for what the node did on its own (an expiry). */
  by?: string;
  note?: string;
  version?: number;
  forms?: IntakeFormRef[];
}

export interface InternetOpening {
  spec: 'aimeat.internet-opening/v1';
  /** `owner/filename`. */
  id: string;
  owner: string;
  filename: string;
  state: OpeningState;
  /** The reason the current or last opening was made with. */
  reason: string;
  requestedBy: string;
  requestedAt: string;
  openedUnder?: OpenedUnder;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  openedAt?: string;
  openedVersion?: number;
  currentVersion?: number;
  /** The forms open with the app. */
  forms: IntakeFormRef[];
  /** The end date; set when it opens. */
  until?: string;
  days: number;
  /** The open or extend request waiting for an operator. */
  request?: OpeningRequest;
  /** Forms a new version added, waiting for an operator beside any other request. */
  formsRequest?: OpeningRequest;
  /** The `until` the reminder was sent for, so one end date is reminded once. */
  remindedFor?: string;
  closedBy?: string;
  closedAt?: string;
  closeReason?: string;
  history: OpeningEvent[];
}

/** An owner an operator trusts to open apps without asking. */
export interface TrustedOpener {
  owner: string;
  reason: string;
  grantedBy: string;
  grantedAt: string;
  /** The end of the trust, or null for no end. */
  until: string | null;
}

export interface OpenersRecord {
  spec: 'aimeat.internet-openers/v1';
  openers: TrustedOpener[];
}

export const openingOwner = (nodeId: string) => `system@${nodeId}`;
export const OPENING_PREFIX = 'internet.opening.';
/** An owner name holds no dot, so the first dot after the prefix ends it; the filename may hold more. */
export const openingKey = (owner: string, filename: string) => `${OPENING_PREFIX}${owner}.${filename}`;
export const OPENERS_KEY = 'internet.openers';
export const OPENING_TAG = 'internet-opening';

/** How long a request waits for an operator. */
export const REQUEST_DAYS = 7;
/** How many days before the end the owner is reminded. */
export const REMIND_DAYS = 7;
/** The most events one opening keeps; the oldest go first. */
export const HISTORY_MAX = 200;
