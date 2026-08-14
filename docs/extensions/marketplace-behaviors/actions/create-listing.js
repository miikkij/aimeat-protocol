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

  // Validate required fields
  if (!input.title || typeof input.title !== 'string') throw new Error('Title is required');
  if (!input.description || typeof input.description !== 'string') throw new Error('Description is required');
  if (typeof input.price !== 'number' || input.price <= 0) throw new Error('Price must be a positive number');

  // Validate category against instance config
  const categories = ctx.instance.config.categories || ['general'];
  const category = input.category || categories[0];
  if (!categories.includes(category)) {
    throw new Error(`Invalid category. Allowed: ${categories.join(', ')}`);
  }

  // Charge listing fee
  const fee = ctx.instance.config.listing_fee_morsels ?? ctx.config.listing_fee_morsels ?? 2;
  const result = await ctx.wallet.consume(fee, 'listing_fee');
  if (!result.success) throw new Error(result.error || 'Insufficient morsels for listing fee');

  // Generate listing ID and store
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const listing = {
    id,
    title: input.title,
    description: input.description,
    price: input.price,
    category,
    seller: ctx.caller.gaii,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await ctx.memory.set('listing.' + id, listing);

  ctx.log.info('Listing created', { listingId: id, seller: ctx.caller.gaii, price: input.price });

  return { listingId: id };
}
