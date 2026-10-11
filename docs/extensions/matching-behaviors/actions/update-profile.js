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
  if (input.matchable !== undefined && typeof input.matchable !== 'boolean') {
    throw new Error('matchable must be true or false');
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
    matchable: input.matchable ?? existing.matchable === true,
    lastActivityAt: new Date().toISOString(),
  };

  // A profile is personal data: private to the extension, whatever `matchable` says.
  await ctx.memory.set(key, updated, { visibility: 'private' });
  ctx.log.info('Profile updated', { gaii: ctx.caller.gaii, matchable: updated.matchable });

  return { updated: true, matchable: updated.matchable };
}
