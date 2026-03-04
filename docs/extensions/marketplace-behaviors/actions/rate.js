export default async function(ctx, input) {
  const purchase = await ctx.memory.get(`marketplace.purchases.${input.purchaseId}`);
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.buyerGaii !== ctx.caller.gaii) throw new Error('Only buyer can rate');
  if (purchase.status !== 'delivered') throw new Error('Can only rate delivered purchases');
  if (purchase.rated) throw new Error('Already rated');

  // Validate score
  if (!input.score || input.score < 1 || input.score > 5) {
    throw new Error('Score must be between 1 and 5');
  }

  // Adjust seller trust score based on rating
  // 5 stars: +4, 4 stars: +2, 3 stars: 0, 2 stars: -3, 1 star: -6
  const delta = input.score >= 3 ? (input.score - 3) * 2 : (input.score - 3) * 3;
  await ctx.trust.adjust(purchase.sellerGaii, delta, 'marketplace_rating');

  // Store rating in memory
  await ctx.memory.set(`marketplace.ratings.${input.purchaseId}`, {
    purchaseId: input.purchaseId,
    buyerGaii: ctx.caller.gaii,
    sellerGaii: purchase.sellerGaii,
    score: input.score,
    comment: input.comment || '',
    ratedAt: new Date().toISOString(),
  });

  // Mark purchase as rated and completed
  await ctx.memory.set(`marketplace.purchases.${input.purchaseId}`, {
    ...purchase,
    status: 'completed',
    rated: true,
  });

  ctx.log.info('Purchase rated', {
    purchaseId: input.purchaseId,
    score: input.score,
  });

  return { rated: true };
}
