/**
 * Match Notification Service — Phase 1.6
 *
 * Background job that periodically scans the directory index for
 * new matches and sends email notifications to users who opted in.
 */

import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { EmailService } from './email.js';
import type { DirectoryService, DirectoryEntry } from './directory.js';
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

      const stats = directoryService.getStats();
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

        // Find email for this user via GHII record
        try {
          const ghiiRecord = await storage.getGHII(existing.ghii);
          if (!ghiiRecord?.emailHash) continue;

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

          // Look up email from recent verification records for this owner
          const verifications = await storage.getEmailVerificationsByOwner?.(ghiiRecord.ownerName);
          if (!verifications || verifications.length === 0) continue;
          const verified = verifications.find(v => v.status === 'verified');
          if (!verified) continue;

          // We can't get the email from a hash, so for match notifications
          // we rely on the verification record having been created with the email.
          // In a production system, email would be stored encrypted.
          // For now, log and skip (the notification framework is in place).
          logger.info('Match notification would send', {
            recipientGhii: existing.ghii,
            matchCount: matches.length,
          });
        } catch {
          // Skip users we can't find email for
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
