/**
 * @file src/services/personal-tunnel.ts
 * @description WebSocket tunnel manager linking a genesis node to owners' personal (home) nodes:
 *   maintains per-node connections, correlates request/response messages, runs heartbeats, and syncs
 *   queued mailbox items to a node when it reconnects.
 *
 * @structure
 *   - TunnelMessage / PersonalNodeConnection: the wire protocol + per-connection state types
 *   - TunnelManager: connection registry, pending-response map, and heartbeat loop
 *   - handleConnection(): registers a node's socket, replacing any stale existing connection
 *   - setNotificationService(): wires optional mailbox-notification delivery
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { MailboxNotificationService } from './mailbox-notification.js';
import { logger } from '../utils/logger.js';
import { getStats } from './stats.js';
import { getPromMetrics } from './prometheus.js';

export interface TunnelMessage {
  type: 'request' | 'response' | 'mailbox_sync' | 'mailbox_ack' | 'heartbeat' | 'heartbeat_ack' | 'disconnect' | 'welcome' | 'delivery_receipt';
  id: string;
  from?: string;
  to?: string;
  payload?: string;
  timestamp: string;
}

export interface PersonalNodeConnection {
  nodeId: string;
  ws: WebSocket;
  ownerName: string;
  lastHeartbeat: number;
  agentGaiis: string[];
}

export class TunnelManager {
  private connections = new Map<string, PersonalNodeConnection>();
  private pendingResponses = new Map<string, { resolve: (msg: TunnelMessage | null) => void; timer: ReturnType<typeof setTimeout> }>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private notificationService: MailboxNotificationService | null = null;

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) { }

  setNotificationService(service: MailboxNotificationService | null): void {
    this.notificationService = service;
  }

  handleConnection(ws: WebSocket, nodeId: string, ownerName: string, agentGaiis: string[]): void {
    // Close existing connection for this nodeId if any
    const existing = this.connections.get(nodeId);
    if (existing) {
      try { existing.ws.close(1000, 'replaced'); } catch (err) { logger.warn('handleConnection: ignore', { error: String(err) }); }
    }

    const conn: PersonalNodeConnection = {
      nodeId,
      ws,
      ownerName,
      lastHeartbeat: Date.now(),
      agentGaiis,
    };
    this.connections.set(nodeId, conn);

    const stats = getStats();
    const prom = getPromMetrics();
    if (stats) {
      if (existing) stats.incrementTunnel('reconnects_total');
      stats.incrementTunnel('connections_total');
      stats.setTunnelGauge('connections_active', this.connections.size);
    }
    if (prom) {
      if (existing) prom.tunnelReconnectsTotal.inc();
      prom.tunnelConnectionsTotal.inc();
      prom.tunnelConnectionsActive.set(this.connections.size);
    }

    // Update storage status to online
    this.storage.updatePersonalNode(nodeId, {
      status: 'online',
      lastSeen: new Date().toISOString(),
    }).catch(err => logger.error('Failed to update personal node status', { nodeId, error: err }));

    // Clear notification cooldown — node is back online (REQ-007)
    this.notificationService?.clearCooldown(nodeId);

    logger.info('Personal node connected', {
      event: 'tunnel.connect',
      personal_node_id: nodeId,
      ownerName,
      agents: agentGaiis.length,
    });

    // Send welcome message with protocol hints
    const welcome: TunnelMessage = {
      type: 'welcome',
      id: uuidv4(),
      payload: JSON.stringify({
        protocol_version: '1.0',
        heartbeat_interval_ms: this.config.personalNodeHeartbeatIntervalMs,
        offline_threshold_ms: this.config.personalNodeOfflineThresholdMs,
        request_timeout_ms: this.config.personalNodeRequestTimeoutMs,
        reconnect_hint: {
          strategy: 'exponential_backoff',
          base_ms: 1000,
          max_ms: 60000,
          jitter: true,
        },
      }),
      timestamp: new Date().toISOString(),
    };
    ws.send(JSON.stringify(welcome));

    // Send initial message with mailbox summary
    this.sendMailboxSummary(nodeId, ws);

    ws.on('message', (data) => {
      try {
        const msg: TunnelMessage = JSON.parse(data.toString());
        this.handleMessage(nodeId, msg);
      } catch (err) {
        logger.error('Invalid tunnel message', {
          event: 'tunnel.error',
          personal_node_id: nodeId,
          error: err,
        });
      }
    });

    ws.on('close', () => {
      this.connections.delete(nodeId);
      const stats = getStats();
      if (stats) {
        stats.incrementTunnel('disconnections_total');
        stats.setTunnelGauge('connections_active', this.connections.size);
      }
      const prom2 = getPromMetrics();
      if (prom2) {
        prom2.tunnelDisconnectionsTotal.inc({ reason: 'clean' });
        prom2.tunnelConnectionsActive.set(this.connections.size);
      }
      this.storage.updatePersonalNode(nodeId, {
        status: 'offline',
        lastSeen: new Date().toISOString(),
      }).catch(err => logger.error('Failed to update personal node status on disconnect', { nodeId, error: err }));
      logger.info('Personal node disconnected', {
        event: 'tunnel.disconnect',
        personal_node_id: nodeId,
        reason: 'clean',
      });
    });

    ws.on('error', (err) => {
      logger.error('Personal node WebSocket error', {
        event: 'tunnel.error',
        personal_node_id: nodeId,
        error: err.message,
      });
    });
  }

  private handleMessage(nodeId: string, msg: TunnelMessage): void {
    const conn = this.connections.get(nodeId);
    if (!conn) return;

    const stats = getStats();
    const prom = getPromMetrics();
    if (stats) stats.incrementTunnel('messages_received_total');
    if (prom) prom.tunnelMessagesReceivedTotal.inc({ type: msg.type });

    switch (msg.type) {
      case 'heartbeat': {
        conn.lastHeartbeat = Date.now();
        const ack: TunnelMessage = {
          type: 'heartbeat_ack',
          id: msg.id,
          timestamp: new Date().toISOString(),
        };
        conn.ws.send(JSON.stringify(ack));
        // Update lastSeen
        this.storage.updatePersonalNode(nodeId, { lastSeen: new Date().toISOString() })
          .catch(err => { logger.warn('handleConnection: ignore', { error: String(err) }); });
        break;
      }

      case 'response': {
        // Response to a forwarded request
        const pending = this.pendingResponses.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingResponses.delete(msg.id);
          pending.resolve(msg);
        }
        break;
      }

      case 'mailbox_ack': {
        // Personal node acknowledges receipt of mailbox items
        // The payload contains an array of item IDs that were received
        if (msg.payload) {
          try {
            const itemIds: string[] = JSON.parse(msg.payload);
            for (const id of itemIds) {
              this.storage.deleteMailboxItem(id).catch(err => { logger.warn('handleConnection: ignore', { error: String(err) }); });
            }
            const stats3 = getStats();
            if (stats3) {
              for (let i = 0; i < itemIds.length; i++) stats3.incrementMailbox('delivered_total');
            }
            const prom3 = getPromMetrics();
            if (prom3) prom3.mailboxDeliveredTotal.inc(itemIds.length);
            logger.info('Mailbox items acknowledged and deleted', { nodeId, count: itemIds.length });
          } catch (err) { logger.warn('handleConnection: ignore parse errors', { error: String(err) }); }
        }
        break;
      }

      case 'disconnect': {
        // Graceful disconnect from personal node
        conn.ws.close(1000, 'graceful');
        this.connections.delete(nodeId);
        const stats2 = getStats();
        if (stats2) {
          stats2.incrementTunnel('disconnections_total');
          stats2.setTunnelGauge('connections_active', this.connections.size);
        }
        const prom4 = getPromMetrics();
        if (prom4) {
          prom4.tunnelDisconnectionsTotal.inc({ reason: 'graceful' });
          prom4.tunnelConnectionsActive.set(this.connections.size);
        }
        this.storage.updatePersonalNode(nodeId, {
          status: 'offline',
          lastSeen: new Date().toISOString(),
        }).catch(err => { logger.warn('handleConnection: ignore', { error: String(err) }); });
        logger.info('Personal node gracefully disconnected', {
          event: 'tunnel.disconnect',
          personal_node_id: nodeId,
          reason: 'graceful',
        });
        break;
      }

      default:
        logger.warn('Unknown tunnel message type', {
          event: 'tunnel.error',
          personal_node_id: nodeId,
          type: msg.type,
        });
    }
  }

  private async sendMailboxSummary(nodeId: string, ws: WebSocket): Promise<void> {
    try {
      const stats = await this.storage.getMailboxStats(nodeId);
      const items = await this.storage.listMailboxItems(nodeId);

      const summary: TunnelMessage = {
        type: 'mailbox_sync',
        id: uuidv4(),
        payload: JSON.stringify({
          items: stats.count,
          total_bytes: stats.totalBytes,
          oldest: items.length > 0 ? items[0].createdAt : null,
          newest: items.length > 0 ? items[items.length - 1].createdAt : null,
          by_type: items.reduce((acc, item) => {
            acc[item.type] = (acc[item.type] ?? 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          // Include the actual items for immediate delivery
          mailbox_items: items.map(i => ({
            id: i.id,
            type: i.type,
            from: i.fromGaii,
            to: i.toGaii,
            payload: i.payload,
            created_at: i.createdAt,
          })),
        }),
        timestamp: new Date().toISOString(),
      };

      ws.send(JSON.stringify(summary));
      if (stats.count > 0) {
        logger.info('Mailbox summary sent to personal node', { nodeId, items: stats.count });
      }
    } catch (err) {
      logger.error('Failed to send mailbox summary', { nodeId, error: err });
    }
  }

  async sendRequest(nodeId: string, message: TunnelMessage, timeoutMs?: number): Promise<TunnelMessage | null> {
    const conn = this.connections.get(nodeId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return null;
    }

    const stats = getStats();
    const prom = getPromMetrics();
    if (stats) stats.incrementTunnel('messages_sent_total');
    if (prom) prom.tunnelMessagesSentTotal.inc({ type: message.type });

    const effectiveTimeout = timeoutMs ?? this.config.personalNodeRequestTimeoutMs;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        if (stats) stats.incrementTunnel('delivery_failures_total');
        if (prom) prom.tunnelDeliveryFailuresTotal.inc();
        resolve(null);
      }, effectiveTimeout);

      this.pendingResponses.set(message.id, {
        resolve: (msg) => {
          const latency = Date.now() - startTime;
          if (msg && stats) {
            stats.recordDeliveryLatency(latency);
          }
          if (msg && prom) {
            prom.tunnelDeliveryLatencyMs.observe(latency);
          }
          resolve(msg);
        },
        timer,
      });
      conn.ws.send(JSON.stringify(message));
    });
  }

  isOnline(nodeId: string): boolean {
    const conn = this.connections.get(nodeId);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }

  getConnection(nodeId: string): PersonalNodeConnection | undefined {
    return this.connections.get(nodeId);
  }

  getOnlineCount(): number {
    return this.connections.size;
  }

  startHeartbeatMonitor(): void {
    const checkInterval = Math.max(this.config.personalNodeHeartbeatIntervalMs, 10000);
    const offlineThreshold = this.config.personalNodeOfflineThresholdMs;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [nodeId, conn] of this.connections) {
        const elapsed = now - conn.lastHeartbeat;

        if (elapsed > offlineThreshold) {
          // Node hasn't sent heartbeat — mark offline and close
          logger.warn('Personal node heartbeat timeout', {
            event: 'tunnel.timeout',
            personal_node_id: nodeId,
            elapsed_ms: elapsed,
          });
          conn.ws.close(1000, 'heartbeat_timeout');
          this.connections.delete(nodeId);
          const stats = getStats();
          if (stats) {
            stats.incrementTunnel('heartbeat_misses_total');
            stats.incrementTunnel('disconnections_total');
            stats.setTunnelGauge('connections_active', this.connections.size);
          }
          const promHb = getPromMetrics();
          if (promHb) {
            promHb.tunnelHeartbeatMissesTotal.inc();
            promHb.tunnelDisconnectionsTotal.inc({ reason: 'heartbeat_timeout' });
            promHb.tunnelConnectionsActive.set(this.connections.size);
          }
          this.storage.updatePersonalNode(nodeId, {
            status: 'offline',
            lastSeen: new Date(conn.lastHeartbeat).toISOString(),
          }).catch(err => { logger.warn('startHeartbeatMonitor: ignore', { error: String(err) }); });
        } else if (elapsed > offlineThreshold * 0.6) {
          // Degraded — heartbeat is late but not dead
          logger.warn('Personal node heartbeat late', {
            event: 'tunnel.heartbeat_miss',
            personal_node_id: nodeId,
            elapsed_ms: elapsed,
          });
          this.storage.updatePersonalNode(nodeId, { status: 'degraded' }).catch(err => { logger.warn('startHeartbeatMonitor: ignore', { error: String(err) }); });
        }
      }
    }, checkInterval);

    logger.info('Personal node heartbeat monitor started', { checkInterval, offlineThreshold });
  }

  async shutdown(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all pending responses
    for (const [id, pending] of this.pendingResponses) {
      clearTimeout(pending.timer);
      pending.resolve(null);
      this.pendingResponses.delete(id);
    }

    // Close all connections
    for (const [nodeId, conn] of this.connections) {
      try {
        conn.ws.close(1000, 'shutdown');
      } catch (err) { logger.warn('shutdown: ignore', { error: String(err) }); }
      this.connections.delete(nodeId);
    }

    logger.info('TunnelManager shut down');
  }
}
