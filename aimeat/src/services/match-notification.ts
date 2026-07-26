/**
 * @file src/services/match-notification.ts
 * @description Background job that periodically rebuilds the directory index, detects newly
 *   appeared profiles/matches, and emails notifications to opted-in users. Skips silently when the
 *   feature or the email service is disabled; the first run only primes the known-set (no emails).
 *
 * @structure
 *   - NotificationState: tracks lastRunAt and the set of already-known GHIIs
 *   - startMatchNotificationJob: sets up the interval job (returns null when disabled) and its run loop
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EmailService } from './email.js';
import type { DirectoryService } from './directory.js';
import type { MatchSuggestion } from './email-templates.js';
import { logger } from '../utils/logger.js';

interface NotificationState {
  lastRunAt: string | null;
  knownGhiis: Set<string>;
}

export function startMatchNotificationJob(
  config: AimeatConfig,
  storage: Storage,
  emailService: EmailService,
  directoryService: DirectoryService,
): NodeJS.Timeout | null {
  if (!config.matchNotificationEnabled) {
    logger.info('Match notification job disabled');
    return null;
  }

  if (!emailService.enabled) {
    logger.info('Match notification job skipped (email not configured)');
    return null;
  }

  const state: NotificationState = {
    lastRunAt: null,
    knownGhiis: new Set(),
  };

  const run = async () => {
    try {
      // Rebuild directory index first to get latest data
      await directoryService.rebuildIndex();

      const allEntries = (await directoryService.search({ perPage: 10000 })).entries;

      if (state.lastRunAt === null) {
        // First run: just populate the known set, don't send notifications
        for (const entry of allEntries) {
          state.knownGhiis.add(entry.ghii);
        }
        state.lastRunAt = new Date().toISOString();
        logger.info('Match notification: initial index populated', { count: allEntries.length });
        return;
      }

      // Find new entries since last run
      const newEntries = allEntries.filter(e => !state.knownGhiis.has(e.ghii));
      if (newEntries.length === 0) {
        state.lastRunAt = new Date().toISOString();
        return;
      }

      logger.info('Match notification: found new entries', { count: newEntries.length });

      // For each existing user, check if any new entries share interests
      for (const existing of allEntries) {
        if (newEntries.some(n => n.ghii === existing.ghii)) continue; // skip new entries themselves

        const matches: MatchSuggestion[] = [];
        for (const newEntry of newEntries) {
          const shared = existing.interests.filter(i =>
            newEntry.interests.map(x => x.toLowerCase()).includes(i.toLowerCase()),
          );
          if (shared.length > 0) {
            let distance: string | undefined;
            if (existing.city && newEntry.city && existing.city.toLowerCase() === newEntry.city.toLowerCase()) {
              distance = existing.city;
            }
            matches.push({
              ghii: newEntry.ghii,
              displayName: newEntry.displayName,
              sharedInterests: shared,
              distance,
            });
          }
        }

        if (matches.length === 0) continue;

        // Find notification email for this user via GHII record
        try {
          const ghiiRecord = await storage.getGHII(existing.ghii);
          if (!ghiiRecord) continue;

          // Check consent for notifications
          const agents = await storage.getAgentsByOwner(ghiiRecord.ownerName);
          let hasNotificationConsent = false;
          for (const agent of agents) {
            const consents = await storage.listConsents(agent.gaii, { status: 'active' });
            if (consents.some(c => c.purpose === 'community-discovery' && c.status === 'active')) {
              hasNotificationConsent = true;
              break;
            }
          }

          if (!hasNotificationConsent) continue;

          // Send match suggestion email if the user has a notification email
          if (ghiiRecord.notificationEmail) {
            await emailService.sendMatchSuggestion(
              ghiiRecord.notificationEmail,
              matches,
              ghiiRecord.locale,
            );
            logger.info('Match notification sent', {
              recipientGhii: existing.ghii,
              matchCount: matches.length,
            });
          } else {
            logger.info('Match notification skipped (no notification email)', {
              recipientGhii: existing.ghii,
              matchCount: matches.length,
            });
          }
        } catch (err) {
          // Skip users we can't find email for
          logger.warn('allEntries: continuing after a suppressed failure', { error: String(err) });
        }
      }

      // Update known set
      for (const entry of newEntries) {
        state.knownGhiis.add(entry.ghii);
      }
      state.lastRunAt = new Date().toISOString();
      logger.info('Match notification run complete', { newEntries: newEntries.length });
    } catch (err) {
      logger.error('Match notification job failed', { error: String(err) });
    }
  };

  const intervalMs = config.matchNotificationIntervalHours * 3_600_000;
  const timer = setInterval(run, intervalMs);

  // Run first check after a delay to let the directory index build
  setTimeout(run, 30_000);

  logger.info('Match notification job scheduled', {
    intervalHours: config.matchNotificationIntervalHours,
  });

  return timer;
}
