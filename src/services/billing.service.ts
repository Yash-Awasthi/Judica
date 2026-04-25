/**
 * Billing Service — Stripe plans and subscription management.
 *
 * Functions:
 *   getPlans               — list all active plans
 *   getSubscription        — get current subscription for a tenant
 *   createCheckoutSession  — create a Stripe Checkout session
 *   cancelSubscription     — cancel the tenant's active subscription
 *   handleStripeWebhook    — process incoming Stripe webhook events
 *   getUsageSummary        — get usage stats for a tenant
 *
 * Stripe is optional — when STRIPE_SECRET_KEY is not set, billing runs in
 * "disabled" mode and returns placeholder data so the app still works.
 */

import Stripe from "stripe";
import { db } from "../lib/drizzle.js";
import { plans, subscriptions } from "../db/schema/billing.js";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import logger from "../lib/logger.js";

export type { Plan, Subscription } from "../db/schema/billing.js";

const log = logger.child({ service: "billing" });

const stripe: Stripe | null = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function getPlans(): Promise<typeof plans.$inferSelect[]> {
  return db.select().from(plans).where(eq(plans.isActive, true));
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscription(
  tenantId: string,
): Promise<typeof subscriptions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export async function createCheckoutSession(
  tenantId: string,
  planId: string,
  interval: "monthly" | "annual",
): Promise<{ url: string | null; disabled: boolean }> {
  if (!stripe) {
    log.warn("Stripe not configured — returning placeholder checkout session");
    return { url: null, disabled: true };
  }

  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  const priceId = interval === "annual" ? plan.annualPriceId : plan.monthlyPriceId;
  if (!priceId) {
    throw new Error(`No Stripe price configured for plan ${planId} interval ${interval}`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { tenantId, planId, interval },
    success_url: `${env.FRONTEND_URL ?? "http://localhost:3000"}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.FRONTEND_URL ?? "http://localhost:3000"}/billing/cancel`,
  });

  log.info({ tenantId, planId, interval }, "Stripe checkout session created");
  return { url: session.url, disabled: false };
}

export async function cancelSubscription(tenantId: string): Promise<boolean> {
  const subscription = await getSubscription(tenantId);
  if (!subscription) {
    return false;
  }

  if (stripe && subscription.stripeSubscriptionId) {
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(subscriptions.tenantId, tenantId));

  log.info({ tenantId }, "Subscription cancellation scheduled");
  return true;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export async function handleStripeWebhook(
  payload: string | Buffer,
  signature: string,
): Promise<void> {
  if (!stripe) {
    log.warn("Stripe not configured — webhook ignored");
    return;
  }

  if (!env.STRIPE_WEBHOOK_SECRET) {
    log.error("STRIPE_WEBHOOK_SECRET not configured — cannot verify webhook");
    throw new Error("Webhook secret not configured");
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    log.error({ err }, "Stripe webhook signature verification failed");
    throw new Error("Invalid webhook signature", { cause: err });
  }

  log.info({ type: event.type }, "Processing Stripe webhook event");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const { tenantId, planId, interval } = session.metadata ?? {};
      if (tenantId && planId && session.subscription) {
        const stripeSubscription = await stripe.subscriptions.retrieve(
          session.subscription as string,
        );
        const firstItem = stripeSubscription.items.data[0];
        const existing = await getSubscription(tenantId);
        const subData = {
          tenantId,
          planId,
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          status: stripeSubscription.status,
          currentPeriodStart: firstItem ? new Date(firstItem.current_period_start * 1000) : null,
          currentPeriodEnd: firstItem ? new Date(firstItem.current_period_end * 1000) : null,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          billingInterval: interval ?? "monthly",
          updatedAt: new Date(),
        };
        if (existing) {
          await db.update(subscriptions).set(subData).where(eq(subscriptions.tenantId, tenantId));
        } else {
          await db.insert(subscriptions).values({ id: crypto.randomUUID(), ...subData });
        }
        log.info({ tenantId, planId }, "Subscription activated via checkout");
      }
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const stripeSubscription = event.data.object as Stripe.Subscription;
      const firstItem = stripeSubscription.items.data[0];
      await db
        .update(subscriptions)
        .set({
          status: stripeSubscription.status,
          currentPeriodStart: firstItem ? new Date(firstItem.current_period_start * 1000) : null,
          currentPeriodEnd: firstItem ? new Date(firstItem.current_period_end * 1000) : null,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.stripeSubscriptionId, stripeSubscription.id));
      log.info({ stripeSubscriptionId: stripeSubscription.id }, `Subscription ${event.type}`);
      break;
    }

    default:
      log.debug({ type: event.type }, "Unhandled Stripe webhook event");
  }
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export async function getUsageSummary(
  tenantId: string,
): Promise<{
  tenantId: string;
  subscription: typeof subscriptions.$inferSelect | null;
  plan: typeof plans.$inferSelect | null;
  billingDisabled: boolean;
}> {
  const subscription = await getSubscription(tenantId);
  let plan: typeof plans.$inferSelect | null = null;

  if (subscription) {
    const [planRow] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, subscription.planId))
      .limit(1);
    plan = planRow ?? null;
  }

  return {
    tenantId,
    subscription,
    plan,
    billingDisabled: !stripe,
  };
}
