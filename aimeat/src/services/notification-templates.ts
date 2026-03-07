/**
 * Notification Templates Service — Phase 3.2
 *
 * Default templates, placeholder substitution, and resolution logic
 * for push and email notifications.
 */

import type { Storage, NotificationTemplateRecord } from '../storage/interface.js';

export const TEMPLATE_IDS = ['web_push_mailbox', 'email_mailbox'] as const;
export type TemplateId = typeof TEMPLATE_IDS[number];

export const SUPPORTED_LOCALES = ['en', 'fi'] as const;

interface TemplateFields {
  title?: string;
  body: string;
  subject?: string;
}

interface DefaultTemplate {
  id: TemplateId;
  fields: TemplateFields;
  placeholders: string[];
}

const DEFAULTS: Record<string, Record<TemplateId, DefaultTemplate>> = {
  en: {
    web_push_mailbox: {
      id: 'web_push_mailbox',
      fields: {
        title: 'AIMEAT: Pending messages',
        body: '{count} message(s) waiting \u2014 {type}',
      },
      placeholders: ['{count}', '{type}'],
    },
    email_mailbox: {
      id: 'email_mailbox',
      fields: {
        subject: 'AIMEAT: {count} pending message(s) for your node',
        body: 'Your personal node "{nodeId}" has {count} pending message(s).\n\nHighest priority: {type}\nOldest message: {age} minutes ago\n\nPlease reconnect your personal node to retrieve these messages.',
      },
      placeholders: ['{count}', '{type}', '{nodeId}', '{age}'],
    },
  },
  fi: {
    web_push_mailbox: {
      id: 'web_push_mailbox',
      fields: {
        title: 'AIMEAT: Odottavia viestej\u00e4',
        body: '{count} viesti(\u00e4) odottaa \u2014 {type}',
      },
      placeholders: ['{count}', '{type}'],
    },
    email_mailbox: {
      id: 'email_mailbox',
      fields: {
        subject: 'AIMEAT: {count} odottavaa viesti\u00e4 solmullesi',
        body: 'Henkil\u00f6kohtaisella solmullasi "{nodeId}" on {count} odottavaa viesti\u00e4.\n\nKorkein prioriteetti: {type}\nVanhin viesti: {age} minuuttia sitten\n\nYhdist\u00e4 solmusi uudelleen hakeaksesi viestit.',
      },
      placeholders: ['{count}', '{type}', '{nodeId}', '{age}'],
    },
  },
};

/** Get default template for a given id and locale (falls back to en) */
export function getDefaultTemplate(id: TemplateId, locale: string): DefaultTemplate {
  const localeDefaults = DEFAULTS[locale] ?? DEFAULTS.en;
  return localeDefaults[id];
}

/** Get all default templates for all locales */
export function getAllDefaults(): Array<{ id: TemplateId; locale: string; fields: TemplateFields; placeholders: string[] }> {
  const result: Array<{ id: TemplateId; locale: string; fields: TemplateFields; placeholders: string[] }> = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const id of TEMPLATE_IDS) {
      const def = DEFAULTS[locale][id];
      result.push({ id, locale, fields: def.fields, placeholders: def.placeholders });
    }
  }
  return result;
}

/** Substitute placeholders in a string: {count}, {type}, {nodeId}, {age} */
export function substitutePlaceholders(text: string, vars: Record<string, string | number>): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = key.startsWith('{') ? key : `{${key}}`;
    result = result.replaceAll(placeholder, String(value));
  }
  return result;
}

/**
 * Resolve a template: try storage first, fall back to defaults.
 * Returns the fields with placeholders already substituted.
 */
export async function resolveTemplate(
  storage: Storage,
  id: TemplateId,
  locale: string,
  vars: Record<string, string | number>,
): Promise<TemplateFields> {
  // Try stored template for requested locale
  let record = await storage.getNotificationTemplate(id, locale);
  // Fall back to English stored template
  if (!record && locale !== 'en') {
    record = await storage.getNotificationTemplate(id, 'en');
  }

  const fields = record
    ? record.fields
    : getDefaultTemplate(id, locale).fields;

  return {
    title: fields.title ? substitutePlaceholders(fields.title, vars) : undefined,
    body: substitutePlaceholders(fields.body, vars),
    subject: fields.subject ? substitutePlaceholders(fields.subject, vars) : undefined,
  };
}

/** Seed all default templates into storage (used by reset endpoint) */
export async function seedDefaultTemplates(storage: Storage, operatorName: string): Promise<number> {
  await storage.deleteAllNotificationTemplates();
  const defaults = getAllDefaults();
  const now = new Date().toISOString();
  for (const def of defaults) {
    await storage.upsertNotificationTemplate({
      id: def.id,
      locale: def.locale,
      fields: def.fields,
      placeholders: def.placeholders,
      updatedAt: now,
      updatedBy: operatorName,
    });
  }
  return defaults.length;
}
