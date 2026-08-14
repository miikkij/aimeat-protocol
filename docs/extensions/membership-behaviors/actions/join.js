export default async function(ctx, input) {
  // 1. Read the organism from memory
  const organism = await ctx.memory.get(input.organismKey);
  if (!organism) throw new Error('Organism not found');

  const callerGhii = ctx.caller.gaii;

  // 2. Check if already a member
  const membersKey = `${input.organismKey}.members`;
  const membersData = await ctx.memory.get(membersKey) || { members: [] };
  const existing = membersData.members.find(m => m.ghii === callerGhii);
  if (existing && existing.status === 'active') {
    throw new Error('Already a member');
  }

  // 3. Check max members
  const activeMembers = membersData.members.filter(m => m.status === 'active');
  const maxMembers = organism.max_members || 10000;
  if (activeMembers.length >= maxMembers) {
    throw new Error('Organism has reached maximum member capacity');
  }

  // 4. Apply join policy
  const joinPolicy = organism.join_policy || 'open';

  if (joinPolicy === 'invite_only') {
    // Check if there's a pending invite for this user
    const pendingInvite = membersData.members.find(
      m => m.ghii === callerGhii && m.status === 'invited'
    );
    if (!pendingInvite) {
      throw new Error('This organism is invite-only');
    }
    // Accept the invite
    pendingInvite.status = 'active';
    pendingInvite.joinedAt = new Date().toISOString();
    await ctx.memory.set(membersKey, membersData);

    ctx.log.info('Invite accepted', { organism: input.organismKey, member: callerGhii });
    return { status: 'joined', role: pendingInvite.role || 'member' };
  }

  if (joinPolicy === 'approval_required') {
    // Create a join request
    const requestId = `jr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const requestsKey = `${input.organismKey}.join-requests`;
    const requestsData = await ctx.memory.get(requestsKey) || { requests: [] };

    // Check if already has pending request
    const pendingRequest = requestsData.requests.find(
      r => r.ghii === callerGhii && r.status === 'pending'
    );
    if (pendingRequest) {
      throw new Error('Join request already pending');
    }

    requestsData.requests.push({
      id: requestId,
      ghii: callerGhii,
      message: input.message || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    await ctx.memory.set(requestsKey, requestsData);

    ctx.log.info('Join request submitted', { organism: input.organismKey, requester: callerGhii });
    return { status: 'pending', requestId };
  }

  // Open join policy — join immediately
  membersData.members.push({
    ghii: callerGhii,
    role: 'member',
    status: 'active',
    joinedAt: new Date().toISOString(),
  });
  await ctx.memory.set(membersKey, membersData);

  ctx.log.info('Member joined', { organism: input.organismKey, member: callerGhii });
  return { status: 'joined', role: 'member' };
}
