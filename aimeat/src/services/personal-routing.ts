import { v4 as uuidv4 } from 'uuid';
import type { TunnelManager, TunnelMessage } from './personal-tunnel.js';
import { MailboxService } from './mailbox.js';
import type { MailboxNotificationService } from './mailbox-notification.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { getStats } from './stats.js';
import { getPromMetrics } from './prometheus.js';

export interface RoutingResult {
  delivered: boolean;
  response?: TunnelMessage;
  queued?: boolean;
  reason?: string;
}

/**
 * Route a message to an agent on a personal node.
 * If the node is online, forward via WebSocket tunnel and await response.
 * If offline, queue to mailbox and return 202-style result.
 */
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
  // Find which personal node hosts this agent
  const allNodes = await storage.listPersonalNodes();
  const personalNode = allNodes.find(n => n.agentGaiis.includes(targetGaii));

  if (!personalNode) {
    return { delivered: false, reason: 'no_personal_node_found' };
  }

  // Try direct delivery via tunnel
  if (tunnelManager.isOnline(personalNode.nodeId)) {
    const tunnelMsg: TunnelMessage = {
      type: 'request',
      id: uuidv4(),
      from: message.fromGaii,
      to: targetGaii,
      payload: message.payload,
      timestamp: new Date().toISOString(),
    };

    const response = await tunnelManager.sendRequest(personalNode.nodeId, tunnelMsg);
    if (response) {
      // Send delivery receipt back to confirm end-to-end delivery
      const receipt: TunnelMessage = {
        type: 'delivery_receipt',
        id: uuidv4(),
        payload: JSON.stringify({
          original_id: tunnelMsg.id,
          status: 'delivered',
          delivered_at: new Date().toISOString(),
        }),
        timestamp: new Date().toISOString(),
      };
      // Send delivery receipt (fire-and-forget, don't block the response)
      void tunnelManager.sendRequest(personalNode.nodeId, receipt, 5000);

      return { delivered: true, response };
    }

    // Tunnel send failed (timeout or error) — fall through to mailbox
    logger.warn('Tunnel delivery failed, falling back to mailbox', {
      nodeId: personalNode.nodeId,
      targetGaii,
    });
  }

  // Queue to mailbox
  const stats = getStats();
  if (stats) stats.incrementTunnel('mailbox_fallbacks_total');
  const prom = getPromMetrics();
  if (prom) prom.tunnelMailboxFallbacksTotal.inc();
  const retentionDays = message.type === 'board_notification' ? 3 : 7;
  const sizeBytes = Buffer.byteLength(message.payload, 'utf-8');

  const queued = await mailboxService.enqueue(personalNode.nodeId, {
    personalNodeId: personalNode.nodeId,
    type: message.type,
    fromGaii: message.fromGaii,
    toGaii: targetGaii,
    payload: message.payload,
    sizeBytes,
    retentionDays,
  });

  if (queued) {
    // Fire-and-forget push notification to node owner (REQ-007)
    if (notificationService) {
      void notificationService.notify(personalNode.nodeId, queued);
    }
    return { delivered: false, queued: true, reason: 'node_offline' };
  }

  return { delivered: false, queued: false, reason: 'mailbox_full' };
}
