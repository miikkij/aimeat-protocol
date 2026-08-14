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

  // Fetch all listings
  const results = await ctx.memory.search('listing.');
  let listings = results.map(r => r.value);

  // Filter by status (default: active only)
  const status = input.status || 'active';
  listings = listings.filter(l => l.status === status);

  // Filter by category
  if (input.category) {
    listings = listings.filter(l => l.category === input.category);
  }

  // Filter by price range
  if (typeof input.minPrice === 'number') {
    listings = listings.filter(l => l.price >= input.minPrice);
  }
  if (typeof input.maxPrice === 'number') {
    listings = listings.filter(l => l.price <= input.maxPrice);
  }

  // Sort by createdAt descending
  listings.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  // Pagination
  const total = listings.length;
  const offset = input.offset || 0;
  const limit = Math.min(input.limit || 20, 100);
  listings = listings.slice(offset, offset + limit);

  ctx.log.info('Browse listings', { total, offset, limit });

  return { listings, total, offset, limit };
}
