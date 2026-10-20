/**
 * @file src/mcp/protocol-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP revisions this node states on its server cards: the node card
 *   (routes/wellknown.ts) and an app origin's card (routes/subdomain-origin-docs.ts).
 *
 *   IT IS THE HIGHEST REVISION THE NODE SERVES. Since 2026-10-20 the endpoint serves two eras on one
 *   URL: a request with the 2026-07-28 `_meta` envelope goes to the stateless code path, whose
 *   server/discover names 2026-07-28; anything else goes to the session code, whose `initialize`
 *   answers the client's requested revision when it supports it, else the SDK's
 *   LATEST_PROTOCOL_VERSION (2025-11-25). So a card states 2026-07-28 as protocolVersion and lists
 *   every served revision beside it. Until 2026-10-19 both cards wrote `2025-06-18` by hand while
 *   SDK 1.31.0 negotiated `2025-11-25`, so a reader of the card was told a revision one behind what
 *   the server spoke.
 *
 *   WHY A LITERAL AND NOT THE SDK IMPORT. `security/protocol-versions.json` is the register of
 *   every protocol the node speaks, and `pnpm check:protocol-versions` reads the declaration out of
 *   this source file. A computed value gives that gate nothing to read, and the SDK does not export
 *   its 2026-07-28 constant. So the literal is written once, here; test/unit/mcp-protocol-version.test.ts
 *   binds it to what server/discover answers and the 2025 half to what initialize negotiates, so an
 *   SDK upgrade that moves either fails on the day of the upgrade; and the register binds the ledger
 *   to the literal. The same arrangement as AGUI_PROTOCOL (services/agui-run.ts).
 * @structure
 *   - MCP_PROTOCOL_VERSION — the highest revision, which both server cards state
 *   - MCP_SERVED_REVISIONS — every revision served, highest first, listed on both cards
 * @usage
 *   import { MCP_PROTOCOL_VERSION } from '../mcp/protocol-version.js';
 *   res.json({ protocolVersion: MCP_PROTOCOL_VERSION, ... });
 * @version-history
 *   v1.1.0 — 2026-10-20 — 2026-07-28 is the declared revision, and MCP_SERVED_REVISIONS lists every
 *     revision the node serves (MCP SDK v2 migration step 8, plan item 9).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.0 — 2026-10-19 — Initial: one declaration for both server cards, at the revision the SDK
 *     negotiates (wish-mcp-2026-07-28-ja-sdk-v2-siirtym-suunnitelma-palvelinkortin-, the server-card half).
 */
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server';

/** The highest MCP revision the node serves, which both server cards state; held to server/discover by a unit test. */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

/**
 * Every revision the node serves, highest first: 2026-07-28 on the stateless code path
 * (mcp/modern-endpoint.ts), and the 2025-era revisions the session code negotiates
 * (mcp/legacy-sessions.ts, the SDK's SUPPORTED_PROTOCOL_VERSIONS). Both cards list it beside
 * protocolVersion (decision 2026-10-20, MCP migration plan item 9), so a client that speaks only an
 * older revision reads that it is served too.
 */
export const MCP_SERVED_REVISIONS: readonly string[] = Object.freeze([MCP_PROTOCOL_VERSION, ...SUPPORTED_PROTOCOL_VERSIONS]);
