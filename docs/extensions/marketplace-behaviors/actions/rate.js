export default async function(ctx, input) {
  if (!input.purchaseId) throw new Error('purchaseId is required');

  const purchase = await ctx.memory.get('purchase.' + input.purchaseId);
  if (!purchase) throw new Error('Purchase not found');
  if (purchase.buyer !== ctx.caller.gaii) throw new Error('Only the buyer can rate');
  if (purchase.status !== 'delivered') throw new Error('Can only rate delivered purchases');
  if (purchase.rated) throw new Error('Already rated');

  // Validate score
  if (!input.score || input.score < 1 || input.score > 5) {
    throw new Error('Score must be between 1 and 5');
  }

  // Store rating
  await ctx.memory.set('rating.' + input.purchaseId, {
    purchaseId: input.purchaseId,
    buyer: ctx.caller.gaii,
    seller: purchase.seller,
    score: input.score,
    comment: input.comment || '',
    ratedAt: new Date().toISOString(),
  });

  // Mark purchase as completed
  purchase.status = 'completed';
  purchase.rated = true;
  await ctx.memory.set('purchase.' + input.purchaseId, purchase);

  ctx.log.info('Purchase rated', { purchaseId: input.purchaseId, score: input.score });

  return { rated: true };
}
