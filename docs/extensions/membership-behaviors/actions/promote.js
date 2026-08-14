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
    throw new Error('Only admins can change member roles');
  }

  // Validate role
  if (!['member', 'admin'].includes(input.role)) {
    throw new Error('Role must be "member" or "admin"');
  }

  // Find the target member
  const targetMember = membersData.members.find(
    m => m.ghii === input.memberGhii && m.status === 'active'
  );
  if (!targetMember) {
    throw new Error('Member not found');
  }

  // Cannot demote the creator
  if (organism.creator_ghii === input.memberGhii && input.role !== 'admin') {
    throw new Error('Cannot demote the creator');
  }

  targetMember.role = input.role;
  targetMember.promotedAt = new Date().toISOString();
  targetMember.promotedBy = ctx.caller.gaii;
  await ctx.memory.set(membersKey, membersData);

  ctx.log.info('Member role changed', {
    organism: input.organismKey,
    member: input.memberGhii,
    newRole: input.role,
  });

  return { status: 'promoted', member: input.memberGhii, role: input.role };
}
