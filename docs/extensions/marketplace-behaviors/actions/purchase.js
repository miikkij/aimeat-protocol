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

  // The buyer agrees to the listing's money price. This action takes no payment: the buyer pays the
  // seller outside the extension, or through the node's checkout when the seller sells the item as an
  // offer or app tool with a money price. The node has already charged this action's pacing.
  const purchaseId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const currency = listing.currency || ctx.instance.config.currency || ctx.config.currency || 'EUR';
  await ctx.memory.set('purchase.' + purchaseId, {
    purchaseId,
    listingId: input.listingId,
    buyer: ctx.caller.gaii,
    seller: listing.seller,
    price: listing.price,
    currency,
    status: 'agreed',
    agreedAt: new Date().toISOString(),
  }, { visibility: 'private' });

  // Reserve listing
  listing.status = 'reserved';
  await ctx.memory.set('listing.' + input.listingId, listing);

  ctx.log.info('Purchase agreed', { purchaseId, buyer: ctx.caller.gaii, price: listing.price, currency });

  return { purchaseId, price: listing.price, currency, status: 'agreed' };
}
