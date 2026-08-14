export default async function(ctx, input) {
  if (!input.listingId) throw new Error('listingId is required');

  const listing = await ctx.memory.get('listing.' + input.listingId);
  if (!listing) throw new Error('Listing not found');

  // Only seller or operator can delist
  if (listing.seller !== ctx.caller.gaii && !ctx.caller.roles.includes('operator')) {
    throw new Error('Only the seller or an operator can delist');
  }

  listing.status = 'delisted';
  listing.delistedAt = new Date().toISOString();
  await ctx.memory.set('listing.' + input.listingId, listing);

  ctx.log.info('Listing delisted', { listingId: input.listingId, by: ctx.caller.gaii });

  return { status: 'delisted' };
}
