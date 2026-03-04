# REQ-007: Mailbox Push Notification for Offline Personal Nodes

**Status:** Draft  
**Priority:** Medium  
**Type:** Feature / Infrastructure  
**Created:** 2026-03-04  
**References:** [personal-node-tunnel-reliability.md](../research/personal-node-tunnel-reliability.md), REQ-001 (OpenClaw Integration)

---

## 1. Summary

When an important message (e.g. `work_assignment`, `action_request`) arrives for a personal node that is offline, the operator node should be able to notify the node's owner via email or Web Push so the node can reconnect and retrieve queued messages. Today, mailbox items simply accumulate until the personal node happens to reconnect or they expire (3–7 days).

## 2. Problem Statement

### 2.1 Current Architecture

```
Sender Agent                    Operator Node                    Personal Node
    │                               │                                │
    ├── work_assignment ──────────► │                                │ (offline)
    │                               ├── tunnel delivery attempt      │
    │                               │   └── FAIL (no WebSocket)      │
    │                               ├── mailbox.enqueue()            │
    │                               │   └── stored, expires in 7d    │
    │                               │                                │
    │                               │   ... hours/days pass ...      │
    │                               │                                │
    │                               │ ◄──── tunnel reconnect ───────┤ (node comes online)
    │                               ├── mailbox_sync ───────────────►│
    │                               │   └── deliver queued items     │
```

**Problem:** There is no mechanism to alert the personal node owner that important messages are waiting. The node might not reconnect for days, causing:

- Missed work assignments (morsel-earning opportunities lost)
- Stale action requests (requester may have timed out)
- Federation sync delays (data becomes inconsistent)
- Poor user experience (owner unaware their node has pending work)

### 2.2 Existing Mailbox Infrastructure

| Component | Current State |
|-----------|--------------|
| `MailboxService.enqueue()` | Queues items with type-based retention (3–7 days) |
| `MailboxItemRecord.type` | `action_request`, `work_assignment`, `board_notification`, `federation_sync` |
| `PersonalNodeRecord.status` | `online`, `offline`, `degraded`, `detached` |
| Mailbox quota | 50 MB default, enforced before enqueue |
| Expiry cleanup | Runs every 10 minutes |
| Push notification | **Not implemented** |

### 2.3 Message Priority

Not all mailbox items justify waking a node. The notification system should distinguish urgency:

| Message Type | Priority | Should Notify? |
|-------------|----------|---------------|
| `work_assignment` | High | Yes — morsel-earning, time-sensitive |
| `action_request` | High | Yes — someone is waiting for a response |
| `federation_sync` | Low | No — can wait for natural reconnect |
| `board_notification` | Low | No — social, not urgent |

## 3. Requirements

### 3.1 Notification Channel: Web Push

| ID | Requirement | Priority |
|----|-------------|----------|
| R-006-01 | Implement Web Push (RFC 8030) notification support on the operator node | Must |
| R-006-02 | Generate VAPID keypair at node init and store in config | Must |
| R-006-03 | Expose `POST /v1/personal/push/subscribe` for personal nodes to register push subscriptions | Must |
| R-006-04 | Expose `DELETE /v1/personal/push/subscribe` for unsubscription | Must |
| R-006-05 | Store push subscriptions in `PersonalNodeRecord` or a new `PushSubscriptionRecord` | Must |
| R-006-06 | Support multiple subscriptions per node (owner may have multiple devices) | Should |
| R-006-07 | Push payload must include: message type, sender GAII, timestamp, mailbox item count | Must |
| R-006-08 | Push payload must NOT include full message content (privacy — only metadata) | Must |
| R-006-09 | Handle push delivery failures gracefully (remove stale subscriptions after N failures) | Must |

### 3.2 Notification Channel: Email

| ID | Requirement | Priority |
|----|-------------|----------|
| R-006-10 | Support email notification as an alternative or supplement to Web Push | Should |
| R-006-11 | Email delivery via configurable SMTP transport (`AIMEAT_SMTP_*` env vars) | Should |
| R-006-12 | Store notification email address in `PersonalNodeRecord` or owner profile | Should |
| R-006-13 | Email must contain: message type summary, item count, node reconnect instructions | Should |
| R-006-14 | Email must NOT contain message payloads (privacy — metadata only) | Must (if email implemented) |
| R-006-15 | Rate limit email notifications: maximum 1 email per configurable interval (default 30 min) | Should |
| R-006-16 | Support email opt-out per owner | Should |

### 3.3 Notification Triggers

| ID | Requirement | Priority |
|----|-------------|----------|
| R-006-17 | Trigger notification when a `work_assignment` is enqueued for an offline node | Must |
| R-006-18 | Trigger notification when an `action_request` is enqueued for an offline node | Must |
| R-006-19 | Do NOT trigger notification for `board_notification` or `federation_sync` by default | Must |
| R-006-20 | Make notification triggers configurable per message type via `AIMEAT_PUSH_NOTIFY_TYPES` | Should |
| R-006-21 | Implement notification cooldown: do not send another notification within configurable window (default 5 min) per node | Must |
| R-006-22 | If node reconnects while cooldown is active, cancel any pending notification | Should |

### 3.4 Notification Preferences

| ID | Requirement | Priority |
|----|-------------|----------|
| R-006-23 | Allow owner to configure notification preferences via `PATCH /v1/personal/anchor/:nodeId/notifications` | Should |
| R-006-24 | Preferences must include: enabled channels (web_push, email, none), quiet hours, message type filter | Should |
| R-006-25 | Default: Web Push enabled, email disabled, all high-priority types notify | Must |
| R-006-26 | Quiet hours: no notifications during owner-specified UTC time range (e.g. 22:00–07:00) | Could |

### 3.5 Security & Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| R-006-27 | Push subscription endpoints require owner authentication (`requireAuth()`, `requireRole('owner')`) | Must |
| R-006-28 | Push payloads must be encrypted per RFC 8291 (Web Push Message Encryption) | Must |
| R-006-29 | VAPID private key must never be exposed via API | Must |
| R-006-30 | Email notifications must not leak agent GAIIs or message content to email providers | Must |
| R-006-31 | Push subscription tokens must be validated on registration (prevent SSRF via malicious endpoint URLs) | Must |

### 3.6 Backward Compatibility

| ID | Requirement | Priority |
|----|-------------|----------|
| R-006-32 | Nodes without push subscriptions continue operating exactly as today (mailbox-only) | Must |
| R-006-33 | Push notification is opt-in — no automatic enrollment | Must |
| R-006-34 | No existing E2E test may break | Must |

## 4. Design

### 4.1 Architecture

```
                                   Operator Node
                                   ┌────────────────────────────────────┐
  Sender Agent                     │                                    │
      │                            │  routeToPersonalNode()             │
      ├── work_assignment ───────► │      │                             │
      │                            │      ├── tunnel online? ── YES ──► deliver
      │                            │      │                             │
      │                            │      └── NO (offline)              │
      │                            │           │                        │
      │                            │           ├── mailbox.enqueue()    │
      │                            │           │                        │
      │                            │           └── notifyOfflineNode()  │
      │                            │                │                   │
      │                            │                ├── check cooldown  │
      │                            │                ├── check priority  │
      │                            │                ├── check prefs     │
      │                            │                │                   │
      │                            │                ├── Web Push ─────►  Browser/OS notification
      │                            │                └── Email (opt) ──►  SMTP → owner inbox
      │                            └────────────────────────────────────┘
```

### 4.2 Notification Service

```typescript
// src/services/push-notification.ts

export interface PushSubscriptionRecord {
  id: string;                           // UUID
  personalNodeId: string;               // Which node this subscription is for
  ownerName: string;                    // Owner who registered it
  endpoint: string;                     // Web Push endpoint URL
  keys: {
    p256dh: string;                     // Public key (base64url)
    auth: string;                       // Auth secret (base64url)
  };
  failureCount: number;                 // Consecutive delivery failures
  createdAt: string;
  lastUsedAt: string | null;
}

export interface NotificationPreferences {
  enabled: boolean;                     // Master switch
  channels: ('web_push' | 'email')[];  // Active channels
  notifyTypes: string[];               // Message types that trigger notification
  cooldownMinutes: number;             // Minimum interval between notifications (default 5)
  quietHoursUtc?: {                    // Optional quiet hours
    start: string;                     // "22:00"
    end: string;                       // "07:00"
  };
  email?: string;                      // Notification email address (if email channel enabled)
}

export class PushNotificationService {
  async notify(
    personalNodeId: string,
    mailboxItem: MailboxItemRecord,
  ): Promise<{ sent: boolean; channel?: string; reason?: string }>;

  async subscribe(
    personalNodeId: string,
    ownerName: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<PushSubscriptionRecord>;

  async unsubscribe(personalNodeId: string, subscriptionId: string): Promise<boolean>;

  async updatePreferences(
    personalNodeId: string,
    prefs: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences>;

  private async sendWebPush(
    subscription: PushSubscriptionRecord,
    payload: PushPayload,
  ): Promise<boolean>;

  private async sendEmail(
    email: string,
    payload: PushPayload,
  ): Promise<boolean>;

  private isInCooldown(personalNodeId: string): boolean;
  private isInQuietHours(prefs: NotificationPreferences): boolean;
}
```

### 4.3 Push Payload Structure

```typescript
interface PushPayload {
  // Metadata only — never include message content
  type: 'mailbox_alert';
  node_id: string;
  pending_count: number;
  highest_priority_type: string;    // e.g. "work_assignment"
  oldest_item_age_minutes: number;
  operator_node: string;            // So the client knows where to reconnect
  timestamp: string;
}
```

### 4.4 Integration Point in Routing

```typescript
// In personal-routing.ts — after mailbox.enqueue()
if (result.delivered === false && result.queued === true) {
  // Fire-and-forget push notification
  void pushNotificationService.notify(personalNodeId, mailboxItem);
}
```

### 4.5 New API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/personal/push/subscribe` | POST | Owner | Register a Web Push subscription |
| `/v1/personal/push/subscribe/:id` | DELETE | Owner | Remove a subscription |
| `/v1/personal/push/subscriptions` | GET | Owner | List active subscriptions |
| `/v1/personal/anchor/:nodeId/notifications` | GET | Owner | Get notification preferences |
| `/v1/personal/anchor/:nodeId/notifications` | PATCH | Owner | Update notification preferences |
| `/v1/personal/push/test` | POST | Owner | Send a test notification |

### 4.6 VAPID Key Management

```typescript
// Generated once at node init, stored alongside other node keys
// AIMEAT_VAPID_PUBLIC_KEY  — exposed to clients for subscription
// AIMEAT_VAPID_PRIVATE_KEY — used for signing push messages (never exposed)
// AIMEAT_VAPID_CONTACT     — "mailto:operator@example.com" (required by VAPID spec)
```

## 5. Implementation Plan

### Phase 1 — Web Push Foundation

| Step | Change | File(s) |
|------|--------|---------|
| 1.1 | Add `web-push` npm dependency | `package.json` |
| 1.2 | Add `PushSubscriptionRecord` and `NotificationPreferences` types | `src/storage/interface.ts` |
| 1.3 | Add CRUD methods for push subscriptions to Storage | `src/storage/interface.ts`, `src/storage/memory.ts` |
| 1.4 | Create `PushNotificationService` | `src/services/push-notification.ts` (new) |
| 1.5 | Generate VAPID keypair in init wizard | `src/cli/init-wizard.ts` |
| 1.6 | Add VAPID config to `AimeatConfig` | `src/config.ts` |
| 1.7 | Create push subscription routes | `src/routes/personal.ts` (extend) |
| 1.8 | Integrate notification trigger in `routeToPersonalNode()` | `src/services/personal-routing.ts` |

### Phase 2 — Email Channel

| Step | Change | File(s) |
|------|--------|---------|
| 2.1 | Add `nodemailer` npm dependency | `package.json` |
| 2.2 | Add SMTP configuration to `AimeatConfig` | `src/config.ts` |
| 2.3 | Implement email sending in `PushNotificationService` | `src/services/push-notification.ts` |
| 2.4 | Add email templates (plain text, minimal HTML) | `src/services/push-notification.ts` |
| 2.5 | Add email rate limiting (1 per 30 min default) | `src/services/push-notification.ts` |

### Phase 3 — Preferences & Polish

| Step | Change | File(s) |
|------|--------|---------|
| 3.1 | Notification preferences API routes | `src/routes/personal.ts` |
| 3.2 | Quiet hours enforcement | `src/services/push-notification.ts` |
| 3.3 | Subscription health monitoring (remove stale after 3 consecutive failures) | `src/services/push-notification.ts` |
| 3.4 | Test notification endpoint | `src/routes/personal.ts` |
| 3.5 | Add push stats to `GET /v1/stats` | `src/services/stats.ts` |

## 6. Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AIMEAT_VAPID_PUBLIC_KEY` | String | (generated at init) | VAPID public key for Web Push |
| `AIMEAT_VAPID_PRIVATE_KEY` | String | (generated at init) | VAPID private key (secret) |
| `AIMEAT_VAPID_CONTACT` | String | `""` | VAPID contact email (required for Web Push) |
| `AIMEAT_PUSH_ENABLED` | Boolean | `false` | Master switch for push notifications |
| `AIMEAT_PUSH_NOTIFY_TYPES` | Comma-separated | `work_assignment,action_request` | Message types that trigger notification |
| `AIMEAT_PUSH_COOLDOWN_MIN` | Number | `5` | Minimum minutes between notifications per node |
| `AIMEAT_SMTP_HOST` | String | `""` | SMTP server hostname |
| `AIMEAT_SMTP_PORT` | Number | `587` | SMTP port |
| `AIMEAT_SMTP_USER` | String | `""` | SMTP username |
| `AIMEAT_SMTP_PASS` | String | `""` | SMTP password |
| `AIMEAT_SMTP_FROM` | String | `""` | Sender email address |
| `AIMEAT_EMAIL_RATE_LIMIT_MIN` | Number | `30` | Minimum minutes between email notifications per node |

## 7. Security Considerations

### 7.1 Web Push Endpoint Validation
- Push subscription `endpoint` URL must be validated against a known push service allowlist (e.g. `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`)
- Reject arbitrary URLs to prevent SSRF attacks via push subscription registration
- Log and alert on suspicious endpoint patterns

### 7.2 Payload Privacy
- Push payloads contain only metadata (item count, type, age) — never message content
- All Web Push payloads encrypted per RFC 8291
- Email bodies contain only reconnection instructions, never GAIIs or message payloads

### 7.3 SMTP Credential Protection
- SMTP credentials stored as environment variables, never in API responses
- SMTP connection uses TLS (STARTTLS or direct TLS)
- No open relay — emails sent only to verified owner addresses

### 7.4 Subscription Abuse Prevention
- Maximum subscriptions per node (default: 5) to prevent subscription flooding
- Stale subscriptions auto-removed after 3 consecutive delivery failures
- Cooldown prevents notification storms

## 8. Testing Strategy

| Test | Description | Phase |
|------|-------------|-------|
| Unit: `PushNotificationService` | Cooldown logic, quiet hours, priority filtering | 1 |
| Unit: endpoint URL validation | Allowlist enforcement, SSRF rejection | 1 |
| E2E: subscribe + trigger | Register push subscription, enqueue work_assignment, verify notification sent | 1 |
| E2E: cooldown | Two rapid enqueues → only one notification | 1 |
| E2E: unsubscribe | Remove subscription, verify no notification on next enqueue | 1 |
| E2E: email delivery | Configure SMTP, trigger email notification, verify rate limit | 2 |
| E2E: preferences | Update quiet hours, verify suppression during quiet window | 3 |
| E2E: backward compat | All existing 35 tests pass without push subscriptions | All |

## 9. Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | Should the tunnel client library (`aimeat-tunnel.js`) include automatic push subscription registration? | Phase 1 |
| 2 | Should federated nodes forward push notifications, or only the anchor node? | Phase 2+ |
| 3 | Should there be an operator-level push notification dashboard? | Phase 3 |
| 4 | Is `web-push` npm package the right choice, or should we use raw RFC 8030 implementation? | Phase 1 |
| 5 | Should push notifications include an action URL that deep-links to the reconnection flow? | Phase 1 |

## 10. Success Criteria

1. **Offline node owners are alerted** — when a `work_assignment` arrives for an offline node, the owner receives a push notification within 60 seconds
2. **Privacy preserved** — no message content in push payloads or emails
3. **No spam** — cooldown prevents notification storms; quiet hours are respected
4. **Opt-in only** — nodes without subscriptions behave exactly as today
5. **Secure** — SSRF prevented via endpoint allowlist; VAPID keys properly managed
6. **Measurable** — push notification stats visible in `GET /v1/stats`
