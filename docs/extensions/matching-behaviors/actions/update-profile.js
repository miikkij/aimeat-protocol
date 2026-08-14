export default async function (ctx, input) {
  const key = 'profile.' + ctx.caller.gaii;
  const existing = await ctx.memory.get(key);

  if (!existing) {
    throw new Error('Profile not found — create one first');
  }
  if (existing.gaii !== ctx.caller.gaii) {
    throw new Error('Cannot update another user\'s profile');
  }

  // Validate interests if provided
  if (input.interests !== undefined && (!Array.isArray(input.interests) || input.interests.length === 0)) {
    throw new Error('interests must be a non-empty array');
  }

  // Merge provided fields
  const updated = {
    ...existing,
    displayName: input.displayName ?? existing.displayName,
    interests: input.interests ?? existing.interests,
    seeking: input.seeking ?? existing.seeking,
    city: input.city ?? existing.city,
    area: input.area ?? existing.area,
    country: input.country ?? existing.country,
    lat: input.lat ?? existing.lat,
    lon: input.lon ?? existing.lon,
    lastActivityAt: new Date().toISOString(),
  };

  await ctx.memory.set(key, updated);
  ctx.log.info('Profile updated', { gaii: ctx.caller.gaii });

  return { updated: true };
}
