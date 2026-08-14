export default async function (ctx) {
  const prefix = 'suggestion.' + ctx.caller.gaii + '.';
  const results = await ctx.memory.search(prefix);

  // Filter out dismissed/expired, enrich with profile data
  const suggestions = [];
  for (const entry of results) {
    if (entry.status === 'dismissed' || entry.status === 'expired') continue;

    const profile = await ctx.memory.get('profile.' + entry.otherGaii);
    suggestions.push({
      matchId: entry.matchId,
      score: entry.score,
      breakdown: entry.breakdown,
      status: entry.status,
      profile: profile ? {
        displayName: profile.displayName,
        interests: profile.interests,
        city: profile.city,
        area: profile.area,
        country: profile.country,
      } : null,
      createdAt: entry.createdAt,
    });
  }

  suggestions.sort((a, b) => b.score - a.score);
  ctx.log.info('Suggestions retrieved', { gaii: ctx.caller.gaii, count: suggestions.length });

  return { suggestions };
}
