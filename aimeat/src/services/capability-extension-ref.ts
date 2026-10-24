/**
 * @file src/services/capability-extension-ref.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The grammar of an extension-backed capability's source ref, and the once-per-node
 *   step that switches off a stored capability whose ref does not follow it.
 *
 *   WHY. An extension-backed capability is invoked as a loopback POST to
 *   /v1/ext/<name>/<action> with the caller's bearer token and the node's loopback pass
 *   (services/capability-invoke.ts). The ref `ext:<name>:<action>` was stored as the registrant
 *   wrote it and split on ':' into that path, so a ref whose segments were not an extension name and
 *   an action id made the request reach another REST route of the node, as the caller, with a body
 *   the caller chose and a route the registrant chose (secaudit2026oct22,
 *   capability-invoke:extension-ref-unvalidated-in-loopback-url).
 *
 *   THE GRAMMAR. `ext:<name>[@<version>][:<action>]`. The name follows EXT_NAME_PATTERN, the rule
 *   every installed extension's name follows; the version is a pinnable version
 *   (services/component-versions.ts), the same pin `/v1/ext/<name>@<version>/…` accepts; the action
 *   follows EXT_ACTION_ID_PATTERN, the action id rule services/app-format-md.ts already declares.
 *   The action segment is optional at registration because a capability may be registered before
 *   its action exists (test/e2e-capability-webhook-update.ts stores `ext:demo`); invoke requires it
 *   and resolves both the extension and the action before it sends a request.
 *
 *   THE BOOT STEP. A stored extension capability whose ref does not follow the grammar and does not
 *   name an action of an installed extension gets the operator's disable switch
 *   (operatorOverride.disabled, which invoke refuses with CAPABILITY_DISABLED) with a note that says
 *   why, and ONE security incident lists them. Nothing is deleted. An aggregated row over an
 *   installed extension's action is never touched, whatever its action id looks like. The step's
 *   record is `migrations.capability-extension-ref` under `system@<nodeId>`: { at, disabled }.
 * @structure EXT_ACTION_ID_PATTERN · parseExtensionCapabilityRef(ref) · extensionRefRefusal(ref) ·
 *   splitExtensionRef(ref) · disableMalformedExtensionRefsOnce(storage, config)
 * @usage
 *   const parsed = parseExtensionCapabilityRef('ext:weather@1.2.0:get');   // { name, pinned, action }
 *   await disableMalformedExtensionRefsOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { EXT_NAME_PATTERN } from './extension-manifest.js';
import { splitPinnedName } from './component-versions.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { recordSecurityIncident, securityOwner } from './security-incident.js';
import { logger } from '../utils/logger.js';

/** An extension action id: the pattern services/app-format-md.ts declares for an action it names. */
export const EXT_ACTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** The record under `system@<nodeId>` that says the boot step has run. */
export const CAPABILITY_EXTENSION_REF_STEP_KEY = 'migrations.capability-extension-ref';

/** How many capabilities the incident names one by one. */
const INCIDENT_ROWS = 50;

export interface ParsedExtensionRef {
  /** The extension's name, without a version pin. */
  name: string;
  /** The name segment as written: the name, or `name@version`. This is what the loopback path carries. */
  pinned: string;
  /** The action id, or null when the ref names the extension only. */
  action: string | null;
}

/** The parts of an `ext:` ref, or null when it does not follow the grammar in the file header. */
export function parseExtensionCapabilityRef(ref: string): ParsedExtensionRef | null {
  const parts = ref.split(':');
  if (parts[0] !== 'ext' || parts.length < 2 || parts.length > 3) return null;
  const pinned = parts[1];
  const { name } = splitPinnedName(pinned);
  if (!EXT_NAME_PATTERN.test(name)) return null;
  // splitPinnedName leaves a segment whose `@` suffix is not a pinnable version whole, so the
  // name test above has already refused it.
  const action = parts.length === 3 ? parts[2] : null;
  if (action !== null && !EXT_ACTION_ID_PATTERN.test(action)) return null;
  return { name, pinned, action };
}

/** The refusal message for a ref outside the grammar, or null when it follows it. */
export function extensionRefRefusal(ref: string): string | null {
  if (parseExtensionCapabilityRef(ref)) return null;
  return 'source.ref for source.type \'extension\' must be ext:<extension name>:<action id>: the name in lowercase '
    + 'letters, digits and hyphens (optionally @<version>), the action id in letters, digits, hyphens and underscores';
}

/**
 * The two segments of `ext:<pinned name>:<action>` by a plain split on ':', with no grammar, or null
 * when the ref does not have exactly those three parts. Invoke reads a stored ref this way and then
 * requires both segments to name an installed extension and its action, so a row the aggregator
 * wrote over an action id outside EXT_ACTION_ID_PATTERN still runs.
 */
export function splitExtensionRef(ref: string): { pinned: string; action: string } | null {
  const parts = ref.split(':');
  if (parts.length !== 3 || parts[0] !== 'ext' || !parts[1] || !parts[2]) return null;
  return { pinned: parts[1], action: parts[2] };
}

/** True when the ref names an action of an installed extension, read with a plain split. */
async function namesInstalledAction(storage: Storage, ref: string): Promise<boolean> {
  const segments = splitExtensionRef(ref);
  if (!segments) return false;
  const ext = await storage.getExtension(splitPinnedName(segments.pinned).name);
  return !!ext?.actions?.some(a => a.id === segments.action);
}

/**
 * Switch off, once per node, every stored extension capability whose ref does not follow the
 * grammar. Throws when a read or a write fails, and then leaves no record, so the next start tries
 * again; a capability switched off by a failed run stays switched off, which is what the next run
 * would do anyway.
 */
export async function disableMalformedExtensionRefsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; disabled?: number }> {
  const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, CAPABILITY_EXTENSION_REF_STEP_KEY);
  if (!claim) return { ran: false };
  try {
    const at = new Date().toISOString();
    const switchedOff: CapabilityRecord[] = [];
    for (const cap of await storage.listCapabilitiesBySourceType('extension')) {
      if (parseExtensionCapabilityRef(cap.source.ref)) continue;
      if (await namesInstalledAction(storage, cap.source.ref)) continue;
      if (cap.operatorOverride?.disabled) continue;
      await storage.setCapabilityOverride(cap.id, {
        ...(cap.operatorOverride ?? {}),
        disabled: true,
        notes: `Switched off at node start on ${at.slice(0, 10)}: its source ref "${cap.source.ref}" does not name an `
          + 'extension and an action (ext:<name>:<action>), so invoking it would not run an extension action. '
          + 'The owner can register a new capability with a valid ref.',
      });
      switchedOff.push(cap);
    }
    if (switchedOff.length) {
      const shown = switchedOff.slice(0, INCIDENT_ROWS).map(c => `${c.id} (owner ${c.ownerGhii}, ref ${c.source.ref})`);
      const more = switchedOff.length > INCIDENT_ROWS ? ` and ${switchedOff.length - INCIDENT_ROWS} more` : '';
      await recordSecurityIncident(storage, config, {
        type: 'capability_extension_ref',
        code: 'CAPABILITY_EXTENSION_REF_MALFORMED',
        actorGhii: securityOwner(config.nodeId),
        actorName: 'node start',
        source: 'capabilities',
        detail: `${switchedOff.length} extension capability(ies) carried a source ref that names no extension action. `
          + 'Invoking one sent the caller\'s token to the route the ref spelled out, so each now has the operator\'s '
          + `disable switch set with a note, and nothing was deleted: ${shown.join('; ')}${more}.`,
      });
    }
    await claim.finish({ at, disabled: switchedOff.length });
    if (switchedOff.length) logger.warn('Capabilities: extension refs that name no action switched off', { disabled: switchedOff.length });
    return { ran: true, disabled: switchedOff.length };
  } catch (err) {
    await claim.release();
    throw err;
  }
}
