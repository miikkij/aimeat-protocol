/**
 * @file src/services/config-schema-content-defaults.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The config rows for the content starting levels (config-content-defaults.ts, plan
 *   doc-mvcn6c7e4e5q V5): the level content gets when its caller names none. Spread into the
 *   visibility rows (config-schema-visibility.ts), so they stand in the Config tab's Visibility
 *   section; config-schema.ts is at the line ceiling.
 * @structure CONTENT_DEFAULT_CONFIG_FIELDS
 * @usage import { CONTENT_DEFAULT_CONFIG_FIELDS } from './config-schema-content-defaults.js';
 * @version-history
 *   v1.1.0 — 2026-10-18 — visibility.app_upload_default says it is the level an asset-library upload asks for with 'default'.
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V5.1-V5.6, V5.8).
 */
import { CONTENT_DEFAULT_VALUES, type ContentDefaultsConfig } from '../config-content-defaults.js';
import type { ConfigFieldShape } from './config-field-def.js';
import { oneOf } from './config-schema-validators.js';

const V = CONTENT_DEFAULT_VALUES;
const choice = (values: readonly string[]) => ({ ...oneOf(...values), range: values.join('|') });
const WINS = 'A level the writer names always wins; this is only the level when none is named.';

export const CONTENT_DEFAULT_CONFIG_FIELDS: ConfigFieldShape<keyof ContentDefaultsConfig>[] = [
  { key: 'defaultMemoryVisibility', dotPath: 'visibility.memory_default', envVar: 'AIMEAT_DEFAULT_MEMORY_VISIBILITY', type: 'string', ...choice(V.memory), immutable: false, description: `Who may read a record that is saved without saying who may. private: only the account it belongs to. owner: the account and all of its agents. members: everyone signed in here. ${WINS}` },
  { key: 'defaultFileVisibility', dotPath: 'visibility.file_default', envVar: 'AIMEAT_DEFAULT_FILE_VISIBILITY', type: 'string', ...choice(V.file), immutable: false, description: `Who may read a file that a person or an agent uploads without saying who may. private: only the account it belongs to. owner: the account and all of its agents. members: everyone signed in here. ${WINS}` },
  { key: 'defaultAppUploadVisibility', dotPath: 'visibility.app_upload_default', envVar: 'AIMEAT_DEFAULT_APP_UPLOAD_VISIBILITY', type: 'string', ...choice(V.appUpload), immutable: false, description: `Who may read a file that an app uploads through the asset library without saying who may, such as a game's pictures and sounds (the upload asks for the level set here). public: anyone, so every player sees them. private, owner or members: as for other files. An upload that asks for nothing gets the file level above. ${WINS}` },
  { key: 'defaultBoardVisibility', dotPath: 'visibility.board_default', envVar: 'AIMEAT_DEFAULT_BOARD_VISIBILITY', type: 'string', ...choice(V.board), immutable: false, description: `Who may read a board that is created without saying who may. public: anyone. private: only its owner. ${WINS}` },
  { key: 'defaultOrganismVisibility', dotPath: 'visibility.organism_default', envVar: 'AIMEAT_DEFAULT_ORGANISM_VISIBILITY', type: 'string', ...choice(V.organism), immutable: false, description: `Who may find an organism that is created without saying who may. public: anyone, and it is in the public list. listed: it is in the list, its content is for members. private: only its members know it. ${WINS}` },
  { key: 'defaultShareAccess', dotPath: 'visibility.share_access_default', envVar: 'AIMEAT_DEFAULT_SHARE_ACCESS', type: 'string', ...choice(V.share), immutable: false, description: `Who may open a workspace the first time it is shared without saying who may. open: anyone with the link. account: anyone signed in here. organism: only the members of the workspace's organism. ${WINS}` },
  { key: 'defaultDatapackageVisibility', dotPath: 'visibility.datapackage_default', envVar: 'AIMEAT_DEFAULT_DATAPACKAGE_VISIBILITY', type: 'string', ...choice(V.datapackage), immutable: false, description: `Who may read a data package that is published without saying who may. public: anyone, and it is in the catalogue. members: everyone signed in here. private: only the account it belongs to. ${WINS}` },
  { key: 'defaultAgentListed', dotPath: 'visibility.agent_listed_default', envVar: 'AIMEAT_DEFAULT_AGENT_LISTED', type: 'boolean', validate: v => typeof v === 'boolean', immutable: false, description: 'A new agent is shown in the public list of agents. Off: a new agent is in no public list, and its owner still sees it. Agents that already exist keep what they have' },
];
