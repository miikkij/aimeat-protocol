/**
 * Marketplace Service — Phase 2.6
 *
 * Business logic for the AIMEAT marketplace: listing creation,
 * purchase flow with escrow, delivery confirmation, and rating.
 */

import { randomBytes } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, ListingRecord, PurchaseRecord } from '../storage/interface.js';

export const VALID_CATEGORIES = ['palvelut', 'tuotteet', 'data', 'osaaminen', 'muu'] as const;
export const VALID_CONDITIONS = ['new', 'used', 'digital'] as const;
export const VALID_AVAILABILITIES = ['immediate', 'on_request', 'scheduled'] as const;

export type MarketplaceCategory = (typeof VALID_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MarketplaceCategory, { fi: string; icon: string }> = {
  palvelut:  { fi: 'Palvelut', icon: '\uD83D\uDEE0\uFE0F' },
  tuotteet:  { fi: 'Tuotteet', icon: '\uD83D\uDCE6' },
  data:      { fi: 'Data', icon: '\uD83D\uDCCA' },
  osaaminen: { fi: 'Osaaminen', icon: '\uD83C\uDF93' },
  muu:       { fi: 'Muu', icon: '\uD83D\uDD39' },
};

function generateId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

function generateTrackingCode(): string {
  return `mkt-${randomBytes(6).toString('hex')}`;
}

/**
 * Create a new marketplace listing.
 * Deducts listing fee from the seller's agent balance.
 */
export async function createListing(
  config: AimeatConfig,
  storage: Storage,
  ownerName: string,
  sellerGhii: string,
  input: {
    title: string;
    description: string;
    category: MarketplaceCategory;
    priceMorsels: number;
    condition?: string;
    availability?: string;
    location?: { city?: string; area?: string };
    tags?: string[];
  },
): Promise<{ listing: ListingRecord; listingFee: number } | { error: string; code: string }> {
  const listingFee = config.marketplaceListingFeeMorsels;

  // Find seller's agent to deduct listing fee
  const agents = await storage.getAgentsByOwner(ownerName);
  if (agents.length === 0) {
    return { error: 'No agent found for this owner', code: 'NO_AGENT' };
  }
  const agent = agents[0];

  if (agent.morselBalance < listingFee) {
    return { error: `Insufficient morsels. Need ${listingFee}, have ${agent.morselBalance}`, code: 'INSUFFICIENT_MORSELS' };
  }

  // Deduct listing fee
  await storage.updateAgent(agent.gaii, {
    morselBalance: agent.morselBalance - listingFee,
  });
  await storage.addTransaction({
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    gaii: agent.gaii,
    type: 'marketplace_listing_fee',
    amount: -listingFee,
    timestamp: new Date().toISOString(),
  });

  const now = new Date().toISOString();
  const id = generateId('lst');
  const memoryKey = `marketplace.${ownerName}.listing.${id}`;

  const listing: ListingRecord = {
    id,
    ownerName,
    sellerGhii,
    title: input.title,
    description: input.description,
    category: input.category,
    priceMorsels: input.priceMorsels,
    condition: input.condition as ListingRecord['condition'],
    availability: input.availability as ListingRecord['availability'],
    location: input.location,
    tags: input.tags ?? [],
    images: [],
    status: 'active',
    memoryKey,
    flagCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  const created = await storage.createListing(listing);
  return { listing: created, listingFee };
}

/**
 * Purchase a listing.
 * Calculates total cost (price + transaction fee), deducts from buyer, creates escrow.
 */
export async function purchaseListing(
  config: AimeatConfig,
  storage: Storage,
  listingId: string,
  buyerOwner: string,
): Promise<{ purchase: PurchaseRecord; totalCost: number; breakdown: { price: number; transactionFee: number } } | { error: string; code: string }> {
  const listing = await storage.getListing(listingId);
  if (!listing) {
    return { error: 'Listing not found', code: 'NOT_FOUND' };
  }
  if (listing.status !== 'active') {
    return { error: 'Listing is not available for purchase', code: 'NOT_AVAILABLE' };
  }
  if (listing.ownerName === buyerOwner) {
    return { error: 'Cannot purchase your own listing', code: 'SELF_PURCHASE' };
  }

  const feePercent = config.marketplaceTransactionFeePercent;
  const transactionFee = Math.ceil(listing.priceMorsels * feePercent / 100);
  const totalCost = listing.priceMorsels + transactionFee;

  // Find buyer's agent
  const buyerAgents = await storage.getAgentsByOwner(buyerOwner);
  if (buyerAgents.length === 0) {
    return { error: 'No agent found for buyer', code: 'NO_AGENT' };
  }
  const buyerAgent = buyerAgents[0];

  if (buyerAgent.morselBalance < totalCost) {
    return { error: `Insufficient morsels. Need ${totalCost}, have ${buyerAgent.morselBalance}`, code: 'INSUFFICIENT_MORSELS' };
  }

  // Deduct from buyer (escrow)
  await storage.updateAgent(buyerAgent.gaii, {
    morselBalance: buyerAgent.morselBalance - totalCost,
  });
  await storage.addTransaction({
    id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    gaii: buyerAgent.gaii,
    type: 'marketplace_escrow_hold',
    amount: -totalCost,
    timestamp: new Date().toISOString(),
  });

  const now = new Date().toISOString();
  const purchase: PurchaseRecord = {
    id: generateId('pur'),
    listingId,
    buyerOwner,
    sellerOwner: listing.ownerName,
    priceMorsels: listing.priceMorsels,
    transactionFeeMorsels: transactionFee,
    totalCostMorsels: totalCost,
    status: 'pending_delivery',
    trackingCode: generateTrackingCode(),
    createdAt: now,
  };

  const created = await storage.createPurchase(purchase);

  // Mark listing as sold
  await storage.updateListing(listingId, { status: 'sold', updatedAt: now });

  return {
    purchase: created,
    totalCost,
    breakdown: { price: listing.priceMorsels, transactionFee },
  };
}

/**
 * Seller marks a purchase as delivered.
 * Releases escrow: price goes to seller, transaction fee burned/operator.
 */
export async function deliverPurchase(
  config: AimeatConfig,
  storage: Storage,
  purchaseId: string,
  sellerOwner: string,
): Promise<{ purchase: PurchaseRecord } | { error: string; code: string }> {
  const purchase = await storage.getPurchase(purchaseId);
  if (!purchase) {
    return { error: 'Purchase not found', code: 'NOT_FOUND' };
  }
  if (purchase.sellerOwner !== sellerOwner) {
    return { error: 'Only the seller can mark delivery', code: 'FORBIDDEN' };
  }
  if (purchase.status !== 'pending_delivery') {
    return { error: `Cannot deliver purchase in status: ${purchase.status}`, code: 'INVALID_STATUS' };
  }

  // Release escrow to seller
  const sellerAgents = await storage.getAgentsByOwner(sellerOwner);
  if (sellerAgents.length > 0) {
    const sellerAgent = sellerAgents[0];
    await storage.updateAgent(sellerAgent.gaii, {
      morselBalance: sellerAgent.morselBalance + purchase.priceMorsels,
    });
    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii: sellerAgent.gaii,
      type: 'marketplace_sale_earned',
      amount: purchase.priceMorsels,
      timestamp: new Date().toISOString(),
    });
  }

  // Transaction fee is burned (not given to anyone)
  if (purchase.transactionFeeMorsels > 0) {
    await storage.addTransaction({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      gaii: `system@${config.nodeId}`,
      type: 'marketplace_fee_burned',
      amount: -purchase.transactionFeeMorsels,
      timestamp: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const updated = await storage.updatePurchase(purchaseId, {
    status: 'delivered',
    completedAt: now,
  });

  return { purchase: updated! };
}

/**
 * Buyer rates a completed purchase.
 * Adjusts seller's trust score.
 */
export async function ratePurchase(
  storage: Storage,
  purchaseId: string,
  buyerOwner: string,
  score: number,
  comment?: string,
): Promise<{ purchase: PurchaseRecord } | { error: string; code: string }> {
  const purchase = await storage.getPurchase(purchaseId);
  if (!purchase) {
    return { error: 'Purchase not found', code: 'NOT_FOUND' };
  }
  if (purchase.buyerOwner !== buyerOwner) {
    return { error: 'Only the buyer can rate a purchase', code: 'FORBIDDEN' };
  }
  if (purchase.status !== 'delivered' && purchase.status !== 'completed') {
    return { error: 'Can only rate delivered or completed purchases', code: 'INVALID_STATUS' };
  }
  if (purchase.rating) {
    return { error: 'Purchase already rated', code: 'ALREADY_RATED' };
  }
  if (score < 1 || score > 5 || !Number.isInteger(score)) {
    return { error: 'Score must be an integer between 1 and 5', code: 'VALIDATION_ERROR' };
  }

  // Update purchase with rating and mark completed
  const updated = await storage.updatePurchase(purchaseId, {
    rating: { score, comment },
    status: 'completed',
  });

  // Adjust seller trust score
  const sellerAgents = await storage.getAgentsByOwner(purchase.sellerOwner);
  if (sellerAgents.length > 0) {
    const sellerAgent = sellerAgents[0];
    // Simple trust adjustment: +2 per star above 3, -3 per star below 3
    const adjustment = score >= 3 ? (score - 3) * 2 : (score - 3) * 3;
    const newTrust = Math.max(0, Math.min(100, sellerAgent.trustScore + adjustment));
    await storage.updateAgent(sellerAgent.gaii, { trustScore: newTrust });
  }

  return { purchase: updated! };
}
