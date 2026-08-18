/**
 * @file types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared types for the skill bundle generator and runtime adapters.
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 */

export interface BundleFile {
  path: string;
  content: string;
}

export interface BundleMetadata {
  bundleName: string;
  runtime: string;
  version: string;
  agentName: string;
  agentGaii: string;
  nodeId: string;
  nodeUrl: string;
  generatedAt: string;
}

export interface BundleContent {
  metadata: BundleMetadata;
  files: BundleFile[];
}

export interface BundleContext {
  agentName: string;
  agentGaii: string;
  nodeId: string;
  nodeUrl: string;
  directives: {
    purpose?: string;
    rules: Array<{ id: string; description: string; source: string }>;
    memoryAreas?: string[];
    resources?: Array<{ key: string; description?: string }>;
  };
  capabilities: {
    technical?: string[];
    domain?: string[];
  };
  webhookUrl?: string;
}

export interface RuntimeAdapter {
  readonly runtime: string;
  readonly bundleName: string;
  generate(ctx: BundleContext, references: BundleFile[]): BundleContent;
}
