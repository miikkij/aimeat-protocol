# Push Notification Templates — Editable, Localized, with Test Button

**Date:** 2026-03-07
**Status:** Approved

## Summary

Add editable, per-locale notification templates to the admin push tab. Operators can customize push/email notification text per language, test push delivery to themselves, and reset templates to defaults.

## Storage

### `NotificationTemplateRecord`

```typescript
interface NotificationTemplateRecord {
  id: string;              // "web_push_mailbox", "email_mailbox"
  locale: string;          // "en", "fi"
  fields: {
    title?: string;        // web push title (null for email)
    body: string;          // web push body or email body
    subject?: string;      // email subject (null for web push)
  };
  placeholders: string[];  // informational: ["{count}", "{type}", "{nodeId}", "{age}"]
  updatedAt: string;
  updatedBy: string;       // operator owner name
}
```

**Composite key:** `id` + `locale`.

### Storage interface additions

```typescript
getNotificationTemplate(id: string, locale: string): Promise<NotificationTemplateRecord | null>;
upsertNotificationTemplate(record: NotificationTemplateRecord): Promise<NotificationTemplateRecord>;
listNotificationTemplates(): Promise<NotificationTemplateRecord[]>;
deleteAllNotificationTemplates(): Promise<void>;
```

## Template IDs and Placeholders

| ID | Channel | Placeholders |
|----|---------|-------------|
| `web_push_mailbox` | Web Push | `{count}`, `{type}` |
| `email_mailbox` | Email | `{count}`, `{type}`, `{nodeId}`, `{age}` |

## Default Templates

Hardcoded in backend as constants. Used as fallback when no stored template exists.

### English (`en`)

**web_push_mailbox:**
- title: `AIMEAT: Pending messages`
- body: `{count} message(s) waiting — {type}`

**email_mailbox:**
- subject: `AIMEAT: {count} pending message(s) for your node`
- body: `Your personal node "{nodeId}" has {count} pending message(s).\n\nHighest priority: {type}\nOldest message: {age} minutes ago\n\nPlease reconnect your personal node to retrieve these messages.`

### Finnish (`fi`)

**web_push_mailbox:**
- title: `AIMEAT: Odottavia viesteja`
- body: `{count} viesti(a) odottaa — {type}`

**email_mailbox:**
- subject: `AIMEAT: {count} odottavaa viestia solmullesi`
- body: `Henkilokohtaisella solmullasi "{nodeId}" on {count} odottavaa viestia.\n\nKorkein prioriteetti: {type}\nVanhin viesti: {age} minuuttia sitten\n\nYhdista solmusi uudelleen hakeaksesi viestit.`

## Admin API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /v1/admin/push` | GET | Existing + adds `templates[]` and `locales: ["en", "fi"]` |
| `PUT /v1/admin/push/templates/:id/:locale` | PUT | Save/update a template |
| `POST /v1/admin/push/test` | POST | Send test notification to operator (themselves) |
| `POST /v1/admin/push/templates/reset` | POST | Reset all templates to defaults (en + fi) — overwrites stored versions |

### Test endpoint behavior

1. Look up the authenticated operator's push subscription
2. Send a web push with title "AIMEAT Test" / body "Push notifications are working!"
3. Return `{ sent: true }` or error if no subscription found

### Reset endpoint behavior

1. Delete all existing notification templates from storage
2. Insert all default templates (en + fi) for every template ID
3. Return `{ reset: true, count: N }` with number of templates written

## Backend: Template Resolution

`mailbox-notification.ts` changes:

- `sendWebPush()`: before sending, call `storage.getNotificationTemplate("web_push_mailbox", recipientLocale)`. If found, use stored fields with placeholder substitution. If not found, use hardcoded defaults.
- `sendEmail()`: same pattern with `"email_mailbox"` template ID.
- Recipient locale comes from `NotificationPreferences.locale` (new field, defaults to `"en"`).

### Placeholder substitution

Simple string replacement: `template.body.replace(/\{count\}/g, String(count))` etc. No complex templating engine needed.

## Push Tab UI Changes

### Test button (top of tab)
- "Send Test Notification" button in the stats area
- Calls `POST /v1/admin/push/test`
- Shows success/error feedback inline

### Locale selector
- Tab-style row `[EN] [FI]` above the template cards
- Switches which locale's templates are displayed/edited
- Default: first locale in the list

### Editable template cards
- Current static `<code>` blocks become `<input>` (title, subject) and `<textarea>` (body)
- Pre-filled with stored values, or defaults if no stored template
- Placeholder badges shown below each field (e.g. `{count}`, `{type}`)
- "Save" button per card calls `PUT /v1/admin/push/templates/:id/:locale`
- Visual feedback on save (brief green flash or checkmark)

### Reset button
- "Reset to Default Templates" button at bottom of templates section
- Shows confirm dialog before executing
- Calls `POST /v1/admin/push/templates/reset`
- Reloads template data after reset

## Files to Modify

### Backend
1. `src/storage/interface.ts` — add `NotificationTemplateRecord` type + Storage methods
2. `src/storage/memory.ts` — implement in-memory
3. `src/storage/providers/mongodb/index.ts` — implement MongoDB
4. `src/storage/providers/sqlite/schema.ts` + `sqlite/index.ts` — implement SQLite
5. `src/services/notification-templates.ts` — NEW: default templates, placeholder substitution, resolution logic
6. `src/services/mailbox-notification.ts` — use template resolution instead of hardcoded strings
7. `src/routes/admin-features.ts` — add PUT templates, POST test, POST reset endpoints; extend GET /v1/admin/push response

### Frontend
8. `public/js/services/admin.js` — add API calls: `savePushTemplate`, `testPush`, `resetPushTemplates`
9. `public/views/admin/push-tab.js` — rewrite template section with editable fields, locale tabs, test button, reset button
10. `locales/en.json` + `locales/fi.json` — add dashboard i18n keys for new UI elements

## Implementation Order

1. Storage interface + memory implementation
2. `notification-templates.ts` service (defaults + resolution)
3. Admin API endpoints
4. Wire template resolution into `mailbox-notification.ts`
5. MongoDB + SQLite implementations
6. Frontend: admin.js API calls
7. Frontend: push-tab.js UI
8. Locales (en + fi)
9. Type-check + test
