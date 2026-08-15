/**
 * @file scopes.ts
 * @description F1 scope enforcement metadata for the MCP tool surface. Maps each scope-gated tool
 *   to the scope its REST counterpart already requires (auth/middleware.ts requireScope), so the
 *   public /v1/mcp surface enforces the SAME least-privilege rules as REST — closing the hole where
 *   /v1/mcp registered every tool for every agent regardless of granted scopes.
 *
 *   Only tools whose REST route is genuinely scope-gated appear in TOOL_SCOPES. Tools omitted here
 *   (tasks, apps, extensions, cortex, organisms, knowledge, instances, groups, capabilities, flags,
 *   storage, catalogue, board reads, onboarding, handbook, agent self-report, messages) are NOT
 *   scope-gated in REST either, so leaving them ungated keeps MCP consistent with REST. Admin tools
 *   are omitted because they self-gate via a runtime operator check.
 * @structure
 *   - TOOL_SCOPES — tool name -> required scope (mirrors REST requireScope gates)
 *   - scopeAllowsTool() — wildcard-aware check (exact / domain:* / global *), mirroring middleware
 *   - MCP_SCOPE_PROFILES / scopesForProfile() — role-based scope bundles for agent provisioning
 * @usage
 *   import { scopeAllowsTool } from '../catalog/scopes.js';
 *   if (scopeAllowsTool(agentScopes, 'aimeat_memory_write')) mcp.tool(...)
 * @version-history
 *   v1.11.0 -- 2026-08-16 -- the four incremental app-draft tools (write/replace/read/seed) all take app:write, including the read.
 *     Reading your own unpublished draft is part of editing it, not a separate authority, and a
 *     narrower scope would let an owner grant edits whose result the agent could not check.
 *   v1.10.0 -- 2026-08-15 -- aimeat_storage_delete -> storage:write, the same permission as the
 *     upload. Storing a file and taking it back are one authority over one namespace; a separate
 *     scope would let an owner grant an agent uploads it could never clean up.
 *   v1.9.0 -- 2026-08-14 -- aimeat_usage_report -> wallet:read, matching GET /v1/usage/summary. A
 *     usage report is the owner's whole spend and activity history, which is the same sensitivity
 *     class as their balance rather than a new one.
 *   v1.8.0 -- 2026-08-13 -- aimeat_schedule_trigger -> task:write (it creates the same work its cron
 *     would) and aimeat_agent_console_set -> agent:write (beside mode_set and tags_set).
 *   v1.7.1 -- 2026-08-11 -- Note beside the onboarding entries in SCOPE_EXEMPT_TOOLS: the four tools
 *     mirror the step-confirm route, which is still ungated, while start/cancel now ask for
 *     agent:write (audit H-2) and have no tool. No mapping changed.
 *   v1.7.0 -- 2026-08-11 -- scopeAllowsTool delegates to utils/scope-coverage.ts scopeIsCovered
 *     instead of retelling the wildcard rule. The retelling had lost the memory:write-reserved
 *     exception, so an agent holding '*' got aimeat_operator_ai_config registered.
 *   v1.x — 2026-08-08 — aimeat_company_* ride company:read / company:write.
 *   v1.6.0 -- 2026-08-10 -- 55 mutating tools get the scope they need, and SCOPE_EXEMPT_TOOLS
 *     shrinks from 73 to 18. Seven new scope words, handed to existing agents at boot by
 *     services/scope-vocabulary-migration.ts so an entry here does not delete their tools.
 *   v1.5.0 -- 2026-08-01 -- TARGET-058 Phase 4: a note on why `provenance:write` is NOT in
 *     TOOL_SCOPES. It gates a PARAMETER, not a tool, and hiding nine tools from an agent that merely
 *     cannot assert authorship would be the wrong trade — the honest default needs no permission.
 *   2026-07-19 — AppDev pitfall KB (Phase 4): reserved-package guard + optional model tag on contribute; register pitfall tools
 *   v1.4.0 -- 2026-07-14 -- Commerce scopes (commerce:sell / commerce:buy) for the MCP commerce
 *     tools — deliberately stricter than the requireAuth-only REST commerce routes (documented
 *     divergence: PSP secrets + owner-balance spending warrant least-privilege on the agent surface).
 *   v1.3.0 -- 2026-06-25 -- Specialist scope-consent (declare→consent→grant): SPECIALIST_REQUESTED_SCOPES
 *     (the extras a role would LIKE beyond the conservative baseline), SCOPE_DESCRIPTIONS (plain-language
 *     consent vocabulary), requestedExtras()/describeScopes(). The granted-by-default MCP_SCOPE_PROFILES
 *     stay unchanged + conservative; extras are a SEPARATE declaration, granted only with owner consent.
 *   v1.2.1 -- 2026-06-24 -- Secretary P5 gap-closure (G1): trim sdr/finance/recruiter so EVERY specialist
 *     role is a strict subset of the `secretary` Community baseline (removed workflow:write + social:read
 *     from sdr, wallet:read from finance, social:read from recruiter) — least-privilege; the Enterprise
 *     superset (wallet/workflow:write/social/outbound) is no longer granted to a Community specialist.
 *   v1.2.0 -- 2026-06-24 -- Secretary P5 (S-A): add specialist scope profiles (specialist/sdr/prep/
 *     finance/recruiter) + SPECIALIST_ROLES/isSpecialistRole, all Community-safe (≤ secretary set).
 *   v1.1.0 -- 2026-06-23 -- Add the `secretary` scope profile (Secretary feature Phase 0).
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 3 (F1): tool->scope map + wildcard check + scope profiles
 */
import { scopeIsCovered } from '../../utils/scope-coverage.js';

/**
 * Tool -> required scope, mirroring the REST requireScope() gate for the SAME operation.
 * Verified against src/routes/{memory,boards,wallet,work,actions,consent}.ts.
 */
/**
 * Tools that change state and deliberately need no scope, each with the reason. The gate in
 * scripts/audit-mcp-tools.ts fails on any mutating tool that is in neither TOOL_SCOPES nor this set,
 * so "this needs no scope" becomes a decision someone wrote down rather than the default that
 * silence produces. Before the August 2026 audit, 73 mutating tools sat in that silence, and
 * scopeAllowsTool() reads a missing entry as permission.
 *
 * Seeded 2026-08-10 with the tools that were unmapped at that moment. An entry here is a promise to
 * come back to it: the set may shrink, and every removal is either a real scope or a real refusal.
 */
export const SCOPE_EXEMPT_TOOLS = new Set<string>([
    'aimeat_admin_mint',                             // gated in the handler on the operator role, not by a scope
    'aimeat_agent_capabilities_report',              // Identity is resolved once from the session at agent-capabilities
    'aimeat_agent_telemetry_report',                 // Every write is keyed to `agentGaii` from the session closure (agent-telemetry
    'aimeat_capabilities_vouch',                     // gated in the handler on the operator role, not by a scope
    'aimeat_instance_create',                        // owner comes from ownerName() derived from the session GAII (chat-instances
    'aimeat_message_send',                           // agentGaii and senderGaii are both the session identity (agent-messages
    // The four onboarding tools confirm a STEP, which is the agent reporting its own progress: they
    // mirror POST /v1/agents/:name/onboarding/step/:id, which asks for no scope either. Starting and
    // cancelling onboarding are a different act and were gated on `agent:write` on 2026-08-11 (audit
    // H-2), and neither has a tool, so nothing here mirrors them. Adding one means adding the word.
    'aimeat_onboarding_confirm_directives_read',     // agentGaii from the session closure (agent-onboarding
    'aimeat_onboarding_confirm_skill_installed',     // Same identity path as the rest of the onboarding set — agentGaii from the session closure (agent-onboarding
    'aimeat_onboarding_declare_services',            // agentGaii from the session closure (agent-onboarding
    'aimeat_onboarding_identify_platform',           // Every onboarding tool passes the session closure `agentGaii` (agent-onboarding
    'aimeat_organism_invitation_respond',            // It acts only on the caller's own pending invitation — membership is looked up by getOwnerName() at organisms-n
    'aimeat_task_complete',                          // isOwnTask() at agent-tasks
    'aimeat_task_event',                             // isOwnTask() at agent-tasks
    'aimeat_task_fail',                              // isOwnTask() at agent-tasks
    'aimeat_task_propose_todos',                     // Authorization is isOwnTask(), defined at agent-tasks
    'aimeat_task_request_changes',                   // It is never registered on the server /v1/mcp: it sits in V2_EXCLUDED (src/mcp/catalog/surfaces
    'aimeat_task_todo',                              // isOwnTask() at agent-tasks
]);

export const TOOL_SCOPES: Record<string, string> = {
    // ── August 2026 audit, step 3a ───────────────────────────────────────────────────────────────
    // 73 mutating tools had no entry here, and scopeAllowsTool() reads a missing entry as PERMISSION,
    // so any agent holding any single scope could call all of them. These 55 now say what they need.
    //
    // Adding an entry does not start refusing a call — it REMOVES the tool from an agent whose
    // scopes do not carry the word (mcp/index.ts wraps mcp.tool). Every agent that existed on
    // 2026-08-10 was therefore granted the new words at boot, once, by
    // services/scope-vocabulary-migration.ts. Without that this is changelog 1.33.1 again, where
    // every agent tagging itself got ACCESS_DENIED and discovery broke fleet-wide.
    //
    // The words themselves are new and appear in the owner's agent editor
    // (public/views/profile/agents/scope-model.js), so any of them can be taken away.
    // Reconfigure ANOTHER of the owner's agents. An agent describing itself needs nothing;
    // reaching sideways at a sibling principal with its own identity and trust score does.
    aimeat_agent_mode_set:                    'agent:write',
    aimeat_agent_console_set:                 'agent:write',
    aimeat_agent_tags_set:                    'agent:write',
    // Rewriting an agent's PERMISSIONS is its own word, and no wildcard carries it. PATCH
    // /v1/agents/:name/scopes is owner-only, and the propose-then-confirm dance here binds the
    // token to the CALLER — so the same agent mints and redeems it in two consecutive calls, and
    // the "show this diff to the owner" text is instruction rather than a gate.
    aimeat_operator_agent_configure:          'agent:permissions',

    // The destructive half: delete an app. Split from write because shipping an update and
    // removing the thing are different risks.
    aimeat_app_delete:                        'app:manage',

    // Publish or update an app under the owner's account, including drafts.
    aimeat_app_draft_discard:                 'app:write',
    aimeat_app_draft_publish:                 'app:write',
    aimeat_app_draft_save:                    'app:write',
    aimeat_app_draft_write:                   'app:write',
    aimeat_app_draft_replace:                 'app:write',
    aimeat_app_draft_read:                    'app:write',
    aimeat_app_draft_seed:                    'app:write',
    aimeat_app_screenshot:                    'app:write',
    aimeat_app_fork:                          'app:write',
    aimeat_app_publish:                       'app:write',

    // A capability is how this account offers work to others, so writing one speaks in the
    // owner's name.
    aimeat_capabilities_create:               'capability:write',
    aimeat_capabilities_delete:               'capability:write',
    aimeat_capabilities_update:               'capability:write',

    // A sharing group IS a consent boundary: who may read what.
    // A sharing group IS the boundary of who reads the owner's memory. POST/PUT/DELETE
    // /v1/sharing-groups are owner-only; here it costs an explicit tick instead of being shut.
    aimeat_group_add_member:                  'consent:groups',
    aimeat_group_create:                      'consent:groups',
    aimeat_group_remove_member:               'consent:groups',

    // A share is the other half, and a separate decision: the group is WHO, the share is WHAT they
    // reach. Assembling an audience and handing it a key space are different acts, and only the
    // second one gives anything away — so it costs its own tick and no wildcard carries it.
    aimeat_share_create:                      'share:manage',
    aimeat_share_revoke:                      'share:manage',

    // RUN an installed extension's action. Separate from ext:write, which is about which
    // extensions exist — using a capability is not the same as installing one.
    aimeat_extension_invoke:                  'ext:invoke',

    // Install, activate, deactivate or delete an extension.
    aimeat_extension_install:                 'ext:write',

    // Removes a stored record.
    aimeat_workspace_object_delete:           'memory:delete',

    // These write memory records underneath, whatever the tool is called: a workspace
    // document, a skill manifest, a schedule report, a knowledge contribution.
    aimeat_knowledge_contribute:              'memory:write',
    aimeat_schedule_delete:                   'memory:write',
    aimeat_schedule_report_internal:          'memory:write',
    aimeat_skill_link:                        'memory:write',
    aimeat_skill_publish:                     'memory:write',
    aimeat_skill_unlink:                      'memory:write',
    aimeat_workspace_publish:                 'memory:write',
    aimeat_workspace_revert_to_draft:         'memory:write',
    aimeat_workspace_write:                   'memory:write',

    // Writes keys the server itself trusts (openrouter.*, ai-usage.*, profile.*).
    aimeat_operator_ai_config:                'memory:write-reserved',

    // Changes WHO ELSE can read the owner's knowledge. A different promise than changing
    // the knowledge, which is why it is not organism:write.
    aimeat_organism_invitation_cancel:        'organism:invite',
    aimeat_organism_invitation_email_cancel:  'organism:invite',
    aimeat_organism_invitation_update:        'organism:invite',
    aimeat_organism_invite:                   'organism:invite',
    aimeat_organism_invite_email:             'organism:invite',
    aimeat_organism_member_add:               'organism:invite',
    aimeat_organism_owner_add:                'organism:invite',
    aimeat_organism_owner_remove:             'organism:invite',
    aimeat_workspace_access:                  'organism:invite',
    aimeat_workspace_member_grant:            'organism:invite',
    aimeat_workspace_member_revoke:           'organism:invite',

    // Create a workspace, write and publish in one, comment, transfer.
    aimeat_organism_archive:                  'organism:write',
    aimeat_organism_create:                   'organism:write',
    aimeat_organism_import:                   'organism:write',
    aimeat_organism_leave:                    'organism:write',
    aimeat_organism_update:                   'organism:write',
    aimeat_workspace_comment:                 'organism:write',
    aimeat_workspace_create:                  'organism:write',
    aimeat_workspace_transfer:                'organism:write',
    aimeat_workspace_update:                  'organism:write',

    // The node operator's break-glass over an organism this account does not own. The handler also
    // resolves the caller's OWNER and refuses a non-operator, so the word alone gets nobody in; it is
    // here as well because a tool is REGISTERED according to this table, and no wildcard carries this
    // one (SCOPES_OUTSIDE_WILDCARD), so an operator's agent holds it only by an explicit tick.
    aimeat_admin_organism_ownership:          'operator:organism-repair',
    aimeat_admin_organism_owner_add:          'operator:organism-repair',

    // Writes something other people see under the owner's name.
    aimeat_flag_report:                       'social:write',
    aimeat_organism_join:                     'social:write',

    // Stores a file, or takes one back — the same permission over the same namespace.
    aimeat_portfolio_publish:                 'storage:write',
    aimeat_storage_upload:                    'storage:write',
    aimeat_storage_delete:                    'storage:write',

    // Publishing a data package writes BYTES and a catalogue entry. storage:write is the one that
    // matters — the catalogue is a projection of what was stored, and a package with bytes and no
    // listing is a package; a listing with no bytes is not.
    aimeat_datapackage_publish:               'storage:write',
    aimeat_datapackage_export:                'storage:read',

    // Creates work that will run.
    aimeat_schedule_create:                   'task:write',
    // Running a schedule now creates the same work its cron would, only sooner.
    aimeat_schedule_trigger:                  'task:write',
    aimeat_task_create:                       'task:write',

    // Asks somebody else to do work, which can cost.
    aimeat_capabilities_invoke:               'work:request',

    // Changes something that runs on its own afterwards.
    aimeat_schedule_update:                   'workflow:write',
    aimeat_workflow_answer:                   'workflow:write',

    // Memory (GET /v1/memory/:key → memory:read; POST/PUT → memory:write)
    aimeat_memory_read: 'memory:read',
    aimeat_memory_list: 'memory:read',
    aimeat_memory_search: 'memory:read',
    aimeat_memory_read_public: 'memory:read',
    aimeat_memory_write: 'memory:write',

    // NOTE on `provenance:write` (TARGET-058): it deliberately has NO entry in this map, because it
    // does not gate a TOOL — it gates one optional PARAMETER (`ai_provenance`) on nine of them.
    // Listing a tool here would hide the whole tool from an agent that merely cannot assert how its
    // content was made, when the honest default (the node records what it observed) is available to
    // everyone and needs no permission at all. The check lives at the one place that mints from a
    // declaration, services/ai-provenance.ts:provenanceForWrite, and mirrors requireScope() exactly
    // — so this parameter and POST /v1/provenance cannot answer differently.

    // AppDev pitfall KB (learned entries are memory records under packages/appdev-pitfalls/).
    // Delete gates on memory:write (not memory:delete) deliberately: it only removes the owner's
    // OWN KB entries, report can already overwrite them, and no scope profile grants memory:delete
    // — a stricter gate would just dead-end the tool for every appdev-profile agent.
    aimeat_appdev_pitfall_report: 'memory:write',
    aimeat_appdev_pitfall_delete: 'memory:write',
    // Template proposals are owner-GHII memory records; same reasoning as above.
    aimeat_app_template_propose: 'memory:write',
    aimeat_app_template_delete: 'memory:write',
    aimeat_appdev_proof_attach: 'memory:write',

    // Boards / social (mutations → social:write; subscribe → social:read).
    // NOTE: aimeat_board_read / aimeat_board_list are intentionally NOT gated — the REST
    // GET /v1/boards/:id/posts route is public, so gating them on MCP would be stricter than REST.
    aimeat_board_create: 'social:write',
    aimeat_board_post: 'social:write',
    aimeat_board_reply: 'social:write',
    aimeat_board_react: 'social:write',
    aimeat_board_delete: 'social:write',
    // Who may READ a shared board, which is a different promise from posting to one. The HTTP
    // route rejects every agent session outright ("even operator agents must use their owner
    // session"); this door stays open and costs its own tick.
    aimeat_board_members: 'social:members',
    aimeat_board_subscribe: 'social:read',

    // Wallet (GET /v1/wallet, /v1/wallet/transactions → wallet:read)
    aimeat_wallet_balance: 'wallet:read',
    aimeat_wallet_transactions: 'wallet:read',
    // Usage reports (GET /v1/usage/summary → wallet:read). The same word as the route it calls,
    // because the tool IS that door: a permission enforced on one surface and not the other is a
    // permission the owner was told they had.
    aimeat_usage_report: 'wallet:read',

    // Work queue (inbox → work:read; accept/deliver → work:accept; request execution → work:request)
    aimeat_work_inbox: 'work:read',
    aimeat_work_accept: 'work:accept',
    aimeat_work_deliver: 'work:accept',
    aimeat_action_execute: 'work:request',

    // Consent (POST/GET/DELETE /v1/consent* → consent:manage)
    aimeat_consent_grant: 'consent:manage',
    aimeat_consent_list: 'consent:manage',
    aimeat_consent_revoke: 'consent:manage',

    // Cortex management (POST/PUT/DELETE /v1/cortex* → cortex:write; PUT is the idempotent upsert)
    // List/get are NOT gated (mirrors REST: GET /v1/cortex is just requireAuth).
    aimeat_cortex_install: 'cortex:write',
    aimeat_cortex_activate: 'cortex:write',
    aimeat_cortex_deactivate: 'cortex:write',
    aimeat_cortex_delete: 'cortex:write',

    // Extension lifecycle (POST /v1/extensions/:name/activate etc. → ext:write)
    // Install is NOT gated (mirrors REST: POST /v1/extensions is just requireAuth — agents
    // can push code, but it stays inert until ext:write activates it).
    aimeat_extension_activate: 'ext:write',
    aimeat_extension_deactivate: 'ext:write',
    aimeat_extension_delete: 'ext:write',

    // Agent Workflows (REST: PUT/run → workflow:write; GET → workflow:read)
    aimeat_workflow_save: 'workflow:write',
    aimeat_workflow_run: 'workflow:write',
    aimeat_workflow_get: 'workflow:read',

    // Federated direct messages / inbox (REST: POST /v1/messages → messages:send). Distinct from the
    // agent-dashboard aimeat_message_* tools, which are not scope-gated (agent↔own-owner only).
    aimeat_dm_send: 'messages:send',
    aimeat_dm_ask: 'messages:send',
    // Delegated "reply as me": send a federated DM AS THE OWNER. Its own scope so the owner grants it
    // deliberately (it is part of the full '*' bundle; granular agents opt in separately). The sender is
    // still derived server-side from the agent's owner, so the scope never enables cross-owner sends.
    aimeat_dm_send_as_owner: 'messages:send-as-owner',
    aimeat_dm_inbox: 'messages:read',
    aimeat_dm_thread: 'messages:read',

    // Contacts (address book) — the owner's messaging graph, so the messaging scopes gate it:
    // reading the list / resolving an email rides messages:read; editing the book (save/remove)
    // rides messages:send (the same trust level as opening conversations on the owner's behalf).
    // The company registry: reading the owner's companies rides company:read; registering one,
    // filling in its legal identity, choosing its front page and publishing its page all write
    // to a PUBLIC address, so they ride company:write.
    aimeat_company_list: 'company:read',
    aimeat_company_create: 'company:write',
    aimeat_company_update: 'company:write',
    aimeat_company_front_page: 'company:write',
    aimeat_company_portfolio_publish: 'company:write',

    aimeat_contact_list: 'messages:read',
    aimeat_contact_resolve_email: 'messages:read',
    aimeat_contact_add: 'messages:send',
    aimeat_contact_remove: 'messages:send',

    // Commerce (TARGET-033/034 over MCP). NOTE: the REST commerce routes are requireAuth-only
    // today — these MCP tools are gated STRICTER than REST on purpose (selling config touches
    // PSP secrets; buying spends the owner's balance). commerce:sell = seller-side config (PSP,
    // app-tool manifests, offer pricing); commerce:buy = spending through checkout sessions.
    // Owner-attached '*' agents get both; granular agents opt in per scope.
    // The seller's payment credentials: an agent that can rewrite these can repoint the payouts.
    // PUT/DELETE /v1/commerce/payout/stripe are owner-only.
    aimeat_commerce_psp_set: 'commerce:psp',
    aimeat_commerce_psp_status: 'commerce:sell',
    aimeat_commerce_psp_delete: 'commerce:psp',
    aimeat_app_tools_publish: 'commerce:sell',
    aimeat_offer_price_set: 'commerce:sell',
    // aimeat_app_tools_get is intentionally ungated — it reads PUBLIC manifests (own always).
    // Beneficiary splitting. Declaring who shares your revenue, and paying one of them, both move
    // value out of the owner's own pocket, so they sit with the rest of the seller-side config.
    // READING what you are owed is a wallet question, not a selling one: a beneficiary is usually
    // not a seller at all, and gating their own receivables behind commerce:sell would mean an
    // account could be owed money it had no way to see.
    // The word REST asks for on the same four operations (routes/commerce-beneficiaries.ts:187,
    // :250, :314, :444). They used to ask for commerce:sell here — not stricter or looser, simply a
    // different gate, so an owner who withheld exchange:beneficiary still had an agent that could
    // give their revenue away, and an agent granted exchange:beneficiary could not see the tools.
    // services/scope-vocabulary-migration.ts hands the word to agents already holding commerce:sell,
    // so nothing loses a tool it had and nothing gains one it did not.
    aimeat_commerce_beneficiary_split_set: 'exchange:beneficiary',
    aimeat_commerce_beneficiary_splits: 'exchange:beneficiary',
    aimeat_commerce_beneficiary_release: 'exchange:beneficiary',
    // Paying moves value out of the owner's own wallet, so it sits with the seller-side config
    // rather than with the reads.
    // POST /v1/commerce/beneficiary/payout asks for exchange:beneficiary (:444); the quote GET asks
    // for wallet:read (:411). One tool covers both, so it takes the write word — a caller who may
    // only read a quote can use the earnings tool, which is already gated on wallet:read.
    aimeat_commerce_beneficiary_payout: 'exchange:beneficiary',
    aimeat_commerce_beneficiary_earnings: 'wallet:read',
    // The approval gate is operator-only at the handler; the scope keeps a narrow agent from even
    // seeing the tool, so it is not offered to somebody who could never use it.
    // This one tool covers BOTH halves: reading an approval state and recording one. REST splits
    // them (GET wants wallet:read, POST wants the operator role), so the registration gate stays on
    // the read word and the write word is checked inside the handler on the write branch only.
    // Gating the whole tool on the write word would have made an account unable to see whether it
    // may be paid, which is not the thing anyone meant to restrict.
    aimeat_commerce_beneficiary_approve: 'wallet:read',

    aimeat_checkout_open: 'commerce:buy',
    aimeat_checkout_complete: 'commerce:buy',
    aimeat_checkout_list: 'commerce:buy',

    // EXCHANGE marketplace (TARGET-045 over MCP). Like commerce, the REST /v1/exchange routes are
    // requireAuth-only today — these MCP tools are gated STRICTER on purpose: accepting/bidding mints
    // durable metered entitlements that authorise (charged) spend on the owner's balance. exchange:read
    // = browse/detail/needs/contracts/lineage; exchange:write = accept/off/post/bid/bid-accept.
    // Owner-attached '*' agents get both; granular agents opt in per scope.
    aimeat_exchange_offerings: 'exchange:read',
    aimeat_exchange_offering_get: 'exchange:read',
    aimeat_exchange_contracts: 'exchange:read',
    aimeat_exchange_needs: 'exchange:read',
    aimeat_exchange_consumers: 'exchange:read',
    aimeat_exchange_accept: 'exchange:write',
    aimeat_exchange_contract_off: 'exchange:write',
    aimeat_exchange_need_post: 'exchange:write',
    aimeat_exchange_bid: 'exchange:write',
    aimeat_exchange_bid_accept: 'exchange:write',
    // Act-on-exchange (invoke/work/proposals): read = list; write = invoke/start/deliver/decide (spends or changes a contract).
    aimeat_exchange_work_list: 'exchange:read',
    aimeat_exchange_proposals: 'exchange:read',
    aimeat_app_tool_invoke: 'exchange:write',
    aimeat_exchange_work: 'exchange:write',
    aimeat_exchange_work_deliver: 'exchange:write',
    aimeat_exchange_proposal_decide: 'exchange:write',
};

/** The scope required to use a tool, or undefined if the tool is not scope-gated. */
export function requiredScopeForTool(toolName: string): string | undefined {
    return TOOL_SCOPES[toolName];
}

/**
 * Whether an agent holding `scopes` may use `toolName`. The wildcard rule is NOT written out here:
 * it is scopeIsCovered() in utils/scope-coverage.ts, the same function requireScope and the agent
 * permission dialog answer to. Ungated tools (no entry in the static or dynamic map) are allowed.
 *
 * This used to be a second copy of the rule, and the copy had lost the exception that matters:
 * memory:write-reserved is deliberately outside every wildcard, because '*' is the one-click Full
 * access template and the reserved keys are the ones the server itself trusts. The copy answered
 * yes to '*', so an agent holding Full access got aimeat_operator_ai_config registered and could
 * raise the owner's daily AI budget, while the same agent posting the same key to /v1/memory was
 * refused RESERVED_KEY. One rule, one place, so the exception cannot be lost again.
 */
export function scopeAllowsTool(scopes: string[], toolName: string): boolean {
    const required = TOOL_SCOPES[toolName];
    if (!required) return true;
    return scopeIsCovered(scopes, required);
}

/**
 * Role-based scope bundles for provisioning agents (e.g. at device-auth approval). Maps the
 * existing AgentRecord.mode values to sensible defaults drawn from the scope vocabulary the node
 * actually enforces today (memory / social / wallet / work / consent). As new scope domains are
 * added (e.g. task:*, app:*), extend these bundles. 'interactive'/'autonomous'/'workstation' are
 * broad because they front owner-attached, human-in-the-loop use (e.g. Claude Desktop, VSCode);
 * 'task-runner' is minimal.
 */
export const MCP_SCOPE_PROFILES: Record<string, string[]> = {
    'task-runner': ['memory:read', 'memory:write', 'work:read', 'work:accept'],
    coordinator: ['memory:read', 'memory:write', 'social:read', 'social:write', 'messages:send', 'messages:read', 'work:read', 'work:request', 'workflow:read', 'workflow:write'],
    appdev: ['memory:read', 'memory:write'],
    'organism-knowledge': ['memory:read', 'memory:write', 'social:read'],
    interactive: ['*'],
    autonomous: ['*'],
    workstation: ['*'],
};

/** Scope bundle for an agent mode/profile; falls back to a conservative read+write memory set. */
export function scopesForProfile(mode: string | undefined): string[] {
    return (mode && MCP_SCOPE_PROFILES[mode]) || ['memory:read', 'memory:write'];
}
