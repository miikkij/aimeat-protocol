/**
 * @file src/mcp/protocol-version.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP revision this node states on its server cards: the node card
 *   (routes/wellknown.ts) and an app origin's card (routes/subdomain-origin-docs.ts).
 *
 *   IT IS THE REVISION THE NODE NEGOTIATES. The MCP server is @modelcontextprotocol/server's (SDK v2), and its
 *   `initialize` answers with the client's requested revision when it supports it, else with the
 *   SDK's LATEST_PROTOCOL_VERSION. So the highest revision a client can get from this node is that
 *   constant, and that is what a card states. Until 2026-10-19 both cards wrote `2025-06-18` by
 *   hand while SDK 1.31.0 negotiated `2025-11-25`, so a reader of the card was told a revision one
 *   behind what the server spoke.
 *
 *   WHY A LITERAL AND NOT THE SDK IMPORT. `security/protocol-versions.json` is the register of
 *   every protocol the node speaks, and `pnpm check:protocol-versions` reads the declaration out of
 *   this source file. A computed value gives that gate nothing to read. So the literal is written
 *   once, here; test/unit/mcp-protocol-version.test.ts binds it to the SDK's LATEST_PROTOCOL_VERSION,
 *   so an SDK upgrade that moves the revision fails on the day of the upgrade; and the register binds
 *   the ledger to the literal. The same arrangement as AGUI_PROTOCOL (services/agui-run.ts).
 * @structure
 *   - MCP_PROTOCOL_VERSION — the revision both server cards state
 * @usage
 *   import { MCP_PROTOCOL_VERSION } from '../mcp/protocol-version.js';
 *   res.json({ protocolVersion: MCP_PROTOCOL_VERSION, ... });
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   v1.0.0 — 2026-10-19 — Initial: one declaration for both server cards, at the revision the SDK
 *     negotiates (wish-mcp-2026-07-28-ja-sdk-v2-siirtym-suunnitelma-palvelinkortin-, the server-card half).
 */

/** The MCP revision both server cards state; held to the SDK's LATEST_PROTOCOL_VERSION by a unit test. */
export const MCP_PROTOCOL_VERSION = '2025-11-25';
