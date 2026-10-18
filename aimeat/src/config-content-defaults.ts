/**
 * @file src/config-content-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's starting levels for content (plan doc-mvcn6c7e4e5q, V5): the level a
 *   record, a file, a board, an organism, a workspace share, a data package and an agent's directory
 *   listing get when the caller does not name one. A level the caller names always wins.
 *
 *   THE CODE DEFAULT OF EVERY SETTING IS TODAY'S BEHAVIOUR (decision 11.2), so a running node changes
 *   nothing until its operator decides. `.env.example` names the recommended value of each, and
 *   `aimeat init` writes those for a new node (cli/init-wizard/steps-core.ts).
 *
 *   A default is computed BEFORE the publish gate (services/publish-gate.ts) is asked, so a default
 *   of public for an agent's write without publish:public is a raise to public and asks the owner,
 *   exactly as an explicit public does.
 *
 *   Not settings here: an extension's ext: memory stays public unless the write says otherwise
 *   (decision 11.4), and the exchange market stays public (decision 11.6).
 *
 *   Its own file because config.ts is at the line ceiling; spread into the config through
 *   visibilityDefaults() (config-visibility.ts). It imports nothing. The doors read the values
 *   through services/content-defaults.ts.
 * @structure ContentDefaultsConfig · contentDefaults(env) · CONTENT_DEFAULT_VALUES
 * @usage
 *   import { contentDefaults } from './config-content-defaults.js';
 *   const config = { ...contentDefaults(), ... };
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V5.1-V5.6, V5.8).
 */

/** The accepted values of each setting, one list per setting, read by the config rows too. */
export const CONTENT_DEFAULT_VALUES = {
  memory: ['private', 'owner', 'members'],
  file: ['private', 'owner', 'members'],
  appUpload: ['public', 'private', 'owner', 'members'],
  board: ['public', 'private'],
  organism: ['public', 'listed', 'private'],
  share: ['open', 'account', 'organism'],
  datapackage: ['public', 'members', 'private'],
} as const;

export type DefaultMemoryVisibility = typeof CONTENT_DEFAULT_VALUES.memory[number];
export type DefaultFileVisibility = typeof CONTENT_DEFAULT_VALUES.file[number];
export type DefaultAppUploadVisibility = typeof CONTENT_DEFAULT_VALUES.appUpload[number];
export type DefaultBoardVisibility = typeof CONTENT_DEFAULT_VALUES.board[number];
export type DefaultOrganismVisibility = typeof CONTENT_DEFAULT_VALUES.organism[number];
export type DefaultShareAccess = typeof CONTENT_DEFAULT_VALUES.share[number];
export type DefaultDatapackageVisibility = typeof CONTENT_DEFAULT_VALUES.datapackage[number];

export interface ContentDefaultsConfig {
  /** A memory record written without a visibility (POST/PATCH /v1/memory, bulk, aimeat_memory_write). Code default private. */
  defaultMemoryVisibility: DefaultMemoryVisibility;
  /** A stored file uploaded without a visibility, by anyone but an app grant. Code default private. */
  defaultFileVisibility: DefaultFileVisibility;
  /**
   * A stored file an app grant uploads without a visibility. Code default public: AIMEAT.assets.upload
   * sent 'public' itself until V5.2, and an asset a player cannot read draws nothing.
   */
  defaultAppUploadVisibility: DefaultAppUploadVisibility;
  /** A board created without a visibility. Code default public, what AIMEAT.social.createBoard sent. */
  defaultBoardVisibility: DefaultBoardVisibility;
  /** An organism created without a visibility (and with no shape that names one). Code default public. */
  defaultOrganismVisibility: DefaultOrganismVisibility;
  /** A workspace share made for the first time without `access`. Code default open. */
  defaultShareAccess: DefaultShareAccess;
  /** A data package version published without a visibility. Code default public. */
  defaultDatapackageVisibility: DefaultDatapackageVisibility;
  /** A new agent appears in the public agent directory (no `unlisted` tag). Code default true. */
  defaultAgentListed: boolean;
}

function pick<T extends string>(values: readonly T[], raw: string | undefined, fallback: T): T {
  return raw !== undefined && (values as readonly string[]).includes(raw) ? raw as T : fallback;
}

export function contentDefaults(env: NodeJS.ProcessEnv = process.env): ContentDefaultsConfig {
  const v = CONTENT_DEFAULT_VALUES;
  return {
    defaultMemoryVisibility: pick(v.memory, env.AIMEAT_DEFAULT_MEMORY_VISIBILITY, 'private'),
    defaultFileVisibility: pick(v.file, env.AIMEAT_DEFAULT_FILE_VISIBILITY, 'private'),
    defaultAppUploadVisibility: pick(v.appUpload, env.AIMEAT_DEFAULT_APP_UPLOAD_VISIBILITY, 'public'),
    defaultBoardVisibility: pick(v.board, env.AIMEAT_DEFAULT_BOARD_VISIBILITY, 'public'),
    defaultOrganismVisibility: pick(v.organism, env.AIMEAT_DEFAULT_ORGANISM_VISIBILITY, 'public'),
    defaultShareAccess: pick(v.share, env.AIMEAT_DEFAULT_SHARE_ACCESS, 'open'),
    defaultDatapackageVisibility: pick(v.datapackage, env.AIMEAT_DEFAULT_DATAPACKAGE_VISIBILITY, 'public'),
    defaultAgentListed: env.AIMEAT_DEFAULT_AGENT_LISTED !== 'false',
  };
}
