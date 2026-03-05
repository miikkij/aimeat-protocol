# Design: Mailbox Push Notification for Offline Personal Nodes

**Date:** 2026-03-05
**Requirement:** REQ-007
**Status:** Approved
**Scope:** All 3 phases (Web Push + Email + Preferences)

---

## Decision: New Parallel Service (Approach A)

The existing `PushService` (`src/services/push.ts`) handles general owner-level notifications (organism broadcasts, test pings), keyed by `ownerName` with one subscription per owner.

REQ-007 needs a fundamentally different model: per-node subscriptions (multiple devices), cooldown tracking, priority filtering, quiet hours, and email channel. Creating a separate `MailboxNotificationService` provides clean separation with no risk to existing functionality.

Both services use the `web-push` library independently.

---

## Data Model

### New Table: `personal_push_subscriptions`

```sql
CREATE TABLE IF NOT EXISTS personal_push_subscriptions (
  id              TEXT PRIMARY KEY,
  personalNodeId  TEXT NOT NULL,
  ownerName       TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  keys            TEXT NOT NULL DEFAULT '{}',
  failureCount    INTEGER NOT NULL DEFAULT 0,
  createdAt       TEXT NOT NULL,
  lastUsedAt      TEXT
);
CREATE INDEX idx_pps_node ON personal_push_subscriptions(personalNodeId);
```

```typescript
export interface PersonalPushSubscriptionRecord {
  id: string;
  personalNodeId: string;
  ownerName: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  failureCount: number;
  createdAt: string;
  lastUsedAt: string | null;
}
```

### New Table: `notification_preferences`

```sql
CREATE TABLE IF NOT EXISTS notification_preferences (
  personalNodeId  TEXT PRIMARY KEY,
  enabled         INTEGER NOT NULL DEFAULT 1,
  channels        TEXT NOT NULL DEFAULT '["web_push"]',
  notifyTypes     TEXT NOT NULL DEFAULT '["work_assignment","action_request"]',
  cooldownMinutes INTEGER NOT NULL DEFAULT 5,
  quietHoursUtc   TEXT,
  email           TEXT
);
```

```typescript
export interface NotificationPreferences {
  personalNodeId: string;
  enabled: boolean;
  channels: ('web_push' | 'email')[];
  notifyTypes: string[];
  cooldownMinutes: number;
  quietHoursUtc: { start: string; end: string } | null;
  email: string | null;
}
```

### Storage Repository: `NotificationRepository`

New file: `src/storage/repositories/notification.repository.ts`

```typescript
export interface NotificationRepository {
  // Push subscriptions (per personal node)
  createPersonalPushSubscription(record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord>;
  getPersonalPushSubscription(id: string): Promise<PersonalPushSubscriptionRecord | null>;
  listPersonalPushSubscriptions(personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]>;
  updatePersonalPushSubscription(id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean>;
  deletePersonalPushSubscription(id: string): Promise<boolean>;
  deletePersonalPushSubscriptionsByNode(personalNodeId: string): Promise<number>;
  countPersonalPushSubscriptions(personalNodeId: string): Promise<number>;

  // Notification preferences (per personal node)
  getNotificationPreferences(personalNodeId: string): Promise<NotificationPreferences | null>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  deleteNotificationPreferences(personalNodeId: string): Promise<boolean>;
}
```

---

## Service: `MailboxNotificationService`

New file: `src/services/mailbox-notification.ts`

**Stateful** — instantiated once at startup (like `TunnelManager`), holds cooldown map in memory.

### Constructor

```typescript
constructor(config: AimeatConfig, storage: Storage)
```

Initializes `web-push` with VAPID details (same pattern as existing `PushService`). Optionally initializes `nodemailer` transport if SMTP is configured.

### Core Method: `notify()`

```typescript
async notify(
  personalNodeId: string,
  mailboxItem: MailboxItemRecord,
): Promise<{ sent: boolean; channel?: string; reason?: string }>
```

Flow:
1. Load `NotificationPreferences` for node (default preferences if none stored)
2. Check `enabled` flag
3. Check `notifyTypes` includes `mailboxItem.type`
4. Check cooldown: in-memory `Map<string, number>` (`nodeId -> lastNotifiedTimestamp`). If within `cooldownMinutes`, skip.
5. Check quiet hours: parse `quietHoursUtc`, compare against current UTC time
6. If all pass:
   - **Web Push:** Load all `PersonalPushSubscriptionRecord` for node, send to each. On 404/410, increment `failureCount`; auto-delete at `maxFailures` (default 3). On success, update `lastUsedAt` and reset `failureCount`.
   - **Email:** If `email` channel enabled and `prefs.email` is set, check separate email cooldown (default 30 min). Send via nodemailer.
7. Update cooldown map
8. Return result

### Push Payload

```typescript
interface MailboxPushPayload {
  type: 'mailbox_alert';
  node_id: string;
  pending_count: number;
  highest_priority_type: string;
  oldest_item_age_minutes: number;
  operator_node: string;
  timestamp: string;
}
```

Metadata only. Never message content, never GAIIs.

### Endpoint URL Validation

```typescript
const ALLOWED_PUSH_DOMAINS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
  'web.push.apple.com',
];
```

Reject any endpoint URL not matching this allowlist to prevent SSRF.

### Email Template

Plain-text only. Subject: `AIMEAT: [count] pending messages for your node`. Body contains message count, highest priority type, reconnect instructions. No GAIIs, no message payloads.

---

## Integration Point

In `src/services/personal-routing.ts`, line 89-90:

**Before:**
```typescript
if (queued) {
  return { delivered: false, queued: true, reason: 'node_offline' };
}
```

**After:**
```typescript
if (queued) {
  // Fire-and-forget push notification (non-blocking)
  void mailboxNotificationService?.notify(personalNode.nodeId, queued);
  return { delivered: false, queued: true, reason: 'node_offline' };
}
```

The `routeToPersonalNode()` function signature gains an optional `MailboxNotificationService` parameter. When `null` (push not configured), no notification is sent.

All callers (`work.ts`, any future callers) pass the service instance from `server.ts`.

---

## API Endpoints

All under `/v1/personal/push/` — extends `personalRouter`.

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/v1/personal/push/subscribe` | POST | Owner | Register push subscription for a node |
| `/v1/personal/push/subscribe/:id` | DELETE | Owner | Remove a subscription by ID |
| `/v1/personal/push/subscriptions/:nodeId` | GET | Owner | List subscriptions for a node |
| `/v1/personal/push/test/:nodeId` | POST | Owner | Send test notification to a node |
| `/v1/personal/anchor/:nodeId/notifications` | GET | Owner | Get notification preferences |
| `/v1/personal/anchor/:nodeId/notifications` | PATCH | Owner | Update notification preferences |

### POST /v1/personal/push/subscribe

```typescript
// Body
{
  personalNodeId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
// Validation: endpoint URL allowlist, max 5 subscriptions per node
```

### PATCH /v1/personal/anchor/:nodeId/notifications

```typescript
// Body (all optional)
{
  enabled?: boolean;
  channels?: ('web_push' | 'email')[];
  notifyTypes?: string[];
  cooldownMinutes?: number;
  quietHoursUtc?: { start: string; end: string } | null;
  email?: string | null;
}
```

---

## Configuration

### New env vars

| Variable | Type | Default | Phase |
|----------|------|---------|-------|
| `AIMEAT_PUSH_NOTIFY_TYPES` | Comma-separated | `work_assignment,action_request` | 1 |
| `AIMEAT_PUSH_COOLDOWN_MIN` | Number | `5` | 1 |
| `AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE` | Number | `5` | 1 |
| `AIMEAT_PUSH_MAX_FAILURES` | Number | `3` | 1 |
| `AIMEAT_EMAIL_RATE_LIMIT_MIN` | Number | `30` | 2 |

### Existing config (no changes needed)

- `pushEnabled`, `vapidPublicKey`, `vapidPrivateKey`, `vapidSubject` — already in `AimeatConfig`
- `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `smtpFrom`, `smtpSecure` — already in `AimeatConfig`

---

## Server Initialization

In `src/server.ts`:

```typescript
let mailboxNotificationService: MailboxNotificationService | null = null;
if (config.personalNodesEnabled && config.pushEnabled && config.vapidPublicKey && config.vapidPrivateKey) {
  mailboxNotificationService = new MailboxNotificationService(config, storage);
  logger.info('Mailbox push notification service initialized');
}
```

Pass to `personalRouter()` and to `routeToPersonalNode()` callers.

---

## Phase Breakdown

### Phase 1: Web Push Foundation
- Storage types + repository + SQLite implementation
- `MailboxNotificationService` with web push, cooldown, priority filtering
- Push subscription routes (subscribe, unsubscribe, list, test)
- Integration in `routeToPersonalNode()`
- Config additions
- Endpoint URL validation (SSRF prevention)

### Phase 2: Email Channel
- Add `nodemailer` dependency
- Email sending in `MailboxNotificationService.sendEmail()`
- Plain-text email template (metadata only)
- Email rate limiting (separate from push cooldown, default 30 min)

### Phase 3: Preferences & Polish
- Notification preferences API (GET/PATCH)
- Quiet hours enforcement
- Subscription health monitoring (auto-remove stale after 3 failures)
- Push notification stats in `GET /v1/stats`

---

## Backward Compatibility

- Existing `PushService` and `/v1/push/*` routes are untouched
- Nodes without push subscriptions behave exactly as today (mailbox-only)
- Push notification is opt-in — no automatic enrollment
- No existing E2E tests affected
- `routeToPersonalNode()` gracefully handles null notification service
