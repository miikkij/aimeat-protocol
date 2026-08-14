export default async function(ctx, input) {
  const organism = await ctx.memory.get(input.organismKey);
  if (!organism) throw new Error('Organism not found');

  const callerGhii = ctx.caller.gaii;

  // Cannot leave if you're the creator (must transfer ownership first)
  if (organism.creator_ghii === callerGhii) {
    throw new Error('Creator cannot leave. Transfer ownership first.');
  }

  const membersKey = `${input.organismKey}.members`;
  const membersData = await ctx.memory.get(membersKey) || { members: [] };
  const memberIndex = membersData.members.findIndex(
    m => m.ghii === callerGhii && m.status === 'active'
  );

  if (memberIndex === -1) {
    throw new Error('Not a member of this organism');
  }

  // Remove the member
  membersData.members.splice(memberIndex, 1);
  await ctx.memory.set(membersKey, membersData);

  ctx.log.info('Member left', { organism: input.organismKey, member: callerGhii });
  return { status: 'left' };
}
