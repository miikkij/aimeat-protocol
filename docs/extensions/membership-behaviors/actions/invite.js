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
    throw new Error('Only admins can invite members');
  }

  // Check if invitee is already a member
  const existingMember = membersData.members.find(m => m.ghii === input.inviteeGhii);
  if (existingMember && existingMember.status === 'active') {
    throw new Error('User is already a member');
  }
  if (existingMember && existingMember.status === 'invited') {
    throw new Error('User already has a pending invite');
  }

  // Add as invited member
  membersData.members.push({
    ghii: input.inviteeGhii,
    role: 'member',
    status: 'invited',
    invitedBy: ctx.caller.gaii,
    invitedAt: new Date().toISOString(),
  });
  await ctx.memory.set(membersKey, membersData);

  ctx.log.info('Member invited', {
    organism: input.organismKey,
    invitee: input.inviteeGhii,
    invitedBy: ctx.caller.gaii,
  });

  return { status: 'invited', invitee: input.inviteeGhii };
}
