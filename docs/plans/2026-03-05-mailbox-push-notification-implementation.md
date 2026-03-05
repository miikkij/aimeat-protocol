# Mailbox Push Notification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When an important message arrives for an offline personal node, notify the owner via Web Push and/or email so the node reconnects promptly.

**Architecture:** New `MailboxNotificationService` (parallel to existing `PushService`) with its own storage tables, integrated at the `routeToPersonalNode()` call site. Three phases: Web Push foundation, email channel, preferences & polish.

**Tech Stack:** web-push (already a dependency), nodemailer (new for Phase 2), Express 5, TypeScript, SQLite via better-sqlite3.

**Design doc:** `docs/plans/2026-03-05-mailbox-push-notification-design.md`

---

## Phase 1: Web Push Foundation

### Task 1: Storage Types

**Files:**
- Modify: `aimeat/src/storage/interface.ts` (add types after line 282, after `MailboxItemRecord`)

**Step 1: Add PersonalPushSubscriptionRecord and NotificationPreferences types**

Add after the existing `MailboxItemRecord` interface (line 282):

```typescript
// ── Personal Push Subscriptions (REQ-007) ──────────────────

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

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS (types added but not yet used)

**Step 3: Commit**

```bash
git add aimeat/src/storage/interface.ts
git commit -m "feat(REQ-007): add PersonalPushSubscriptionRecord and NotificationPreferences types"
```

---

### Task 2: Notification Repository Interface

**Files:**
- Create: `aimeat/src/storage/repositories/notification.repository.ts`
- Modify: `aimeat/src/storage/interface.ts` (add import + extend Storage)

**Step 1: Create the repository interface**

Create `aimeat/src/storage/repositories/notification.repository.ts`:

```typescript
import type { PersonalPushSubscriptionRecord, NotificationPreferences } from '../interface.js';

export interface NotificationRepository {
  // Push subscriptions (per personal node, multiple per node for multiple devices)
  createPersonalPushSubscription(record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord>;
  getPersonalPushSubscription(id: string): Promise<PersonalPushSubscriptionRecord | null>;
  listPersonalPushSubscriptions(personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]>;
  updatePersonalPushSubscription(id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean>;
  deletePersonalPushSubscription(id: string): Promise<boolean>;
  deletePersonalPushSubscriptionsByNode(personalNodeId: string): Promise<number>;
  countPersonalPushSubscriptions(personalNodeId: string): Promise<number>;

  // Notification preferences (one per personal node)
  getNotificationPreferences(personalNodeId: string): Promise<NotificationPreferences | null>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  deleteNotificationPreferences(personalNodeId: string): Promise<boolean>;
}
```

**Step 2: Add import and extend Storage**

In `aimeat/src/storage/interface.ts`, add the import alongside the other repository imports (around line 757):

```typescript
import type { NotificationRepository } from './repositories/notification.repository.js';
```

Then add `NotificationRepository` to the Storage `extends` list (around line 761):

```typescript
export interface Storage extends
  OwnerRepository, AgentRepository, MemoryRepository,
  ActionRepository, WorkRepository, WalletRepository,
  BoardRepository, OtkRepository, DisputeRepository,
  MicroMemoryRepository, FileRepository, IdentityRepository,
  SchemaRepository, ConsentRepository, CatalogueRepository,
  ModerationRepository, OrganismRepository, MarketplaceRepository,
  FederationRepository, NodeRepository, NotificationRepository {}
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL — `SqliteStorage` doesn't implement `NotificationRepository` yet. This is expected.

**Step 4: Commit**

```bash
git add aimeat/src/storage/repositories/notification.repository.ts aimeat/src/storage/interface.ts
git commit -m "feat(REQ-007): add NotificationRepository interface to Storage"
```

---

### Task 3: SQLite Schema

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/schema.ts` (add tables before the Indexes section, around line 641)

**Step 1: Add the two new tables**

Insert before line 642 (`-- ═══════════════════════════════════════════════════════`):

```sql
    -- ── Personal Push Subscriptions (REQ-007) ──
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

    -- ── Notification Preferences (REQ-007) ──
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

Also add indexes in the Indexes section (before line 679 `\`);`):

```sql
    CREATE INDEX IF NOT EXISTS idx_pps_nodeId ON personal_push_subscriptions(personalNodeId);
    CREATE INDEX IF NOT EXISTS idx_pps_ownerName ON personal_push_subscriptions(ownerName);
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: FAIL (same as before — `SqliteStorage` doesn't implement methods yet)

**Step 3: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/schema.ts
git commit -m "feat(REQ-007): add personal_push_subscriptions and notification_preferences tables"
```

---

### Task 4: SQLite Implementation

**Files:**
- Modify: `aimeat/src/storage/providers/sqlite/index.ts` (add methods at end of class, before `close()`)

**Step 1: Add NotificationRepository implementation**

Add a new section at the end of the `SqliteStorage` class (before the closing `}`), following the existing section pattern:

```typescript
  // ══════════════════════════════════════════════════════════
  // ── Personal Push Subscriptions (REQ-007) ──
  // ══════════════════════════════════════════════════════════

  async createPersonalPushSubscription(record: PersonalPushSubscriptionRecord): Promise<PersonalPushSubscriptionRecord> {
    this.db.prepare(
      `INSERT INTO personal_push_subscriptions (id, personalNodeId, ownerName, endpoint, keys, failureCount, createdAt, lastUsedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.id,
      record.personalNodeId,
      record.ownerName,
      record.endpoint,
      JSON.stringify(record.keys),
      record.failureCount,
      record.createdAt,
      record.lastUsedAt,
    );
    return record;
  }

  async getPersonalPushSubscription(id: string): Promise<PersonalPushSubscriptionRecord | null> {
    const row = this.db.prepare('SELECT * FROM personal_push_subscriptions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      ownerName: row.ownerName as string,
      endpoint: row.endpoint as string,
      keys: JSON.parse(row.keys as string),
      failureCount: row.failureCount as number,
      createdAt: row.createdAt as string,
      lastUsedAt: row.lastUsedAt as string | null,
    };
  }

  async listPersonalPushSubscriptions(personalNodeId: string): Promise<PersonalPushSubscriptionRecord[]> {
    const rows = this.db.prepare('SELECT * FROM personal_push_subscriptions WHERE personalNodeId = ?').all(personalNodeId) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as string,
      personalNodeId: row.personalNodeId as string,
      ownerName: row.ownerName as string,
      endpoint: row.endpoint as string,
      keys: JSON.parse(row.keys as string),
      failureCount: row.failureCount as number,
      createdAt: row.createdAt as string,
      lastUsedAt: row.lastUsedAt as string | null,
    }));
  }

  async updatePersonalPushSubscription(id: string, updates: Partial<PersonalPushSubscriptionRecord>): Promise<boolean> {
    const existing = await this.getPersonalPushSubscription(id);
    if (!existing) return false;
    const merged = { ...existing, ...updates };
    this.db.prepare(
      `UPDATE personal_push_subscriptions SET failureCount = ?, lastUsedAt = ? WHERE id = ?`
    ).run(merged.failureCount, merged.lastUsedAt, id);
    return true;
  }

  async deletePersonalPushSubscription(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM personal_push_subscriptions WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async deletePersonalPushSubscriptionsByNode(personalNodeId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM personal_push_subscriptions WHERE personalNodeId = ?').run(personalNodeId);
    return result.changes;
  }

  async countPersonalPushSubscriptions(personalNodeId: string): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM personal_push_subscriptions WHERE personalNodeId = ?').get(personalNodeId) as { cnt: number };
    return row.cnt;
  }

  // ══════════════════════════════════════════════════════════
  // ── Notification Preferences (REQ-007) ──
  // ══════════════════════════════════════════════════════════

  async getNotificationPreferences(personalNodeId: string): Promise<NotificationPreferences | null> {
    const row = this.db.prepare('SELECT * FROM notification_preferences WHERE personalNodeId = ?').get(personalNodeId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      personalNodeId: row.personalNodeId as string,
      enabled: row.enabled === 1,
      channels: JSON.parse(row.channels as string),
      notifyTypes: JSON.parse(row.notifyTypes as string),
      cooldownMinutes: row.cooldownMinutes as number,
      quietHoursUtc: row.quietHoursUtc ? JSON.parse(row.quietHoursUtc as string) : null,
      email: row.email as string | null,
    };
  }

  async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    this.db.prepare(
      `INSERT INTO notification_preferences (personalNodeId, enabled, channels, notifyTypes, cooldownMinutes, quietHoursUtc, email)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(personalNodeId) DO UPDATE SET
         enabled = excluded.enabled,
         channels = excluded.channels,
         notifyTypes = excluded.notifyTypes,
         cooldownMinutes = excluded.cooldownMinutes,
         quietHoursUtc = excluded.quietHoursUtc,
         email = excluded.email`
    ).run(
      prefs.personalNodeId,
      prefs.enabled ? 1 : 0,
      JSON.stringify(prefs.channels),
      JSON.stringify(prefs.notifyTypes),
      prefs.cooldownMinutes,
      prefs.quietHoursUtc ? JSON.stringify(prefs.quietHoursUtc) : null,
      prefs.email,
    );
    return prefs;
  }

  async deleteNotificationPreferences(personalNodeId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM notification_preferences WHERE personalNodeId = ?').run(personalNodeId);
    return result.changes > 0;
  }
```

**Step 2: Add import for new types**

At the top of `aimeat/src/storage/providers/sqlite/index.ts`, add `PersonalPushSubscriptionRecord` and `NotificationPreferences` to the existing import from `../../interface.js`.

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — `SqliteStorage` now implements all `NotificationRepository` methods.

**Step 4: Commit**

```bash
git add aimeat/src/storage/providers/sqlite/index.ts
git commit -m "feat(REQ-007): implement NotificationRepository in SQLite storage"
```

---

### Task 5: Config Additions

**Files:**
- Modify: `aimeat/src/config.ts` (add new config fields + loading)
- Modify: `aimeat/.env.example` (add new env vars)

**Step 1: Add config fields**

In `aimeat/src/config.ts`, add after the `vapidSubject` field (line 150):

```typescript
  pushNotifyTypes: string[];          // message types that trigger push notification
  pushCooldownMin: number;            // minimum minutes between notifications per node
  pushMaxSubscriptionsPerNode: number; // max push subscriptions per personal node
  pushMaxFailures: number;            // auto-remove subscription after N consecutive failures
  emailRateLimitMin: number;          // minimum minutes between email notifications per node
```

**Step 2: Add loading in loadConfig()**

In `aimeat/src/config.ts`, add after the `vapidSubject` loading (line 326):

```typescript
    pushNotifyTypes: (process.env.AIMEAT_PUSH_NOTIFY_TYPES ?? 'work_assignment,action_request').split(',').map(s => s.trim()),
    pushCooldownMin: parseInt(process.env.AIMEAT_PUSH_COOLDOWN_MIN ?? '5', 10),
    pushMaxSubscriptionsPerNode: parseInt(process.env.AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE ?? '5', 10),
    pushMaxFailures: parseInt(process.env.AIMEAT_PUSH_MAX_FAILURES ?? '3', 10),
    emailRateLimitMin: parseInt(process.env.AIMEAT_EMAIL_RATE_LIMIT_MIN ?? '30', 10),
```

**Step 3: Update .env.example**

In `aimeat/.env.example`, add after the existing push section (line 151):

```bash
# AIMEAT_PUSH_NOTIFY_TYPES="work_assignment,action_request"  # message types that trigger push notification
# AIMEAT_PUSH_COOLDOWN_MIN=5                                 # minimum minutes between notifications per node
# AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE=5                   # max push subscriptions per personal node
# AIMEAT_PUSH_MAX_FAILURES=3                                 # auto-remove subscription after N consecutive failures
# AIMEAT_EMAIL_RATE_LIMIT_MIN=30                             # minimum minutes between email notifications per node
```

**Step 4: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add aimeat/src/config.ts aimeat/.env.example
git commit -m "feat(REQ-007): add push notification config vars"
```

---

### Task 6: MailboxNotificationService — Web Push

**Files:**
- Create: `aimeat/src/services/mailbox-notification.ts`

**Step 1: Create the service**

Create `aimeat/src/services/mailbox-notification.ts`:

```typescript
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, MailboxItemRecord, PersonalPushSubscriptionRecord, NotificationPreferences } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

export interface MailboxPushPayload {
  type: 'mailbox_alert';
  node_id: string;
  pending_count: number;
  highest_priority_type: string;
  oldest_item_age_minutes: number;
  operator_node: string;
  timestamp: string;
}

export interface NotifyResult {
  sent: boolean;
  channel?: string;
  reason?: string;
}

/** Allowed push service domains (SSRF prevention) */
const ALLOWED_PUSH_DOMAINS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'notify.windows.com',
  'push.apple.com',
  'web.push.apple.com',
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ALLOWED_PUSH_DOMAINS.some(domain =>
      url.hostname === domain || url.hostname.endsWith('.' + domain),
    );
  } catch {
    return false;
  }
}

/** Default notification preferences for a new node */
function defaultPreferences(personalNodeId: string, config: AimeatConfig): NotificationPreferences {
  return {
    personalNodeId,
    enabled: true,
    channels: ['web_push'],
    notifyTypes: [...config.pushNotifyTypes],
    cooldownMinutes: config.pushCooldownMin,
    quietHoursUtc: null,
    email: null,
  };
}

export class MailboxNotificationService {
  private webpush: typeof import('web-push') | null = null;
  private cooldownMap = new Map<string, number>();       // nodeId -> last notification timestamp (ms)
  private emailCooldownMap = new Map<string, number>();  // nodeId -> last email timestamp (ms)

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {
    if (config.pushEnabled && config.vapidPublicKey && config.vapidPrivateKey) {
      try {
        this.webpush = require('web-push') as typeof import('web-push');
        this.webpush.setVapidDetails(
          config.vapidSubject,
          config.vapidPublicKey,
          config.vapidPrivateKey,
        );
        logger.info('MailboxNotificationService: web-push initialized');
      } catch (err) {
        logger.warn('MailboxNotificationService: failed to initialize web-push', { error: String(err) });
      }
    }
  }

  /**
   * Notify the owner of a personal node that a message has been queued.
   * Fire-and-forget — callers should `void` this.
   */
  async notify(personalNodeId: string, mailboxItem: MailboxItemRecord): Promise<NotifyResult> {
    try {
      // 1. Load preferences (use defaults if none stored)
      const prefs = (await this.storage.getNotificationPreferences(personalNodeId))
        ?? defaultPreferences(personalNodeId, this.config);

      // 2. Master switch
      if (!prefs.enabled) {
        return { sent: false, reason: 'notifications_disabled' };
      }

      // 3. Type filter
      if (!prefs.notifyTypes.includes(mailboxItem.type)) {
        return { sent: false, reason: 'type_not_configured' };
      }

      // 4. Cooldown check (web push)
      const now = Date.now();
      const lastNotified = this.cooldownMap.get(personalNodeId) ?? 0;
      const cooldownMs = prefs.cooldownMinutes * 60_000;
      if (now - lastNotified < cooldownMs) {
        return { sent: false, reason: 'cooldown_active' };
      }

      // 5. Quiet hours check
      if (this.isInQuietHours(prefs)) {
        return { sent: false, reason: 'quiet_hours' };
      }

      // 6. Build payload
      const stats = await this.storage.getMailboxStats(personalNodeId);
      const items = await this.storage.listMailboxItems(personalNodeId);
      const oldestAge = items.length > 0
        ? Math.round((now - new Date(items[0].createdAt).getTime()) / 60_000)
        : 0;

      const payload: MailboxPushPayload = {
        type: 'mailbox_alert',
        node_id: personalNodeId,
        pending_count: stats.count,
        highest_priority_type: mailboxItem.type,
        oldest_item_age_minutes: oldestAge,
        operator_node: this.config.nodeId,
        timestamp: new Date().toISOString(),
      };

      let sentAny = false;

      // 7. Web Push channel
      if (prefs.channels.includes('web_push') && this.webpush) {
        const subscriptions = await this.storage.listPersonalPushSubscriptions(personalNodeId);
        for (const sub of subscriptions) {
          const ok = await this.sendWebPush(sub, payload);
          if (ok) sentAny = true;
        }
      }

      // 8. Email channel (Phase 2 — implemented later)
      if (prefs.channels.includes('email') && prefs.email) {
        const emailSent = await this.sendEmail(personalNodeId, prefs.email, payload);
        if (emailSent) sentAny = true;
      }

      // 9. Update cooldown
      if (sentAny) {
        this.cooldownMap.set(personalNodeId, now);
      }

      return { sent: sentAny, channel: sentAny ? 'web_push' : undefined };
    } catch (err) {
      logger.error('MailboxNotificationService.notify failed', { personalNodeId, error: String(err) });
      return { sent: false, reason: 'internal_error' };
    }
  }

  /** Clear cooldown when a node reconnects (cancel pending notification window) */
  clearCooldown(personalNodeId: string): void {
    this.cooldownMap.delete(personalNodeId);
    this.emailCooldownMap.delete(personalNodeId);
  }

  private async sendWebPush(sub: PersonalPushSubscriptionRecord, payload: MailboxPushPayload): Promise<boolean> {
    if (!this.webpush) return false;
    try {
      await this.webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({
          title: 'AIMEAT: Pending messages',
          body: `${payload.pending_count} message(s) waiting — ${payload.highest_priority_type}`,
          icon: '/icons/icon-192.png',
          tag: 'mailbox-alert',
          data: payload,
        }),
        { TTL: 3600 },
      );
      // Success: update lastUsedAt, reset failureCount
      await this.storage.updatePersonalPushSubscription(sub.id, {
        lastUsedAt: new Date().toISOString(),
        failureCount: 0,
      });
      logger.info('Web push notification sent', { nodeId: sub.personalNodeId, subId: sub.id });
      return true;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired — remove immediately
        await this.storage.deletePersonalPushSubscription(sub.id);
        logger.info('Push subscription expired, removed', { subId: sub.id, nodeId: sub.personalNodeId });
      } else {
        // Increment failure count
        const newCount = sub.failureCount + 1;
        if (newCount >= this.config.pushMaxFailures) {
          await this.storage.deletePersonalPushSubscription(sub.id);
          logger.warn('Push subscription removed after max failures', { subId: sub.id, failures: newCount });
        } else {
          await this.storage.updatePersonalPushSubscription(sub.id, { failureCount: newCount });
          logger.warn('Push notification failed', { subId: sub.id, failureCount: newCount, error: String(err) });
        }
      }
      return false;
    }
  }

  /** Phase 2 stub — email sending (implemented in Phase 2) */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendEmail(_personalNodeId: string, _email: string, _payload: MailboxPushPayload): Promise<boolean> {
    // Phase 2 implementation — see Task 10
    return false;
  }

  private isInQuietHours(prefs: NotificationPreferences): boolean {
    if (!prefs.quietHoursUtc) return false;
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    const [startH, startM] = prefs.quietHoursUtc.start.split(':').map(Number);
    const [endH, endM] = prefs.quietHoursUtc.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes <= endMinutes) {
      // Same-day range (e.g., 09:00-17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight range (e.g., 22:00-07:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }
}
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/services/mailbox-notification.ts
git commit -m "feat(REQ-007): add MailboxNotificationService with web push, cooldown, quiet hours"
```

---

### Task 7: Integration — Wire into routeToPersonalNode

**Files:**
- Modify: `aimeat/src/services/personal-routing.ts` (add notification param + trigger)
- Modify: `aimeat/src/routes/work.ts` (pass notification service)
- Modify: `aimeat/src/server.ts` (create service instance, pass to router)
- Modify: `aimeat/src/routes/personal.ts` (accept notification service param)

**Step 1: Update routeToPersonalNode signature**

In `aimeat/src/services/personal-routing.ts`, add import and optional param:

```typescript
import type { MailboxNotificationService } from './mailbox-notification.js';
```

Update the function signature to add a 6th optional parameter:

```typescript
export async function routeToPersonalNode(
  tunnelManager: TunnelManager,
  mailboxService: MailboxService,
  storage: Storage,
  targetGaii: string,
  message: {
    type: 'action_request' | 'work_assignment' | 'board_notification' | 'federation_sync';
    fromGaii: string;
    payload: string;
  },
  notificationService?: MailboxNotificationService | null,
): Promise<RoutingResult> {
```

After the successful enqueue (line 89-90), add the notification trigger:

```typescript
  if (queued) {
    // Fire-and-forget push notification to node owner
    if (notificationService) {
      void notificationService.notify(personalNode.nodeId, queued);
    }
    return { delivered: false, queued: true, reason: 'node_offline' };
  }
```

**Step 2: Update server.ts**

In `aimeat/src/server.ts`, add import:

```typescript
import { MailboxNotificationService } from './services/mailbox-notification.js';
```

After the TunnelManager creation block (around line 270), add:

```typescript
  // Mailbox push notification service (REQ-007)
  let mailboxNotificationService: MailboxNotificationService | null = null;
  if (config.personalNodesEnabled && config.pushEnabled && config.vapidPublicKey && config.vapidPrivateKey) {
    mailboxNotificationService = new MailboxNotificationService(config, storage);
    logger.info('Mailbox push notification service initialized');
  }
```

Update the `personalRouter` registration (around line 531) to pass the notification service:

```typescript
  if (config.personalNodesEnabled) {
    app.use(personalRouter(config, storage, tunnelManager, mailboxNotificationService));
  }
```

Add `mailboxNotificationService` to the returned `ServerResult` — or just expose it via the personalRouter so work routes can access it.

**Step 3: Update personalRouter signature**

In `aimeat/src/routes/personal.ts`, update the function signature:

```typescript
import type { MailboxNotificationService } from '../services/mailbox-notification.js';

export function personalRouter(
  config: AimeatConfig,
  storage: Storage,
  tunnelManager: TunnelManager | null,
  notificationService?: MailboxNotificationService | null,
): Router {
```

**Step 4: Update work.ts**

In `aimeat/src/routes/work.ts`, the current mailbox enqueue (lines 196-210) uses `MailboxService` directly. Update this section to also trigger the notification service.

Find the section where mailbox enqueue happens and add the notification call after the enqueue:

```typescript
  if (personalNodeTarget) {
    const { MailboxService } = await import('../services/mailbox.js');
    const mailboxService = new MailboxService(config, storage);
    const queued = await mailboxService.enqueue(personalNodeTarget, {
      personalNodeId: personalNodeTarget,
      type: 'work_assignment',
      fromGaii: requesterGaii,
      toGaii: provider_gaii,
      payload: JSON.stringify({
        event: 'work.assigned',
        tracking_code: trackingCode,
        action_id,
        input,
      }),
      sizeBytes: 0,
      retentionDays: 7,
    }).catch(err => {
      logger.warn('Failed to queue work notification for personal node', { nodeId: personalNodeTarget, error: String(err) });
      return null;
    });

    // Fire-and-forget push notification (REQ-007)
    if (queued && mailboxNotificationService) {
      void mailboxNotificationService.notify(personalNodeTarget, queued);
    }
  }
```

Note: `mailboxNotificationService` needs to be accessible in work.ts. The cleanest approach is to add it as a parameter to `workRouter()`, matching the existing pattern where `tunnelManager` is passed to `personalRouter()`.

In `aimeat/src/server.ts`, find where `workRouter` is registered and pass the notification service.

In `aimeat/src/routes/work.ts`, update the router function signature to accept the notification service:

```typescript
import type { MailboxNotificationService } from '../services/mailbox-notification.js';
// ... in router function signature:
export function workRouter(config: AimeatConfig, storage: Storage, ..., notificationService?: MailboxNotificationService | null): Router {
```

**Step 5: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add aimeat/src/services/personal-routing.ts aimeat/src/routes/personal.ts aimeat/src/routes/work.ts aimeat/src/server.ts
git commit -m "feat(REQ-007): integrate MailboxNotificationService into routing pipeline"
```

---

### Task 8: Push Subscription Routes

**Files:**
- Modify: `aimeat/src/routes/personal.ts` (add push subscription endpoints)

**Step 1: Add push subscription routes**

Add before the `return router;` line in `personalRouter()`:

```typescript
  // ── Push Notification Subscription Routes (REQ-007) ──

  // POST /v1/personal/push/subscribe — Register a Web Push subscription for a personal node
  router.post('/v1/personal/push/subscribe', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const ownerName = req.auth!.owner;
      const { personalNodeId, endpoint, keys } = req.body;

      if (!personalNodeId || !endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Missing personalNodeId, endpoint, or keys (p256dh, auth)'));
        return;
      }

      // Verify node exists and belongs to owner
      const node = await storage.getPersonalNode(personalNodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${personalNodeId} not found`));
        return;
      }
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only subscribe to your own personal nodes'));
        return;
      }

      // Validate endpoint URL (SSRF prevention)
      const { isAllowedPushEndpoint } = await import('../services/mailbox-notification.js');
      if (!isAllowedPushEndpoint(endpoint)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'Push endpoint URL is not from an allowed push service'));
        return;
      }

      // Check subscription limit
      const count = await storage.countPersonalPushSubscriptions(personalNodeId);
      if (count >= config.pushMaxSubscriptionsPerNode) {
        res.status(409).json(error(config.nodeId, 'LIMIT_REACHED', `Maximum ${config.pushMaxSubscriptionsPerNode} push subscriptions per node`));
        return;
      }

      const { v4: uuidv4 } = await import('uuid');
      const record = await storage.createPersonalPushSubscription({
        id: uuidv4(),
        personalNodeId,
        ownerName,
        endpoint,
        keys,
        failureCount: 0,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      });

      res.status(201).json(success(config.nodeId, {
        id: record.id,
        personalNodeId: record.personalNodeId,
        createdAt: record.createdAt,
      }, [
        { description: 'Test push notification', method: 'POST', url: `/v1/personal/push/test/${encodeURIComponent(personalNodeId)}` },
        { description: 'List subscriptions', method: 'GET', url: `/v1/personal/push/subscriptions/${encodeURIComponent(personalNodeId)}` },
        { description: 'Unsubscribe', method: 'DELETE', url: `/v1/personal/push/subscribe/${encodeURIComponent(record.id)}` },
      ]));
    } catch (err) {
      logger.error('Failed to create push subscription', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to create push subscription'));
    }
  });

  // DELETE /v1/personal/push/subscribe/:id — Remove a push subscription
  router.delete('/v1/personal/push/subscribe/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const subId = req.params.id as string;
      const ownerName = req.auth!.owner;

      const sub = await storage.getPersonalPushSubscription(subId);
      if (!sub) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Push subscription not found'));
        return;
      }
      if (sub.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only remove your own subscriptions'));
        return;
      }

      await storage.deletePersonalPushSubscription(subId);

      res.json(success(config.nodeId, { deleted: true, id: subId }));
    } catch (err) {
      logger.error('Failed to delete push subscription', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to delete push subscription'));
    }
  });

  // GET /v1/personal/push/subscriptions/:nodeId — List push subscriptions for a node
  router.get('/v1/personal/push/subscriptions/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only view subscriptions for your own personal nodes'));
        return;
      }

      const subs = await storage.listPersonalPushSubscriptions(nodeId);

      res.json(success(config.nodeId, {
        subscriptions: subs.map(s => ({
          id: s.id,
          endpoint: s.endpoint.substring(0, 60) + '...', // truncate for privacy
          failureCount: s.failureCount,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
        })),
        count: subs.length,
        max: config.pushMaxSubscriptionsPerNode,
      }));
    } catch (err) {
      logger.error('Failed to list push subscriptions', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to list push subscriptions'));
    }
  });

  // POST /v1/personal/push/test/:nodeId — Send a test notification
  router.post('/v1/personal/push/test/:nodeId', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only test notifications for your own personal nodes'));
        return;
      }

      if (!notificationService) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'Push notifications not configured on this node'));
        return;
      }

      // Create a synthetic mailbox item for the test
      const testItem: MailboxItemRecord = {
        id: 'test-' + Date.now(),
        personalNodeId: nodeId,
        type: 'action_request',
        fromGaii: 'test@' + config.nodeId,
        toGaii: node.agentGaiis[0] ?? 'test-agent',
        payload: '{}',
        sizeBytes: 0,
        retentionDays: 0,
        expiresAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const result = await notificationService.notify(nodeId, testItem);

      res.json(success(config.nodeId, {
        test: true,
        ...result,
      }));
    } catch (err) {
      logger.error('Failed to send test notification', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to send test notification'));
    }
  });
```

Note: add the `MailboxItemRecord` import at the top of the file:

```typescript
import type { Storage, MailboxItemRecord } from '../storage/interface.js';
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/personal.ts
git commit -m "feat(REQ-007): add push subscription routes (subscribe, unsubscribe, list, test)"
```

---

### Task 9: Cascade Cleanup

**Files:**
- Modify: `aimeat/src/routes/personal.ts` (delete subscriptions + preferences when node is deregistered)

**Step 1: Update the DELETE /v1/personal/anchor/:nodeId handler**

In the delete handler (around line 214-215, after `await storage.deleteMailboxItemsByNode(nodeId);`), add:

```typescript
      // Clean up push subscriptions and notification preferences
      await storage.deletePersonalPushSubscriptionsByNode(nodeId);
      await storage.deleteNotificationPreferences(nodeId);
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/personal.ts
git commit -m "feat(REQ-007): cascade delete push subscriptions when personal node is deregistered"
```

---

## Phase 2: Email Channel

### Task 10: Email Sending

**Files:**
- Modify: `aimeat/src/services/mailbox-notification.ts` (implement sendEmail)

**Step 1: Add nodemailer dependency**

Run: `cd aimeat && pnpm add nodemailer && pnpm add -D @types/nodemailer`

**Step 2: Implement email sending**

In `MailboxNotificationService`, add nodemailer transport initialization in the constructor:

```typescript
import type { Transporter } from 'nodemailer';

// In constructor, after web-push init:
private emailTransport: Transporter | null = null;

// In constructor body:
if (config.smtpHost && config.smtpUser) {
  try {
    const nodemailer = require('nodemailer') as typeof import('nodemailer');
    this.emailTransport = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass ?? '',
      },
    });
    logger.info('MailboxNotificationService: email transport initialized');
  } catch (err) {
    logger.warn('MailboxNotificationService: failed to initialize email transport', { error: String(err) });
  }
}
```

Replace the `sendEmail` stub:

```typescript
private async sendEmail(personalNodeId: string, email: string, payload: MailboxPushPayload): Promise<boolean> {
  if (!this.emailTransport) return false;

  // Check email-specific rate limit
  const now = Date.now();
  const lastEmail = this.emailCooldownMap.get(personalNodeId) ?? 0;
  const emailCooldownMs = this.config.emailRateLimitMin * 60_000;
  if (now - lastEmail < emailCooldownMs) {
    return false;
  }

  try {
    await this.emailTransport.sendMail({
      from: this.config.smtpFrom,
      to: email,
      subject: `AIMEAT: ${payload.pending_count} pending message(s) for your node`,
      text: [
        `Your personal node "${payload.node_id}" has ${payload.pending_count} pending message(s).`,
        '',
        `Highest priority: ${payload.highest_priority_type}`,
        `Oldest message: ${payload.oldest_item_age_minutes} minutes ago`,
        '',
        'Please reconnect your personal node to retrieve these messages.',
        `Operator: ${payload.operator_node}`,
        '',
        '---',
        'This notification was sent by the AIMEAT Protocol.',
        'To unsubscribe, update your notification preferences via PATCH /v1/personal/anchor/<nodeId>/notifications',
      ].join('\n'),
    });

    this.emailCooldownMap.set(personalNodeId, now);
    logger.info('Email notification sent', { personalNodeId, email: email.substring(0, 3) + '***' });
    return true;
  } catch (err) {
    logger.error('Email notification failed', { personalNodeId, error: String(err) });
    return false;
  }
}
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/services/mailbox-notification.ts package.json pnpm-lock.yaml
git commit -m "feat(REQ-007): implement email notification channel with rate limiting"
```

---

## Phase 3: Preferences & Polish

### Task 11: Notification Preferences Routes

**Files:**
- Modify: `aimeat/src/routes/personal.ts` (add GET/PATCH preferences endpoints)

**Step 1: Add preferences routes**

Add before the `return router;` line:

```typescript
  // ── Notification Preferences Routes (REQ-007 Phase 3) ──

  // GET /v1/personal/anchor/:nodeId/notifications — Get notification preferences
  router.get('/v1/personal/anchor/:nodeId/notifications', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only view preferences for your own personal nodes'));
        return;
      }

      const prefs = await storage.getNotificationPreferences(nodeId);
      const defaults: NotificationPreferences = {
        personalNodeId: nodeId,
        enabled: true,
        channels: ['web_push'],
        notifyTypes: [...config.pushNotifyTypes],
        cooldownMinutes: config.pushCooldownMin,
        quietHoursUtc: null,
        email: null,
      };

      res.json(success(config.nodeId, {
        preferences: prefs ?? defaults,
        is_default: prefs === null,
      }, [
        { description: 'Update preferences', method: 'PATCH', url: `/v1/personal/anchor/${encodeURIComponent(nodeId)}/notifications` },
      ]));
    } catch (err) {
      logger.error('Failed to get notification preferences', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to get notification preferences'));
    }
  });

  // PATCH /v1/personal/anchor/:nodeId/notifications — Update notification preferences
  router.patch('/v1/personal/anchor/:nodeId/notifications', requireAuth(), requireRole('owner'), async (req, res) => {
    try {
      const nodeId = req.params.nodeId as string;
      const ownerName = req.auth!.owner;

      const node = await storage.getPersonalNode(nodeId);
      if (!node) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Personal node ${nodeId} not found`));
        return;
      }
      if (node.ownerName !== ownerName && !req.auth!.roles.includes('operator')) {
        res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Can only update preferences for your own personal nodes'));
        return;
      }

      const { enabled, channels, notifyTypes, cooldownMinutes, quietHoursUtc, email } = req.body;

      // Validate channels
      const validChannels = ['web_push', 'email'];
      if (channels && !Array.isArray(channels)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'channels must be an array'));
        return;
      }
      if (channels && channels.some((c: string) => !validChannels.includes(c))) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', `channels must be one of: ${validChannels.join(', ')}`));
        return;
      }

      // Validate cooldownMinutes
      if (cooldownMinutes !== undefined && (typeof cooldownMinutes !== 'number' || cooldownMinutes < 1 || cooldownMinutes > 1440)) {
        res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'cooldownMinutes must be between 1 and 1440'));
        return;
      }

      // Validate quiet hours
      if (quietHoursUtc !== undefined && quietHoursUtc !== null) {
        const timeRegex = /^\d{2}:\d{2}$/;
        if (!quietHoursUtc.start || !quietHoursUtc.end || !timeRegex.test(quietHoursUtc.start) || !timeRegex.test(quietHoursUtc.end)) {
          res.status(400).json(error(config.nodeId, 'VALIDATION_ERROR', 'quietHoursUtc must have start and end in HH:MM format'));
          return;
        }
      }

      // Load existing or defaults
      const existing = await storage.getNotificationPreferences(nodeId) ?? {
        personalNodeId: nodeId,
        enabled: true,
        channels: ['web_push'] as ('web_push' | 'email')[],
        notifyTypes: [...config.pushNotifyTypes],
        cooldownMinutes: config.pushCooldownMin,
        quietHoursUtc: null,
        email: null,
      };

      const updated = await storage.upsertNotificationPreferences({
        ...existing,
        ...(enabled !== undefined && { enabled }),
        ...(channels !== undefined && { channels }),
        ...(notifyTypes !== undefined && { notifyTypes }),
        ...(cooldownMinutes !== undefined && { cooldownMinutes }),
        ...(quietHoursUtc !== undefined && { quietHoursUtc }),
        ...(email !== undefined && { email }),
      });

      res.json(success(config.nodeId, { preferences: updated }));
    } catch (err) {
      logger.error('Failed to update notification preferences', { error: err });
      res.status(500).json(error(config.nodeId, 'INTERNAL_ERROR', 'Failed to update notification preferences'));
    }
  });
```

Add the `NotificationPreferences` import at the top:

```typescript
import type { Storage, MailboxItemRecord, NotificationPreferences } from '../storage/interface.js';
```

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/personal.ts
git commit -m "feat(REQ-007): add notification preferences API (GET/PATCH)"
```

---

### Task 12: Tunnel Reconnect — Clear Cooldown

**Files:**
- Modify: `aimeat/src/services/personal-tunnel.ts` (clear cooldown on reconnect)

**Step 1: Update TunnelManager to accept notification service**

Add optional notification service to TunnelManager constructor:

```typescript
import type { MailboxNotificationService } from './mailbox-notification.js';

export class TunnelManager {
  // ... existing fields ...
  private notificationService: MailboxNotificationService | null = null;

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) { }

  setNotificationService(service: MailboxNotificationService | null): void {
    this.notificationService = service;
  }
```

In `handleConnection()`, after updating status to online (around line 51-54), add:

```typescript
    // Clear notification cooldown — node is back online (REQ-007)
    this.notificationService?.clearCooldown(nodeId);
```

**Step 2: Wire it up in server.ts**

After creating `mailboxNotificationService`, add:

```typescript
  if (tunnelManager && mailboxNotificationService) {
    tunnelManager.setNotificationService(mailboxNotificationService);
  }
```

**Step 3: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add aimeat/src/services/personal-tunnel.ts aimeat/src/server.ts
git commit -m "feat(REQ-007): clear notification cooldown when personal node reconnects"
```

---

### Task 13: Push Stats Integration

**Files:**
- Modify: `aimeat/src/routes/stats.ts` (or wherever `GET /v1/stats` is handled)

**Step 1: Find and update stats endpoint**

Add push notification stats to the existing stats response. In the stats route handler, add a new section:

```typescript
// Push notification stats (REQ-007)
const pushStats = config.personalNodesEnabled ? {
  push_notification_service: config.pushEnabled && config.vapidPublicKey ? 'active' : 'disabled',
} : undefined;
```

Include `pushStats` in the response data object.

**Step 2: Run type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add aimeat/src/routes/stats.ts
git commit -m "feat(REQ-007): add push notification status to stats endpoint"
```

---

### Task 14: Final Type Check and Build

**Files:** None new — verification only.

**Step 1: Full type check**

Run: `cd aimeat && npx tsc --noEmit`
Expected: PASS — zero errors

**Step 2: Build**

Run: `cd aimeat && pnpm build`
Expected: PASS — clean production build

**Step 3: Verify existing E2E tests still pass**

Run: `cd aimeat && pnpm dev` (in one terminal)
Run: `cd aimeat && npx tsx test/e2e-full.ts` (in another)
Expected: All 35+ existing tests pass (no regressions)

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore(REQ-007): verify clean build and test pass after mailbox push notification implementation"
```

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| 1 | Tasks 1-9 | Storage types, SQLite, MailboxNotificationService, routing integration, push subscription routes, cascade cleanup |
| 2 | Task 10 | Email channel via nodemailer, email rate limiting |
| 3 | Tasks 11-14 | Preferences API, tunnel reconnect cooldown clear, stats, final verification |

**Total files created:** 2 (`mailbox-notification.ts`, `notification.repository.ts`)
**Total files modified:** ~8 (`interface.ts`, `schema.ts`, `sqlite/index.ts`, `config.ts`, `personal-routing.ts`, `personal.ts`, `work.ts`, `server.ts`, `personal-tunnel.ts`)
