export default async function(ctx, input) {
  if (!input.listingId) throw new Error('listingId is required');

  const listing = await ctx.memory.get('listing.' + input.listingId);
  if (!listing) throw new Error('Listing not found');
  if (listing.seller !== ctx.caller.gaii) throw new Error('Only the seller can update this listing');
  if (listing.status !== 'active' && listing.status !== 'paused') {
    throw new Error('Cannot update a listing with status: ' + listing.status);
  }

  // Apply allowed updates
  if (input.title) listing.title = input.title;
  if (input.description) listing.description = input.description;
  if (typeof input.price === 'number' && input.price > 0) listing.price = input.price;
  if (input.category) {
    const categories = ctx.instance.config.categories || ['general'];
    if (!categories.includes(input.category)) {
      throw new Error(`Invalid category. Allowed: ${categories.join(', ')}`);
    }
    listing.category = input.category;
  }
  if (input.status && (input.status === 'active' || input.status === 'paused')) {
    listing.status = input.status;
  }

  listing.updatedAt = new Date().toISOString();
  await ctx.memory.set('listing.' + input.listingId, listing);

  ctx.log.info('Listing updated', { listingId: input.listingId });

  return { listing };
}
