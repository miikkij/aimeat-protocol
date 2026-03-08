/**
 * Route Manifest — tracks relay hops through federation for fee settlement.
 * Per RFC v1.6 §13.12.
 */

/** A single hop in the relay chain. */
export interface RouteHop {
  /** Node ID of the relay node that processed this hop. */
  node_id: string;
  /** ISO timestamp when the request was received at this node. */
  received_at: string;
  /** Node ID of the next hop, or null if this is the final destination. */
  forwarded_to: string | null;
  /** Ed25519 signature: sign(node_id + '|' + received_at + '|' + forwarded_to + '|' + prev_signature) */
  signature: string;
}

/** Complete route manifest tracking the full relay path of a work request. */
export interface RouteManifest {
  /** Node ID where the request originated. */
  origin: string;
  /** Ordered list of relay hops from origin to destination. */
  hops: RouteHop[];
  /** Work tracking code this manifest belongs to (if applicable). */
  tracking_code?: string;
}

/** Fee distribution for a settled work item with relay hops. */
export interface RelayFeeDistribution {
  /** Total network fee collected. */
  total_fee: number;
  /** Amount allocated to the origin node. */
  origin_share: number;
  /** Per-relay-node fee share. */
  relay_shares: Array<{ node_id: string; amount: number }>;
  /** Amount allocated to the destination (provider) node. */
  destination_share: number;
  /** Amount burned. */
  burned: number;
}

/**
 * Compute relay fee distribution per §13.12.4.
 * Each relay node receives an equal share of 50% of the network fee.
 * Origin gets 25%, destination gets 25%.
 * Any remainder is burned.
 */
export function computeRelayFeeDistribution(
  networkFee: number,
  hops: RouteHop[],
): RelayFeeDistribution {
  const relayNodes = hops.filter(h => h.forwarded_to !== null);
  const relayCount = relayNodes.length;

  if (relayCount === 0) {
    // Direct connection — no relay fees
    return {
      total_fee: networkFee,
      origin_share: Math.floor(networkFee * 0.5),
      relay_shares: [],
      destination_share: Math.floor(networkFee * 0.5),
      burned: networkFee - Math.floor(networkFee * 0.5) * 2,
    };
  }

  const originShare = Math.floor(networkFee * 0.25);
  const destinationShare = Math.floor(networkFee * 0.25);
  const relayPool = Math.floor(networkFee * 0.50);
  const perRelay = Math.floor(relayPool / relayCount);
  const burned = networkFee - originShare - destinationShare - (perRelay * relayCount);

  return {
    total_fee: networkFee,
    origin_share: originShare,
    relay_shares: relayNodes.map(h => ({ node_id: h.node_id, amount: perRelay })),
    destination_share: destinationShare,
    burned,
  };
}

/**
 * Build the signing message for a route hop.
 * Format: node_id|received_at|forwarded_to|prev_signature
 */
export function buildHopSigningMessage(
  nodeId: string,
  receivedAt: string,
  forwardedTo: string | null,
  prevSignature: string,
): string {
  return `${nodeId}|${receivedAt}|${forwardedTo ?? 'null'}|${prevSignature}`;
}
