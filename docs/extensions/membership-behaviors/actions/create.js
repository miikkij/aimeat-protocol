export default async function(ctx, input) {
  // The group record the other actions read. It lives in this extension's own namespace, because a
  // script can read and write no other: without this action nothing could ever create one, and every
  // join answered "Organism not found".
  const key = input.organismKey;
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(key)) {
    throw new Error('organismKey is required: up to 120 lowercase letters, digits, dots, dashes or underscores');
  }
  if (key.endsWith('.members') || key.endsWith('.join-requests')) {
    throw new Error('organismKey must not end in .members or .join-requests');
  }

  const joinPolicy = input.join_policy === undefined ? 'open' : input.join_policy;
  if (!['open', 'approval_required', 'invite_only'].includes(joinPolicy)) {
    throw new Error('join_policy must be open, approval_required or invite_only');
  }
  const maxMembers = input.max_members === undefined ? 10000 : input.max_members;
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 10000) {
    throw new Error('max_members must be a whole number from 2 to 10000');
  }

  const now = new Date().toISOString();
  const organism = {
    name: typeof input.name === 'string' && input.name ? input.name : key,
    join_policy: joinPolicy,
    max_members: maxMembers,
    creator_ghii: ctx.caller.gaii,
    createdAt: now,
  };

  // ifVersion 0: only if the key does not exist yet, so two callers cannot both create one group.
  const written = await ctx.memory.set(key, organism, { ifVersion: 0 });
  if (!written.ok) throw new Error('A group with this organismKey already exists');

  // Who belongs to a group is personal data, so the list is private to the extension.
  await ctx.memory.set(`${key}.members`, {
    members: [{ ghii: ctx.caller.gaii, role: 'admin', status: 'active', joinedAt: now }],
  }, { visibility: 'private' });

  ctx.log.info('Group created', { organism: key, creator: ctx.caller.gaii });
  return { status: 'created', organismKey: key };
}
