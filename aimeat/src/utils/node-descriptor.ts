/**
 * @file node-descriptor.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Builds a node's self-descriptor for the federation: its AIMEAT software version,
 *   node type, enabled feature capabilities, and a CURATED set of federation behaviour settings
 *   (no internal limits or secrets). Shared by the well-known document, the heartbeat payload, and
 *   the federation node-card / book — so peers can see which features a node has and how it behaves.
 * @structure
 *   - NodeDescriptor type
 *   - buildNodeDescriptor(config) — { software_version, node_type, capabilities[], settings{} }
 *   - nodeCapabilities(config) — feature list derived from config.*Enabled flags
 * @usage import { buildNodeDescriptor } from '../utils/node-descriptor.js';
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial node descriptor (federation version/settings visibility).
 */
import type { AimeatConfig } from '../config.js';
import { getSoftwareVersion } from './version.js';

export interface NodeDescriptor {
  software_version: string;
  node_type: string;
  capabilities: string[];
  settings: {
    node_type: string;
    open_join: boolean;
    auth_policy: string;
    cross_federation: boolean;
    visiting_tier: boolean;
    accepts_routing: boolean;
    shares_catalogue: boolean;
  };
}

/** Feature capabilities this node has enabled — the "which features does this node have" signal. */
export function nodeCapabilities(config: AimeatConfig): string[] {
  const caps: string[] = ['memory', 'actions', 'work', 'wallet', 'federation'];
  const flag = (on: boolean, name: string) => { if (on) caps.push(name); };
  flag(config.extendedFeaturesEnabled, 'boards');
  flag(config.calibratorEnabled, 'calibrator');
  flag(config.extensionsEnabled, 'extensions');
  flag(config.cortexEnabled, 'cortex');
  flag(config.packagesEnabled, 'packages');
  flag(config.realtimeEnabled, 'realtime');
  flag(config.portfolioEnabled, 'portfolio');
  flag(config.matchingEnabled, 'matching');
  flag(config.marketplaceEnabled, 'marketplace');
  flag(config.personalNodesEnabled, 'personal-nodes');
  flag(config.crossFederationEnabled, 'cross-federation');
  flag(config.eudiwEnabled, 'eudiw');
  flag(config.ftnEnabled, 'ftn');
  return caps;
}

/** The node's self-descriptor: version + type + capabilities + curated federation settings. */
export function buildNodeDescriptor(config: AimeatConfig): NodeDescriptor {
  return {
    software_version: getSoftwareVersion(),
    node_type: config.nodeType,
    capabilities: nodeCapabilities(config),
    settings: {
      node_type: config.nodeType,
      open_join: config.federationOpenJoin,
      auth_policy: config.federationAuthPolicy,
      cross_federation: config.crossFederationEnabled,
      visiting_tier: config.federationOpenJoin,
      // Node-level default stance toward members (per-peer flags can still override individually).
      accepts_routing: true,
      shares_catalogue: true,
    },
  };
}
