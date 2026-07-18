-- 0009_invitation_return_url.sql
-- Return target for email invitations: an inviter-pinned, allowlisted app/node URL the link invitee
-- is redirected to after accepting (e.g. back into the Experience Center admin app, already signed
-- in). The value is validated against the node's own origin + app-origin subdomains at mint time and
-- re-validated at redirect (open-redirect guard). Additive/nullable; existing invitations read back
-- as returnUrl=NULL (→ default profile redirect).
ALTER TABLE "Invitation" ADD COLUMN IF NOT EXISTS "returnUrl" text;
