export default async function (ctx) {
  if (!ctx.caller.roles.includes('operator')) {
    throw new Error('Operator only');
  }

  const startTime = Date.now();
  const config = ctx.instance.config;
  const maxDistanceKm = config.max_distance_km || 100;
  const matchThreshold = config.match_threshold || 0.3;
  const maxSuggestions = config.max_suggestions || 10;
  const cooldownDays = config.cooldown_days || 7;
  let matchesCreated = 0;

  // Load all profiles
  const profiles = await ctx.memory.search('profile.');
  const profilesScanned = profiles.length;
  ctx.log.info('Matching round started', { profilesScanned });

  // For each pair, calculate match score
  for (let i = 0; i < profiles.length; i++) {
    const a = profiles[i];
    let suggestionCount = 0;
    const candidates = [];

    for (let j = 0; j < profiles.length; j++) {
      if (i === j) continue;
      const b = profiles[j];

      // Check cooldown on existing suggestion
      const existingKey = 'suggestion.' + a.gaii + '.' + b.gaii;
      const existing = await ctx.memory.get(existingKey);
      if (existing) {
        if (existing.status === 'accepted') continue;
        if (existing.status === 'dismissed' && existing.cooldownUntil) {
          if (new Date(existing.cooldownUntil).getTime() > Date.now()) continue;
        }
        if (existing.status === 'suggested') continue;
      }

      const score = calcScore(a, b, maxDistanceKm);
      if (score.total >= matchThreshold) {
        candidates.push({ profile: b, score });
      }
    }

    // Sort by score descending, take top N
    candidates.sort((x, y) => y.score.total - x.score.total);
    const top = candidates.slice(0, maxSuggestions);

    for (const { profile: b, score } of top) {
      const matchId = b.gaii;
      const key = 'suggestion.' + a.gaii + '.' + matchId;
      await ctx.memory.set(key, {
        matchId,
        otherGaii: b.gaii,
        score: score.total,
        breakdown: score.breakdown,
        status: 'suggested',
        createdAt: new Date().toISOString(),
      });
      matchesCreated++;
    }
  }

  const durationMs = Date.now() - startTime;
  ctx.log.info('Matching round complete', { profilesScanned, matchesCreated, durationMs });

  return { profilesScanned, matchesCreated, durationMs };
}

// ── Scoring ──────────────────────────────────────────────────

function calcScore(a, b, maxDistanceKm) {
  // Shared interests: min(shared_count / 3, 1.0)
  const lowerA = a.interests.map(s => s.toLowerCase());
  const lowerB = b.interests.map(s => s.toLowerCase());
  const shared = a.interests.filter(s => lowerB.includes(s.toLowerCase()));
  const sharedInterestsScore = Math.min(shared.length / 3, 1.0);

  // Distance: max(1 - distance/max, 0)
  let distanceKm = null;
  let distanceScore = 0.5;
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
    distanceKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
    distanceScore = Math.max(1.0 - distanceKm / maxDistanceKm, 0);
  }

  // Activity: max(1 - days/90, 0)
  let activityDays = 90;
  if (b.lastActivityAt) {
    activityDays = Math.round((Date.now() - new Date(b.lastActivityAt).getTime()) / 86400000);
  }
  const activityScore = Math.max(1.0 - activityDays / 90, 0);

  // Compatibility: seeking match ratio
  let compatibilityScore = 0.5;
  if (a.seeking && a.seeking.length > 0) {
    const seekLower = a.seeking.map(s => s.toLowerCase());
    const matchCount = seekLower.filter(s =>
      lowerB.includes(s) ||
      b.city?.toLowerCase() === s ||
      b.area?.toLowerCase() === s ||
      b.country?.toLowerCase() === s
    ).length;
    compatibilityScore = Math.min(matchCount / a.seeking.length, 1.0);
  }

  const total = Math.round(
    (0.40 * sharedInterestsScore + 0.25 * distanceScore + 0.20 * activityScore + 0.15 * compatibilityScore) * 1000
  ) / 1000;

  return {
    total,
    breakdown: {
      sharedInterests: shared,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
      activityDays,
      sharedInterestsScore: Math.round(sharedInterestsScore * 1000) / 1000,
      distanceScore: Math.round(distanceScore * 1000) / 1000,
      activityScore: Math.round(activityScore * 1000) / 1000,
      compatibilityScore: Math.round(compatibilityScore * 1000) / 1000,
    },
  };
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
