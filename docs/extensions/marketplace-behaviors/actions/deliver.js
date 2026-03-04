export default async function(ctx, input) {
  const purchase = await ctx.memory.get(`marketplace.purchases.${input.purchaseId}`);
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.sellerGaii !== ctx.caller.gaii) throw new Error('Only seller can confirm delivery');
  if (purchase.status !== 'purchased') throw new Error('Purchase not in deliverable state');

  // Release escrow to seller
  await ctx.wallet.release(input.purchaseId, purchase.sellerGaii);

  // Update purchase state
  await ctx.memory.set(`marketplace.purchases.${input.purchaseId}`, {
    ...purchase,
    status: 'delivered',
    deliveredAt: new Date().toISOString(),
  });

  ctx.log.info('Delivery confirmed', {
    purchaseId: input.purchaseId,
    seller: purchase.sellerGaii,
  });

  return { status: 'delivered' };
}
