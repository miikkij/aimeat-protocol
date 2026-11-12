-- 0129_access_requests.sql
--
-- Asking for access from the refusal page of an app or a page opened to one organism's members.
--
-- A person the app refuses could only be told to ask its owner by another channel. The request is
-- now filed on the node as a join request of that organism, which its owners and admins decide
-- where they decide every other request.
--
--   Organism.accessRequests — NULL or 'on': a refused person may ask (the default). 'off': nothing
--                             can be asked from a refusal page of this organism's apps and pages.
--                             Separate from joinPolicy, which governs joining by the organism's id.
--   JoinRequest.via         — NULL for a request made by the organism's id. For an access request,
--                             a JSON object { kind, ref, label }: the app or page it was asked
--                             from, which the approver reads and the answer to the requester names
--                             instead of the organism.
--
-- No backfill: NULL reads as 'on' and as "no source", so every existing row keeps its meaning.

ALTER TABLE "Organism" ADD COLUMN IF NOT EXISTS "accessRequests" TEXT;
ALTER TABLE "JoinRequest" ADD COLUMN IF NOT EXISTS "via" TEXT;
