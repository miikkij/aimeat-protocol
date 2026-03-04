import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

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

  constructor(
    private config: AimeatConfig,
    private storage: Storage,
  ) {}

  handleConnection(ws: WebSocket, nodeId: string, ownerName: string, agentGaiis: string[]): void {
    // Close existing connection for this nodeId if any
    const existing = this.connections.get(nodeId);
    if (existing) {
      try { existing.ws.close(1000, 'replaced'); } catch { /* ignore */ }
    }

    const conn: PersonalNodeConnection = {
      nodeId,
      ws,
      ownerName,
      lastHeartbeat: Date.now(),
      agentGaiis,
    };
    this.connections.set(nodeId, conn);

    // Update storage status to online
    this.storage.updatePersonalNode(nodeId, {
      status: 'online',
      lastSeen: new Date().toISOString(),
    }).catch(err => logger.error('Failed to update personal node status', { nodeId, error: err }));

    logger.info('Personal node connected', { nodeId, ownerName, agents: agentGaiis.length });

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
        logger.error('Invalid tunnel message', { nodeId, error: err });
      }
    });

    ws.on('close', () => {
      this.connections.delete(nodeId);
      this.storage.updatePersonalNode(nodeId, {
        status: 'offline',
        lastSeen: new Date().toISOString(),
      }).catch(err => logger.error('Failed to update personal node status on disconnect', { nodeId, error: err }));
      logger.info('Personal node disconnected', { nodeId });
    });

    ws.on('error', (err) => {
      logger.error('Personal node WebSocket error', { nodeId, error: err.message });
    });
  }

  private handleMessage(nodeId: string, msg: TunnelMessage): void {
    const conn = this.connections.get(nodeId);
    if (!conn) return;

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
          .catch(() => { /* ignore */ });
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
              this.storage.deleteMailboxItem(id).catch(() => { /* ignore */ });
            }
            logger.info('Mailbox items acknowledged and deleted', { nodeId, count: itemIds.length });
          } catch { /* ignore parse errors */ }
        }
        break;
      }

      case 'disconnect': {
        // Graceful disconnect from personal node
        conn.ws.close(1000, 'graceful');
        this.connections.delete(nodeId);
        this.storage.updatePersonalNode(nodeId, {
          status: 'offline',
          lastSeen: new Date().toISOString(),
        }).catch(() => { /* ignore */ });
        logger.info('Personal node gracefully disconnected', { nodeId });
        break;
      }

      default:
        logger.warn('Unknown tunnel message type', { nodeId, type: msg.type });
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

    const effectiveTimeout = timeoutMs ?? this.config.personalNodeRequestTimeoutMs;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(message.id);
        resolve(null);
      }, effectiveTimeout);

      this.pendingResponses.set(message.id, { resolve, timer });
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
          logger.warn('Personal node heartbeat timeout', { nodeId, elapsed });
          conn.ws.close(1000, 'heartbeat_timeout');
          this.connections.delete(nodeId);
          this.storage.updatePersonalNode(nodeId, {
            status: 'offline',
            lastSeen: new Date(conn.lastHeartbeat).toISOString(),
          }).catch(() => { /* ignore */ });
        } else if (elapsed > offlineThreshold * 0.6) {
          // Degraded — heartbeat is late but not dead
          this.storage.updatePersonalNode(nodeId, { status: 'degraded' }).catch(() => { /* ignore */ });
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
      } catch { /* ignore */ }
      this.connections.delete(nodeId);
    }

    logger.info('TunnelManager shut down');
  }
}
