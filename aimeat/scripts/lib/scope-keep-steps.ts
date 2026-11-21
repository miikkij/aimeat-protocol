/**
 * @file scripts/lib/scope-keep-steps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node steps that hand scope words to the agents, ecosystem apps and app
 *   grants approved before those words were asked, read by check:scope-words. A word added to an MCP
 *   tool or a REST route that already exists passes the check only when a step in this list that the
 *   snapshot does not know yet hands it out, or when security/scope-word-snapshot.json carries a reason
 *   for it under `accepted`.
 *
 *   ADDING A STEP. Write the migration as the ones below are written: a once-only key claimed with
 *   claimOnceOnlyStep (services/once-only-step.ts), positive evidence only (the word the principal
 *   already held that reached the tool), never a word that opens more than the reach it had, the
 *   scope list changed on the list that was read (services/scope/list-swap.ts), and called from
 *   server-bootstrap/once-only-keep-steps.ts. Then add its entry here, with every word it may hand
 *   out, and run `pnpm check:scope-words --update`.
 * @structure SCOPE_KEEP_STEPS
 * @usage import { SCOPE_KEEP_STEPS } from './lib/scope-keep-steps.js';
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial: the eight steps that existed on this date.
 */
import type { ScopeKeepStep } from './scope-word-snapshot.js';
import { AGENT_VOCABULARY_MIGRATION_KEY, GRANDFATHERED_SCOPES, CONDITIONAL_SCOPES } from '../../src/services/scope/vocabulary-migration.js';
import { TOOL_SCOPE_WORDS_KEY, CARRIED_FORWARD } from '../../src/services/tool-scope-words-migration.js';
import { REST_SCOPE_GATES_KEY, REST_SCOPE_NEW_WORDS, AGENT_READ_GRANT_KEY, AGENT_READ_WORDS } from '../../src/services/rest-scope-gates-migration.js';
import { REST_SCOPE_KEEP_WORKING_KEY, REST_SCOPE_KEEP_WORKING_WORDS } from '../../src/services/rest-scope-keep-working-migration.js';
import { OPERATOR_ADMIN_MIGRATION_KEY } from '../../src/services/operator/admin-migration.js';
import { PURGE_WORD_KEY } from '../../src/services/task/start-migrations.js';
import { APP_TOOL_INVOKE_KEEP_KEY, APP_TOOL_INVOKE_WORD } from '../../src/services/app/tool-invoke-keep.js';

export const SCOPE_KEEP_STEPS: readonly ScopeKeepStep[] = [
  {
    key: AGENT_VOCABULARY_MIGRATION_KEY, run: 'migrateScopeVocabulary', file: 'src/services/scope/vocabulary-migration.ts',
    words: [...GRANDFATHERED_SCOPES, ...CONDITIONAL_SCOPES.map(c => c.grant)],
  },
  {
    key: TOOL_SCOPE_WORDS_KEY, run: 'migrateToolScopeWordsOnce', file: 'src/services/tool-scope-words-migration.ts',
    words: CARRIED_FORWARD.map(c => c.grant),
  },
  {
    key: REST_SCOPE_GATES_KEY, run: 'migrateRestScopeGatesOnce', file: 'src/services/rest-scope-gates-migration.ts',
    words: REST_SCOPE_NEW_WORDS.map(w => w.word),
  },
  {
    key: AGENT_READ_GRANT_KEY, run: 'migrateAgentReadGrantOnce', file: 'src/services/rest-scope-gates-migration.ts',
    words: AGENT_READ_WORDS.map(w => w.word),
  },
  {
    key: REST_SCOPE_KEEP_WORKING_KEY, run: 'migrateRestScopeKeepWorkingOnce', file: 'src/services/rest-scope-keep-working-migration.ts',
    words: REST_SCOPE_KEEP_WORKING_WORDS.map(w => w.word),
  },
  {
    key: OPERATOR_ADMIN_MIGRATION_KEY, run: 'migrateOperatorAdminOnce', file: 'src/services/operator/admin-migration.ts',
    words: ['operator:admin'],
  },
  {
    key: PURGE_WORD_KEY, run: 'grantPurgeToAppGrantsOnce', file: 'src/services/task/start-migrations.ts',
    words: ['memory:purge'],
  },
  {
    key: APP_TOOL_INVOKE_KEEP_KEY, run: 'keepAppToolInvokeOnce', file: 'src/services/app/tool-invoke-keep.ts',
    words: [APP_TOOL_INVOKE_WORD],
  },
];
