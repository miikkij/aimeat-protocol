/**
 * @file src/services/app-isolation-status.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's line about apps: which of the three ways this node keeps an app away
 *   from the sign-in of the person who opens it (services/app-isolation.ts), in words, and on a node
 *   several people share with no app addresses a warning that says what to set. The Security page and
 *   aimeat_admin_security_overview both read it through services/security-overview.ts, so the chat and
 *   the page say the same thing. Audit A7-1.
 * @structure AppIsolationStatus · isolationStatusFor(input) (pure) · appIsolationStatus(config, storage)
 * @usage const apps = await appIsolationStatus(config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { deriveAppHost } from '../config-hosts.js';
import { appIsolationMode, peopleWhoPublish, type AppIsolationMode } from './app-isolation.js';

export interface AppIsolationStatus {
  /** app-origin, isolated-frame or shared-origin (services/app-isolation.ts). */
  isolation: AppIsolationMode;
  /** People with an account here who can publish an app. */
  people: number;
  app_origin: { enabled: boolean; host: string | null };
  /** healthy: nothing to do. watch: apps are kept apart in the isolated frame, and an app address would lift its limits. */
  zone: 'healthy' | 'watch';
  /** What happens to an app on this node, in one or two sentences. */
  summary: string;
  /** On a node several people share with no app addresses; null otherwise. */
  warning: string | null;
  /** The steps that give every app an address of its own; null when nothing needs setting. */
  what_to_set: string | null;
  /** The two settings those steps name, with the values this node would take; null when nothing needs setting. */
  settings: Record<string, string> | null;
}

/**
 * The line for a given answer. Pure, so the three sentences are testable without a node. `baseUrl`
 * supplies the host the suggested app address is built from.
 */
export function isolationStatusFor(input: {
  isolation: AppIsolationMode;
  people: number;
  appOriginEnabled: boolean;
  appHost: string;
  baseUrl: string;
}): AppIsolationStatus {
  const { isolation, people, appOriginEnabled, appHost, baseUrl } = input;
  const appOrigin = { enabled: appOriginEnabled, host: appHost || null };
  if (isolation === 'app-origin') {
    return {
      isolation, people, app_origin: appOrigin, zone: 'healthy',
      summary: `Every app runs on an address of its own under ${appHost}, so no app can read the sign-in of the person who opens it.`,
      warning: null, what_to_set: null, settings: null,
    };
  }
  if (isolation === 'shared-origin') {
    return {
      isolation, people, app_origin: appOrigin, zone: 'healthy',
      summary: 'Only one person has an account here, so apps run on this node\'s own address with that person\'s sign-in. '
        + 'When a second person gets an account, every app moves into an isolated frame by itself.',
      warning: null, what_to_set: null, settings: null,
    };
  }
  // A real host when the node has one; on localhost or an IP address no public subdomain family can
  // exist, so the suggestion is a placeholder the operator replaces.
  const suggested = appHost || deriveAppHost(baseUrl) || 'apps.your-domain.example';
  return {
    isolation, people, app_origin: appOrigin, zone: 'watch',
    summary: `${people} people have an account here and apps have no address of their own, so every app runs in an isolated frame. `
      + 'The frame cannot read anybody\'s sign-in, cookies or stored data on this node, and the app reaches the node only with the permissions it was given.',
    warning: 'An app in the isolated frame cannot use a browser database, cookies that last, a service worker or notifications, and it cannot be installed. '
      + 'Give every app an address of its own to remove these limits.',
    what_to_set: `Point the wildcard name *.${suggested} at this server, with a TLS certificate that covers it. `
      + `Then set AIMEAT_APP_HOST=${suggested} and AIMEAT_APP_ORIGIN_ENABLED=true, and restart the node.`,
    settings: { AIMEAT_APP_HOST: suggested, AIMEAT_APP_ORIGIN_ENABLED: 'true' },
  };
}

/**
 * This node's line. The people are counted fresh (an operator's read should not be a moment old), and
 * the mode is then asked of appIsolationMode, the one place that decides it, which reads that count.
 */
export async function appIsolationStatus(config: AimeatConfig, storage: Storage): Promise<AppIsolationStatus> {
  const people = await peopleWhoPublish(storage, { fresh: true });
  const isolation = await appIsolationMode(config, storage);
  return isolationStatusFor({
    isolation, people, appOriginEnabled: config.appOriginEnabled, appHost: config.appHost, baseUrl: config.baseUrl,
  });
}
