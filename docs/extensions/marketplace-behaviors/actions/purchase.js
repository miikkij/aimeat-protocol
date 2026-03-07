export default async function(ctx, input) {
  // Check instance access
  const visibility = ctx.instance.config.visibility || 'public';
  if (visibility === 'password') {
    if (input._password !== ctx.instance.config.password) {
      throw new Error('Invalid marketplace password');
    }
  } else if (visibility === 'invite') {
    const allowed = ctx.instance.config.allowed_users || [];
    if (!allowed.includes(ctx.caller.gaii) && !ctx.caller.roles.includes('operator')) {
      throw new Error('You are not invited to this marketplace');
    }
  }

  if (!input.listingId) throw new Error('listingId is required');

  // Read listing
  const listing = await ctx.memory.get('listing.' + input.listingId);
  if (!listing) throw new Error('Listing not found');
  if (listing.status !== 'active') throw new Error('Listing is not available');
  if (listing.seller === ctx.caller.gaii) throw new Error('Cannot purchase your own listing');

  // Calculate total with transaction fee
  const feePercent = ctx.instance.config.transaction_fee_percent ?? ctx.config.transaction_fee_percent ?? 5;
  const total = listing.price + Math.ceil(listing.price * feePercent / 100);

  // Debit buyer
  const result = await ctx.wallet.consume(total, 'marketplace_purchase');
  if (!result.success) throw new Error(result.error || 'Insufficient morsels for purchase');

  // Create purchase record
  const purchaseId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await ctx.memory.set('purchase.' + purchaseId, {
    purchaseId,
    listingId: input.listingId,
    buyer: ctx.caller.gaii,
    seller: listing.seller,
    price: listing.price,
    fee: total - listing.price,
    total,
    status: 'purchased',
    purchasedAt: new Date().toISOString(),
  });

  // Reserve listing
  listing.status = 'reserved';
  await ctx.memory.set('listing.' + input.listingId, listing);

  ctx.log.info('Purchase completed', { purchaseId, buyer: ctx.caller.gaii, total });

  return { purchaseId, total, status: 'purchased' };
}
