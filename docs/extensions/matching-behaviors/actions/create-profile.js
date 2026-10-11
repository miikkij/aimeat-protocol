export default async function (ctx, input) {
  // Check instance access
  const config = ctx.instance.config;
  if (config.visibility === 'password' && input._password !== config.password) {
    throw new Error('Invalid instance password');
  }
  if (config.visibility === 'invite' && !config.allowed_users?.includes(ctx.caller.gaii)) {
    throw new Error('Not invited to this instance');
  }

  // Validate required fields
  if (!input.displayName || typeof input.displayName !== 'string') {
    throw new Error('displayName is required');
  }
  if (!Array.isArray(input.interests) || input.interests.length === 0) {
    throw new Error('interests must be a non-empty array');
  }
  if (input.matchable !== undefined && typeof input.matchable !== 'boolean') {
    throw new Error('matchable must be true or false');
  }

  // Require matching consent
  await ctx.consent.require(ctx.caller.gaii, 'matching');

  const now = new Date().toISOString();
  const profile = {
    gaii: ctx.caller.gaii,
    displayName: input.displayName,
    interests: input.interests,
    seeking: input.seeking || [],
    city: input.city || null,
    area: input.area || null,
    country: input.country || null,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    // Matched with others only after the person says so. Off by default.
    matchable: input.matchable === true,
    createdAt: now,
    lastActivityAt: now,
  };

  // A profile is personal data: private to the extension, whatever `matchable` says.
  await ctx.memory.set('profile.' + ctx.caller.gaii, profile, { visibility: 'private' });
  ctx.log.info('Profile created', { gaii: ctx.caller.gaii, matchable: profile.matchable });

  return { created: true, matchable: profile.matchable };
}
