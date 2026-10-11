export default async function (ctx) {
  // Suggestions are for a person who opted in to matching; after opting out they see none.
  const own = await ctx.memory.get('profile.' + ctx.caller.gaii);
  if (!own || own.matchable !== true) return { suggestions: [], matchable: false };

  const prefix = 'suggestion.' + ctx.caller.gaii + '.';
  const results = await ctx.memory.search(prefix);

  // Filter out dismissed/expired, enrich with profile data
  const suggestions = [];
  // search() answers [{ key, value }]; the suggestion is the value.
  for (const { value: entry } of results) {
    if (!entry) continue;
    if (entry.status === 'dismissed' || entry.status === 'expired') continue;

    const profile = await ctx.memory.get('profile.' + entry.otherGaii);
    // The other person may have opted out of matching since the round: then they are not shown.
    if (!profile || profile.matchable !== true) continue;
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
