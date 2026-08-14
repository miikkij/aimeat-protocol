export default async function(ctx, input) {
  const organism = await ctx.memory.get(input.organismKey);
  if (!organism) throw new Error('Organism not found');

  // Check caller is admin or creator
  const membersKey = `${input.organismKey}.members`;
  const membersData = await ctx.memory.get(membersKey) || { members: [] };
  const callerMember = membersData.members.find(m => m.ghii === ctx.caller.gaii && m.status === 'active');

  const isCreator = organism.creator_ghii === ctx.caller.gaii;
  const isAdmin = callerMember && (callerMember.role === 'admin' || callerMember.role === 'creator');

  if (!isCreator && !isAdmin) {
    throw new Error('Only admins can review join requests');
  }

  // Validate decision
  if (!['approve', 'reject'].includes(input.decision)) {
    throw new Error('Decision must be "approve" or "reject"');
  }

  // Find the join request
  const requestsKey = `${input.organismKey}.join-requests`;
  const requestsData = await ctx.memory.get(requestsKey) || { requests: [] };
  const request = requestsData.requests.find(
    r => r.id === input.requestId && r.status === 'pending'
  );
  if (!request) {
    throw new Error('Pending join request not found');
  }

  // Update request status
  request.status = input.decision === 'approve' ? 'approved' : 'rejected';
  request.reviewedBy = ctx.caller.gaii;
  request.reviewedAt = new Date().toISOString();
  await ctx.memory.set(requestsKey, requestsData);

  // If approved, add as member
  if (input.decision === 'approve') {
    membersData.members.push({
      ghii: request.ghii,
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString(),
      approvedBy: ctx.caller.gaii,
    });
    await ctx.memory.set(membersKey, membersData);
  }

  ctx.log.info('Join request reviewed', {
    organism: input.organismKey,
    requestId: input.requestId,
    decision: input.decision,
  });

  return { status: input.decision === 'approve' ? 'approved' : 'rejected', requestId: input.requestId };
}
