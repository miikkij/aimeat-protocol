export default async function(ctx, input) {
  // 1. Read the listing from memory
  const listing = await ctx.memory.get(input.listingKey);
  if (!listing) throw new Error('Listing not found');
  if (listing.status && listing.status !== 'active') {
    throw new Error('Listing not available');
  }

  // 2. Verify buyer has marketplace consent
  await ctx.consent.require(ctx.caller.gaii, 'marketplace-listing');

  // 3. Calculate total with transaction fee
  const feePercent = ctx.config.transaction_fee_percent || 5;
  const fee = ctx.config.escrow_enabled !== false
    ? Math.ceil(listing.price_morsels * (feePercent / 100))
    : 0;
  const total = listing.price_morsels + fee;

  // 4. Hold funds in escrow
  const hold = await ctx.wallet.hold(ctx.caller.gaii, total, 'marketplace_purchase');

  // 5. Create purchase record in memory
  const purchaseId = hold.holdId;
  await ctx.memory.set(`marketplace.purchases.${purchaseId}`, {
    listingKey: input.listingKey,
    buyerGaii: ctx.caller.gaii,
    sellerGaii: listing.seller_ghii,
    price: listing.price_morsels,
    fee: fee,
    status: 'purchased',
    purchasedAt: new Date().toISOString(),
  });

  // 6. Update listing status
  await ctx.memory.set(input.listingKey, { ...listing, status: 'purchased' });

  ctx.log.info('Purchase completed', {
    purchaseId,
    buyer: ctx.caller.gaii,
    price: listing.price_morsels,
  });

  return { purchaseId, status: 'purchased' };
}
