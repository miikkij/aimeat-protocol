/**
 * @file src/routes/app-membership.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app's membership costs and how to buy it, for the door of the app: the node's
 *   own join page (/v1/app-join), the SDK (AIMEAT.iam.membership) and an AI reading it over REST.
 *
 *   GET  /v1/apps/:owner/:filename/membership                — the roles for sale (price, period,
 *        renewal, the seller) and, for a signed-in caller, their own standing. Anyone may read it:
 *        a price is public, and nothing in the answer names another person.
 *   POST /v1/apps/:owner/:filename/membership/guest          — buy without an account: the role and
 *        an email address open Stripe's card page on the owner's Stripe (commerce/membership-guest.ts).
 *   POST /v1/apps/:owner/:filename/membership/guest/complete — finish it when the person comes back
 *        with `stripe_session`; the payment is read back from Stripe.
 *
 *   A signed-in buyer buys through the ordinary checkout (POST /v1/commerce/checkout-sessions with a
 *   `membership` line, then its card page), which is what AIMEAT.iam.membership.buy() does.
 * @structure appMembershipRouter
 * @usage app.use(appMembershipRouter(config, storage)) in routes-loader, before the parameterized app routes
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { optionalAuth } from '../auth/middleware.js';
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { resolveIdentity } from '../utils/gaii.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { CommerceError } from '../commerce/errors.js';
import { PaymentError } from '../commerce/payment-handlers.js';
import { getCarryPlan, getMember, seatsTaken, accountOf } from '../services/app/members.js';
import { appDisplayName, resolveAppFilename } from '../services/app/app-ref.js';
import { registrationRefusal } from '../services/owner/provisioning.js';
import { listSubscriptions } from '../commerce/subscriptions.js';
import { membershipExt } from '../commerce/membership-sale.js';
import { openGuestPurchase, completeGuestPurchase } from '../commerce/membership-guest.js';

const OWNER_RE = /^[A-Za-z0-9_-]{1,60}$/;

const GuestSchema = z.object({
  role: z.string().min(1).max(40),
  email: z.string().min(3).max(254),
  return_url: z.string().regex(/^https?:\/\//).max(2000),
  auto_renew: z.boolean().optional(),
}).strict();

const CompleteSchema = z.object({
  purchase: z.string().min(3).max(40),
  stripe_session: z.string().min(3).max(300).optional(),
  /** Only on a node that runs the test money rail (commerce/test-money-handler.ts). */
  handler: z.string().max(60).optional(),
  instrument: z.string().max(200).optional(),
}).strict();

export function appMembershipRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // Unauthenticated money paths: keyed by address, so one visitor cannot open card pages without end.
  const guestLimit = rateLimit({ windowMs: 3_600_000, max: 20, keyBy: 'ip' });

  /** The app the route names, resolved (`club` → `club.html`), or the answer already sent. */
  async function appOf(req: Request, res: Response): Promise<{ owner: string; filename: string; appId: string; ownerGhii: string } | null> {
    const owner = String(req.params.owner ?? '');
    if (!OWNER_RE.test(owner)) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such app.')); return null; }
    const ownerGhii = await resolveGhii(storage, owner, config);
    const filename = await resolveAppFilename(storage, { ownerGaii: ownerGhii }, String(req.params.filename ?? ''));
    if (!(await storage.getApp(ownerGhii, filename))) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such app.')); return null; }
    return { owner, filename, appId: `${owner}/${filename}`, ownerGhii };
  }

  // A refusal of the checkout or of the payment provider (CommerceError, PaymentError) keeps its code and status.
  const fail = (res: Response, err: unknown): void => {
    if (err instanceof CommerceError || err instanceof PaymentError) { res.status(err.statusCode).json(error(config.nodeId, err.code, err.message)); return; }
    throw err;
  };

  router.get('/v1/apps/:owner/:filename/membership', optionalAuth(), async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    const plan = await getCarryPlan(storage, app.appId);
    const forSale = [];
    for (const [role, s] of Object.entries(plan?.sale ?? {})) {
      const days = plan?.terms?.[role]?.days ?? null;
      const cap = plan?.seats?.[role];
      forSale.push({
        role, days, renews: s.renews,
        // A role with no price here is sold only on the owner's own Stripe links.
        ...(typeof s.amount === 'number' ? { amount: s.amount, currency: s.currency } : {}),
        buy_here: typeof s.amount === 'number' && !!days,
        seats_left: typeof cap === 'number' ? Math.max(0, cap - await seatsTaken(storage, app.appId, role)) : null,
      });
    }
    const seller = await storage.getGHII(app.ownerGhii);
    let me: Record<string, unknown> | null = null;
    if (req.auth && !isAnonymousPrincipal(req.auth)) {
      const who = resolveIdentity(req.auth, config.nodeId);
      const account = accountOf(who);
      const isOwner = account === app.owner.toLowerCase();
      const member = isOwner ? null : await getMember(storage, app.appId, account);
      const ext = membershipExt(app.appId);
      const subs = isOwner ? [] : (await listSubscriptions(storage, `${req.auth.owner}@${config.nodeId}`)).filter(s => s.ext === ext);
      me = {
        is_owner: isOwner,
        member: member ? { role: member.role, expires_at: member.expiresAt, ...(member.paid ? { paid_until: member.paid.until, renews: member.paid.renews } : {}) } : null,
        subscriptions: subs.map(s => ({ role: s.plan, active_until: s.active_until, auto_renew: s.auto_renew, active: s.active, ext: s.ext })),
      };
    }
    res.setHeader('Cache-Control', me ? 'private, no-store' : 'public, max-age=60');
    res.json(success(config.nodeId, {
      app: app.appId, name: appDisplayName(app.filename),
      seller: { name: app.owner, display_name: seller?.displayName || app.owner },
      for_sale: forSale,
      // A purchase without an account is an invitation: closed registration refuses it.
      guest: { open: forSale.some(r => r.buy_here) && registrationRefusal(config, 'invitation') === null },
      me,
    }, [
      { description: 'Buy signed in: a checkout with a membership line', method: 'POST', url: '/v1/commerce/checkout-sessions' },
      { description: 'Buy without an account', method: 'POST', url: `/v1/apps/${app.owner}/${app.filename}/membership/guest` },
    ]));
  });

  router.post('/v1/apps/:owner/:filename/membership/guest', guestLimit, async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    const parsed = GuestSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))); return; }
    try {
      const out = await openGuestPurchase(storage, config, {
        appRef: app.appId, role: parsed.data.role, email: parsed.data.email,
        returnUrl: parsed.data.return_url, ...(parsed.data.auto_renew !== undefined ? { autoRenew: parsed.data.auto_renew } : {}),
      });
      res.status(201).json(success(config.nodeId, { purchase: out.purchase, url: out.url, ...(out.testMoney ? { test_money: true } : {}) }));
    } catch (err) { fail(res, err); }
  });

  router.post('/v1/apps/:owner/:filename/membership/guest/complete', guestLimit, async (req, res) => {
    const app = await appOf(req, res);
    if (!app) return;
    const parsed = CompleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '))); return; }
    const b = parsed.data;
    try {
      const out = await completeGuestPurchase(storage, config, b.purchase, b.handler ? b.instrument : b.stripe_session, {
        ...(b.handler ? { handler: b.handler } : {}), sellerGhii: app.ownerGhii, appId: app.appId,
      });
      // The same answer whether the address had an account or got an invitation.
      res.json(success(config.nodeId, {
        status: out.status, next: 'email',
        message: 'The membership is paid. Open the message sent to your email address to continue. If you already have an account with that address, sign in: you are a member.',
      }));
    } catch (err) { fail(res, err); }
  });

  return router;
}
