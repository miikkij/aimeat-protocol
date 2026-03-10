# E2E Test Cases Index

## All Profile Tab Test Files

| # | Tab Name | File | Test Count | APIs Tested |
|---|----------|------|------------|-------------|
| 01 | Memory | `01-memory-tab.md` | 12 | `GET/PUT/DELETE /v1/memory`, `GET /v1/memory/search`, `POST /v1/storage/upload`, `GET/DELETE /v1/storage/files` |
| 02 | Wallet | `02-wallet-tab.md` | 8 | `GET /v1/wallet/balance`, `GET /v1/wallet/transactions`, `POST /v1/wallet/request` |
| 03 | Services | `03-services-tab.md` | 10 | `POST /v1/services/publish`, `GET /v1/services/browse`, `GET /v1/services`, `DELETE /v1/services/:id` |
| 04 | Work | `04-work-tab.md` | 10 | `GET /v1/work/inbox`, `GET /v1/work/sent`, `POST /v1/work/:id/accept`, `POST /v1/work/:id/reject`, `POST /v1/work/:id/deliver`, `POST /v1/work/:id/rate` |
| 05 | Knowledge | `05-knowledge-tab.md` | 14 | `GET /v1/knowledge/human`, `GET /v1/knowledge/agent`, `POST /v1/knowledge/import`, `GET /v1/knowledge`, `GET /v1/knowledge/discover`, `POST /v1/knowledge/clone`, `GET /v1/knowledge/export`, `DELETE /v1/knowledge/:id` |
| 06 | Agents | `06-agents-tab.md` | 10 | `GET /v1/agents`, `POST /v1/agents`, `PUT /v1/agents/:name/scopes`, `DELETE /v1/agents/:name` |
| 07 | Data Wallet | `07-data-wallet-tab.md` | 12 | `POST /v1/consent/grant`, `GET /v1/consent`, `GET /v1/consent/audit`, `GET /v1/consent/permissions`, `DELETE /v1/consent/:id`, `POST /v1/consent/bulk-revoke`, `GET /v1/gdpr/export` |
| 08 | Apps | `08-apps-tab.md` | 8 | `POST /v1/apps/upload`, `GET /v1/apps`, `DELETE /v1/apps/:filename`, `PUT /v1/apps/:filename/access` |
| 09 | Boards | `09-boards-tab.md` | 12 | `POST /v1/boards`, `GET /v1/boards`, `POST /v1/boards/:id/subscribe`, `POST /v1/boards/:id/posts`, `GET /v1/boards/:id/posts`, `POST /v1/boards/:id/posts/:pid/react`, `DELETE /v1/boards/:id/posts/:pid` |
| 10 | Security | `10-security-tab.md` | 10 | `GET/PUT /v1/ghii/cors`, `GET/PUT /v1/agents/:name/cors`, `POST /v1/auth/revoke` |
| 11 | Node Stats | `11-node-stats-tab.md` | 6 | `GET /v1/stats` |
| 12 | Federation | `12-federation-tab.md` | 6 | `GET /v1/directory` |
| 13 | Nodes | `13-nodes-tab.md` | 15 | `GET /v1/personal/status`, `POST /v1/personal/anchor`, `DELETE /v1/personal/anchor/:nodeId`, `PATCH /v1/personal/anchor/:nodeId` |
| 14 | Notifications | `14-notifications-tab.md` | 11 | `GET /v1/push/vapid-key`, `POST /v1/push/subscribe`, `DELETE /v1/push/subscribe`, `POST /v1/push/test` |
| 15 | Extensions | `15-extensions-tab.md` | 15 | `GET /v1/cortex`, `POST /v1/cortex`, `GET /v1/cortex/:name`, `POST /v1/cortex/:name/activate`, `POST /v1/cortex/:name/deactivate`, `DELETE /v1/cortex/:name`, `POST /v1/cortex/:name/visibility` |
| 16 | Chat Sessions | `16-chat-sessions-tab.md` | 10 | `GET /v1/agents` (filtered), `DELETE /v1/agents/:name` |
| 17 | Access | `17-access-tab.md` | 8 | None (read-only session display) |
| 18 | Portfolio | `18-portfolio-tab.md` | 14 | `GET /v1/portfolio/catalog`, `GET /v1/portfolio/config`, `PUT /v1/portfolio/config`, `PUT /v1/portfolio/upload`, `GET /v1/portfolio/:owner` |

**Total test cases across all files: ~191**

---

## Existing E2E Coverage in `aimeat/test/e2e-profile-tabs.ts`

The existing automated test file covers **93 tests** with basic API call verification per tab:

| Tab | Tests | What's Covered |
|-----|-------|----------------|
| Memory | 9 | create, list, search, update, delete entry; upload, list, delete file; permissions |
| Wallet | 2 | balance, transactions |
| Services | 4 | publish, browse, list, unpublish |
| Work | 2 | inbox, sent |
| Knowledge | 6 | human prompt, agent prompt, import (2 formats), list, discover |
| Agents | 1 | list agents |
| Data Wallet | 6 | grant, list, audit, permissions, revoke, GDPR export |
| Apps | 2 | upload, list |
| Boards | 7 | create, list, subscriptions, subscribe, post, list posts, react |
| Security | 4 | GHII CORS get/set, agent CORS get/set |
| Node Stats | 1 | stats |
| Federation | 1 | directory |
| Nodes | 2 | status, anchor |
| Notifications | 2 | VAPID key, subscribe |
| Extensions | 6 | list, install, detail, activate, deactivate, uninstall |
| Chat Sessions | 1 | list agents |
| Session Revocation | 2 | revoke + re-auth |

---

## MISSING from Existing Tests (Gap Analysis)

The following operations are exercised in the UI tab code but have NO automated E2E test coverage. These are the gaps that need to be closed.

### CRITICAL (known bugs or high-risk operations)

| Tab | Missing Operation | Priority | Notes |
|-----|-------------------|----------|-------|
| **Knowledge** | clone (`POST /v1/knowledge/clone`) | **P0** | Clone was broken in production; must have regression test |
| **Knowledge** | export (`GET /v1/knowledge/export`) | **P0** | No export verification |
| **Knowledge** | delete (`DELETE /v1/knowledge/:id`) | **P0** | No delete test |
| **Knowledge** | organism packages | **P1** | Multi-agent knowledge sharing untested |
| **Portfolio** | upload HTML (`PUT /v1/portfolio/upload`) | **P1** | Entire portfolio publish flow untested |
| **Portfolio** | catalog (`GET /v1/portfolio/catalog`) | **P1** | Content aggregation untested |
| **Portfolio** | config (`GET/PUT /v1/portfolio/config`) | **P1** | Config persistence untested |
| **Portfolio** | prompt generation | **P1** | Client-side only, but prompt correctness matters |

### HIGH (functional gaps)

| Tab | Missing Operation | Priority | Notes |
|-----|-------------------|----------|-------|
| **Work** | accept (`POST /v1/work/:id/accept`) | **P1** | Core work flow untested |
| **Work** | reject (`POST /v1/work/:id/reject`) | **P1** | Core work flow untested |
| **Work** | deliver (`POST /v1/work/:id/deliver`) | **P1** | Core work flow untested |
| **Work** | rate (`POST /v1/work/:id/rate`) | **P1** | Core work flow untested |
| **Wallet** | request morsels (`POST /v1/wallet/request`) | **P2** | Economy flow untested |
| **Boards** | delete post (`DELETE /v1/boards/:id/posts/:pid`) | **P2** | Moderation action untested |
| **Apps** | delete (`DELETE /v1/apps/:filename`) | **P2** | Cleanup action untested |
| **Apps** | edit access code (`PUT /v1/apps/:filename/access`) | **P2** | Access control untested |

### MEDIUM (secondary operations)

| Tab | Missing Operation | Priority | Notes |
|-----|-------------------|----------|-------|
| **Nodes** | detach (`DELETE /v1/personal/anchor/:nodeId`) | **P2** | Only anchor is tested |
| **Nodes** | set visibility (`PATCH /v1/personal/anchor/:nodeId`) | **P2** | Only status + anchor tested |
| **Extensions** | toggle visibility (`POST /v1/cortex/:name/visibility`) | **P2** | Lifecycle tested but not visibility |
| **Extensions** | bundled install (fetch + install) | **P2** | Only custom install tested |
| **Chat Sessions** | delete session (`DELETE /v1/agents/:name`) | **P2** | Only list tested |
| **Notifications** | unsubscribe (`DELETE /v1/push/subscribe`) | **P2** | Only key + subscribe tested |
| **Notifications** | test push (`POST /v1/push/test`) | **P3** | Requires active subscription |
| **Agents** | update scopes (`PUT /v1/agents/:name/scopes`) | **P2** | Only list tested |
| **Security** | reset CORS | **P3** | Get/set tested but not reset |
| **Data Wallet** | bulk revoke (`POST /v1/consent/bulk-revoke`) | **P2** | Single revoke tested |

### LOW (read-only or client-side only)

| Tab | Missing Operation | Priority | Notes |
|-----|-------------------|----------|-------|
| **Access** | read-only display | **P3** | No API calls; purely client-side rendering |

---

## Recommended Implementation Priority

1. **Phase 1 — Critical regression tests (P0):** Knowledge clone, export, delete
2. **Phase 2 — Portfolio coverage (P1):** Upload, catalog, config, prompt generation
3. **Phase 3 — Work lifecycle (P1):** Accept, reject, deliver, rate
4. **Phase 4 — Secondary CRUD (P2):** Nodes detach/visibility, Extensions visibility/bundled, Chat Sessions delete, Notifications unsubscribe, Apps delete/access, Agents scopes, Data Wallet bulk revoke, Boards delete post, Wallet request
5. **Phase 5 — Edge cases (P3):** Notifications test push, Security reset CORS, Access tab display
