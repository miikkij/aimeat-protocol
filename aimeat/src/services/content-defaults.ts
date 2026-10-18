/**
 * @file src/services/content-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The level a piece of content gets when its caller names none (plan doc-mvcn6c7e4e5q,
 *   V5): one reader per setting of config-content-defaults.ts, so every door that creates a record,
 *   a file, a board, an organism, a share, a data package or an agent asks the same question. A level
 *   the caller names always wins; these are asked only when it is absent.
 *
 *   Each reader falls back to today's level when the config carries no value (a hand-built config
 *   in a unit test), the same value the code default gives.
 *
 *   ORDER: a door computes the default BEFORE it asks the publish gate (services/publish-gate.ts),
 *   so a default of public is a raise to public and asks the owner like an explicit public does.
 * @structure memoryVisibilityDefault · fileVisibilityDefault · isAppGrantRoles · boardVisibilityDefault ·
 *   organismVisibilityDefault · shareAccessDefault · datapackageVisibilityDefault · agentListingTags
 * @usage
 *   const vis = visibility ?? memoryVisibilityDefault(config);
 *   const fileVis = given ?? fileVisibilityDefault(config, isAppGrantRoles(req.auth!.roles));
 *   await storage.createAgent({ ..., ...agentListingTags(config) });
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V5.1-V5.6, V5.8).
 */
import type {
  ContentDefaultsConfig, DefaultAppUploadVisibility, DefaultBoardVisibility, DefaultDatapackageVisibility,
  DefaultMemoryVisibility, DefaultOrganismVisibility, DefaultShareAccess,
} from '../config-content-defaults.js';

type Defaults = Partial<ContentDefaultsConfig>;

/** A memory record written without a visibility (V5.1). */
export function memoryVisibilityDefault(config: Defaults): DefaultMemoryVisibility {
  return config.defaultMemoryVisibility ?? 'private';
}

/** An app grant (role 'app'), not an ecosystem app: the kindOf() order of services/caller-context.ts. */
export function isAppGrantRoles(roles: readonly string[] | undefined): boolean {
  return !!roles && roles.includes('app') && !roles.includes('ecosystem');
}

/**
 * A stored file uploaded without a visibility (V5.2): the app-upload default for an app grant, the
 * file default for everyone else.
 */
export function fileVisibilityDefault(config: Defaults, appGrant: boolean): DefaultAppUploadVisibility {
  return appGrant ? (config.defaultAppUploadVisibility ?? 'public') : (config.defaultFileVisibility ?? 'private');
}

/** A board created without a visibility (V5.3). */
export function boardVisibilityDefault(config: Defaults): DefaultBoardVisibility {
  return config.defaultBoardVisibility ?? 'public';
}

/** An organism created without a visibility and from no shape that names one (V5.4). */
export function organismVisibilityDefault(config: Defaults): DefaultOrganismVisibility {
  return config.defaultOrganismVisibility ?? 'public';
}

/** A workspace share made for the first time without `access` (V5.5). */
export function shareAccessDefault(config: Defaults): DefaultShareAccess {
  return config.defaultShareAccess ?? 'open';
}

/** A data package version published without a visibility (V5.6). */
export function datapackageVisibilityDefault(config: Defaults): DefaultDatapackageVisibility {
  return config.defaultDatapackageVisibility ?? 'public';
}

/**
 * A new agent's `tags` field with the directory listing applied, spread into the record (V5.8):
 * `unlisted` is added when new agents are listed nowhere (GET /v1/catalogue/agents leaves out an
 * agent tagged `unlisted`). With the agent listed and no tags given, the field stays absent.
 */
export function agentListingTags(config: Defaults, tags?: readonly string[]): { tags?: string[] } {
  const out = [...(tags ?? [])];
  if (config.defaultAgentListed === false && !out.includes('unlisted')) out.push('unlisted');
  return tags === undefined && out.length === 0 ? {} : { tags: out };
}
