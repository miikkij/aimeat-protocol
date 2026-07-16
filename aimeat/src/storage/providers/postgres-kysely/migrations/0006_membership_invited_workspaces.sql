-- 0006_membership_invited_workspaces.sql
-- Name-invite parity with email invites: workspace grants chosen at invite time are carried on
-- the membership row ([{ws, role}] JSON) and applied via applyInvitationWorkspaceGrants when the
-- invitee accepts. Additive/nullable; existing memberships read back unchanged.
ALTER TABLE "OrganismMembership" ADD COLUMN IF NOT EXISTS "invitedWorkspaces" jsonb;
