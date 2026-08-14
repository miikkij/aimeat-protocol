export default async function (ctx, input) {
  if (!input.matchId || typeof input.matchId !== 'string') {
    throw new Error('matchId is required');
  }
  if (input.action !== 'accept' && input.action !== 'dismiss') {
    throw new Error('action must be "accept" or "dismiss"');
  }

  const key = 'suggestion.' + ctx.caller.gaii + '.' + input.matchId;
  const suggestion = await ctx.memory.get(key);

  if (!suggestion) {
    throw new Error('Match suggestion not found');
  }

  const now = new Date().toISOString();

  if (input.action === 'accept') {
    suggestion.status = 'accepted';
    suggestion.respondedAt = now;
    await ctx.memory.set(key, suggestion);
    // Store accepted record for mutual-match lookups
    await ctx.memory.set('accepted.' + ctx.caller.gaii + '.' + input.matchId, {
      matchId: input.matchId,
      otherGaii: suggestion.otherGaii,
      acceptedAt: now,
    });
  } else {
    const cooldownDays = ctx.instance.config.cooldown_days || 7;
    suggestion.status = 'dismissed';
    suggestion.respondedAt = now;
    suggestion.cooldownUntil = new Date(Date.now() + cooldownDays * 86400000).toISOString();
    await ctx.memory.set(key, suggestion);
  }

  ctx.log.info('Match response recorded', { gaii: ctx.caller.gaii, matchId: input.matchId, action: input.action });

  return { responded: true, action: input.action };
}
