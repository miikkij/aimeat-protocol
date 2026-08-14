export default async function(ctx, input) {
  if (!input.purchaseId) throw new Error('purchaseId is required');

  const purchase = await ctx.memory.get('purchase.' + input.purchaseId);
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.seller !== ctx.caller.gaii) throw new Error('Only the seller can confirm delivery');
  if (purchase.status !== 'purchased') throw new Error('Purchase is not in deliverable state');

  // Mark as delivered
  purchase.status = 'delivered';
  purchase.deliveredAt = new Date().toISOString();
  await ctx.memory.set('purchase.' + input.purchaseId, purchase);

  ctx.log.info('Delivery confirmed', { purchaseId: input.purchaseId, seller: ctx.caller.gaii });

  return { status: 'delivered' };
}
