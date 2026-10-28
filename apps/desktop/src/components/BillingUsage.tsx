import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  CircleCheck,
  Clock3,
  Megaphone,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import {
  baselineOf,
  paymentLanded,
  type Baseline,
  type BillingAction,
} from "../lib/billing";
import { Button, Modal } from "./ui";
import "./BillingUsage.css";

type PlanId = "builder" | "influencer";
type PackageId = PlanId | "extra";
type Billing = {
  available: Record<PackageId, boolean>;
  hasCustomer: boolean;
  status: string;
  plan: PlanId | null;
  packages: Record<
    PackageId,
    { name: string; amount: number; credits: number }
  >;
  credits: {
    balance: number;
    reserved: number;
    total: number;
    entries: {
      id: string;
      amount: number;
      description: string;
      createdAt: string;
    }[];
  };
};
const creditCount = (value: number) =>
  value !== 0 && Math.abs(value) < 0.01
    ? value < 0
      ? "−<0.01"
      : "<0.01"
    : new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
const price = (cents: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const managed = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
]);
const statusLabels: Record<string, string> = {
  none: "No subscription",
  active: "Active subscription",
  trialing: "Trial subscription",
  past_due: "Payment overdue",
  unpaid: "Payment overdue",
  incomplete: "Payment incomplete",
  incomplete_expired: "Checkout expired",
  canceled: "Subscription canceled",
  paused: "Subscription paused",
};
const paymentNeedsAttention = new Set(["past_due", "unpaid", "incomplete"]);
const plans: { id: PlanId; icon: typeof Sparkles; pitch: string }[] = [
  {
    id: "builder",
    icon: Sparkles,
    pitch: "For building your brand with Orca every week.",
  },
  {
    id: "influencer",
    icon: Megaphone,
    pitch: "For daily content across every account.",
  },
];
/** While Stripe is open, check often: its webhook lands seconds after payment. */
const WATCH_MS = 3000;
const WATCH_FOR_MS = 10 * 60 * 1000;

export default function BillingUsage() {
  const [data, setData] = useState<Billing | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [reload, setReload] = useState(0);
  const [switchTo, setSwitchTo] = useState<PlanId | null>(null);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [waiting, setWaiting] = useState<{
    action: BillingAction;
    baseline: Baseline;
    until: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState("");
  const watching = waiting !== null;
  useEffect(() => {
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      setRefreshing(true);
      try {
        const value = await api<Billing>("/billing", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (active) {
          setData(value);
          setLoadError("");
        }
      } catch (failure) {
        if (active)
          setLoadError(
            failure instanceof Error
              ? failure.message
              : "Unable to load billing.",
          );
      } finally {
        inFlight = false;
        if (active) setRefreshing(false);
      }
    };
    void load();
    // The browser covering this window makes it "hidden", so keep checking while
    // a payment is pending.
    const refresh = () => {
      if (watching || document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, watching ? WATCH_MS : 15000);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [reload, watching]);
  useEffect(() => {
    if (!waiting || !data) return;
    const landed = paymentLanded(waiting.action, waiting.baseline, data);
    if (landed) {
      setConfirmed(landed);
      setPaymentUrl(null);
      setWaiting(null);
    } else if (Date.now() > waiting.until) setWaiting(null);
  }, [data, waiting]);
  const start = useCallback(
    async (action: BillingAction) => {
      setPricingOpen(false);
      setBusy(action);
      setActionError("");
      setConfirmed("");
      setPaymentUrl(null);
      try {
        const result = await api<{ url: string }>(
          action === "portal" ? "/billing/portal" : "/billing/checkout",
          {
            method: "POST",
            body: JSON.stringify(
              action === "portal" ? {} : { packageId: action },
            ),
          },
        );
        const url = new URL(result.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
        )
          throw new Error("The server returned an invalid payment URL.");
        setPaymentUrl(url.href);
        if (data)
          setWaiting({
            action,
            baseline: baselineOf(data),
            until: Date.now() + WATCH_FOR_MS,
          });
        window.open(url.href, "_blank", "noopener,noreferrer");
      } catch (failure) {
        setActionError(
          failure instanceof Error
            ? failure.message
            : "Unable to open billing.",
        );
      } finally {
        setBusy(null);
      }
    },
    [data],
  );
  const changePlan = useCallback(async (plan: PlanId) => {
    setBusy(plan);
    setActionError("");
    try {
      await api("/billing/plan", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      setSwitchTo(null);
      setReload((value) => value + 1);
    } catch (failure) {
      setSwitchTo(null);
      setActionError(
        failure instanceof Error ? failure.message : "Unable to change plans.",
      );
    } finally {
      setBusy(null);
    }
  }, []);
  const rows = data?.credits.entries ?? [];
  const hasSubscription = data ? managed.has(data.status) : false;
  const canSwitch =
    hasSubscription && ["active", "trialing"].includes(data?.status ?? "");
  const target = switchTo && data ? data.packages[switchTo] : null;
  const currentPlan =
    hasSubscription && data?.plan ? data.packages[data.plan] : null;
  const CurrentIcon =
    plans.find(({ id }) => id === data?.plan)?.icon ?? Sparkles;
  const upgrading =
    data && switchTo && data.plan
      ? data.packages[switchTo].amount > data.packages[data.plan].amount
      : false;
  return (
    <section className="billing-panel" aria-labelledby="billing-heading">
      <div className="billing-heading-row">
        <div>
          <h4 id="billing-heading">Billing &amp; Usage</h4>
          <p>Your plan, allowance, and credit activity.</p>
        </div>
        <Button
          variant="ghost"
          disabled={refreshing}
          onClick={() => setReload((value) => value + 1)}
          aria-label="Refresh billing"
        >
          <RefreshCw
            size={14}
            aria-hidden="true"
            className={refreshing ? "billing-refreshing" : ""}
          />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {loadError && (
        <div role="alert" className="billing-notice">
          {loadError}
          {data && " Showing your last loaded balance."}{" "}
          <Button onClick={() => setReload((value) => value + 1)}>
            Try again
          </Button>
        </div>
      )}
      {actionError && (
        <div role="alert" className="billing-notice">
          {actionError}
        </div>
      )}
      {waiting ? (
        <div className="billing-notice billing-waiting" role="status">
          <RefreshCw
            size={14}
            aria-hidden="true"
            className="billing-refreshing"
          />
          <div>
            <strong>
              {waiting.action === "portal"
                ? "Watching for changes in Stripe…"
                : "Waiting for your payment…"}
            </strong>
            <p>
              {waiting.action === "portal"
                ? "Changes you make in your browser show up here on their own."
                : "Finish checkout in your browser. This updates on its own a few seconds after Stripe confirms."}{" "}
              {paymentUrl && (
                <a href={paymentUrl} target="_blank" rel="noopener noreferrer">
                  Open Stripe again
                </a>
              )}
            </p>
          </div>
          <Button variant="ghost" onClick={() => setWaiting(null)}>
            Stop
          </Button>
        </div>
      ) : confirmed ? (
        <div className="billing-notice billing-confirmed" role="status">
          <CircleCheck size={16} aria-hidden="true" />
          <div>
            <strong>{confirmed}</strong>
          </div>
          <Button variant="ghost" onClick={() => setConfirmed("")}>
            Dismiss
          </Button>
        </div>
      ) : (
        paymentUrl && (
          <div className="billing-notice" role="status">
            Finished in your browser? Your balance updates here once Stripe
            confirms; use Refresh to check now.{" "}
            <a href={paymentUrl} target="_blank" rel="noopener noreferrer">
              Open Stripe again
            </a>
          </div>
        )
      )}
      {!data && !loadError && (
        <p role="status" className="billing-loading">
          Loading your allowance…
        </p>
      )}
      {data && (
        <>
          <div className="billing-balance">
            <div className="billing-balance-heading">
              <Wallet size={17} aria-hidden="true" />
              <span>Available allowance</span>
              {!["none", "active"].includes(data.status) && (
                <span className="billing-status">
                  {statusLabels[data.status] ??
                    "Subscription status unavailable"}
                </span>
              )}
            </div>
            <div className="billing-balance-number">
              {creditCount(data.credits.balance)}
              <span>credits</span>
            </div>
            {data.credits.reserved > 0 && (
              <div className="billing-pending">
                <Clock3 size={13} aria-hidden="true" />
                {creditCount(data.credits.reserved)} credits pending while usage
                is finalized.
              </div>
            )}
          </div>
          {data.credits.balance <= 0 && (
            <p className="billing-notice" role="status">
              Your available allowance is used up. Add credits or subscribe to
              continue creating. Your saved work remains available.
            </p>
          )}
          {paymentNeedsAttention.has(data.status) && (
            <p className="billing-notice" role="status">
              Your subscription payment needs attention. Manage your
              subscription to update your payment method. A new monthly
              allowance is added after a successful payment.
            </p>
          )}
          <div className="billing-current-plan">
            <CurrentIcon size={16} aria-hidden="true" />
            <div className="billing-current-plan-info">
              <h5>{currentPlan ? currentPlan.name : "Free"}</h5>
              {currentPlan && (
                <p>
                  {price(currentPlan.amount)} a month ·{" "}
                  {creditCount(currentPlan.credits)} credits each paid month
                </p>
              )}
            </div>
            <div className="billing-current-plan-actions">
              <Button
                disabled={!data.available.extra || busy !== null}
                onClick={() => void start("extra")}
              >
                {busy === "extra" ? "Opening…" : "Add credits"}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Button>
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() => setPricingOpen(true)}
              >
                {currentPlan ? "Change plan" : "Upgrade"}
              </Button>
            </div>
          </div>
          {data.hasCustomer && (
            <Button
              variant="ghost"
              className="billing-portal-link"
              disabled={busy !== null}
              onClick={() => void start("portal")}
            >
              {busy === "portal"
                ? "Opening…"
                : hasSubscription
                  ? "Manage subscription, invoices & payment methods"
                  : "Billing history & payment methods"}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          )}
          <Modal
            open={pricingOpen}
            onOpenChange={setPricingOpen}
            title="Choose a plan"
            className="billing-pricing"
          >
            <div className="billing-plans">
              {plans.map(({ id, icon: Icon, pitch }) => {
                const offer = data.packages[id],
                  current = hasSubscription && data.plan === id;
                return (
                  <div
                    key={id}
                    className={`billing-plan ${current ? "billing-plan-current" : ""}`}
                  >
                    <div className="billing-plan-title">
                      <Icon size={16} aria-hidden="true" />
                      <h5>{offer.name}</h5>
                      {current && (
                        <span className="billing-plan-badge">Your plan</span>
                      )}
                    </div>
                    <p className="billing-plan-price">
                      {price(offer.amount)}
                      <span>USD / month</span>
                    </p>
                    <p className="billing-plan-allowance">
                      {creditCount(offer.credits)} credits each paid month
                    </p>
                    <p className="billing-plan-pitch">{pitch}</p>
                    {current ? (
                      <Button
                        variant="primary"
                        disabled={!data.hasCustomer || busy !== null}
                        onClick={() => void start("portal")}
                      >
                        {busy === "portal" ? "Opening…" : "Manage subscription"}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Button>
                    ) : hasSubscription ? (
                      <Button
                        variant="primary"
                        disabled={
                          !canSwitch || !data.available[id] || busy !== null
                        }
                        onClick={() => {
                          setPricingOpen(false);
                          setSwitchTo(id);
                        }}
                      >
                        {data.plan &&
                        offer.amount > data.packages[data.plan].amount
                          ? `Upgrade to ${offer.name}`
                          : `Switch to ${offer.name}`}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={!data.available[id] || busy !== null}
                        onClick={() => void start(id)}
                      >
                        {busy === id ? "Opening…" : "Subscribe"}
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                );
              })}
              <div className="billing-plan">
                <div className="billing-plan-title">
                  <Wallet size={16} aria-hidden="true" />
                  <h5>{data.packages.extra.name}</h5>
                </div>
                <p className="billing-plan-price">
                  {price(data.packages.extra.amount)}
                  <span>USD / one time</span>
                </p>
                <p className="billing-plan-allowance">
                  {creditCount(data.packages.extra.credits)} additional credits
                </p>
                <p className="billing-plan-pitch">
                  Top up whenever you need a little more room.
                </p>
                <Button
                  disabled={!data.available.extra || busy !== null}
                  onClick={() => void start("extra")}
                >
                  {busy === "extra" ? "Opening…" : "Add credits"}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Button>
              </div>
            </div>
          </Modal>
          <Modal
            open={target !== null}
            onOpenChange={(open) => !open && busy === null && setSwitchTo(null)}
            title={target ? `Switch to ${target.name}?` : ""}
            description={
              target
                ? upgrading
                  ? `Your card is charged ${price(target.amount)} now and a new monthly period starts today with ${creditCount(target.credits)} credits. Credits you already have stay.`
                  : `Your current plan continues until your next renewal. Then you pay ${price(target.amount)} a month for ${creditCount(target.credits)} credits. Credits you already have stay.`
                : undefined
            }
          >
            <div className="billing-confirm-actions">
              <Button
                disabled={busy !== null}
                onClick={() => setSwitchTo(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() => switchTo && void changePlan(switchTo)}
              >
                {busy
                  ? "Switching…"
                  : upgrading && target
                    ? `Pay ${price(target.amount)} and upgrade`
                    : "Switch at renewal"}
              </Button>
            </div>
          </Modal>
          <div className="billing-activity-heading">
            <h4>Credit activity</h4>
            <span>Grants, usage, and pending requests</span>
          </div>
          <div className="billing-activity">
            {rows.length ? (
              (showAll ? rows : rows.slice(0, 5)).map((entry) => (
                <div className="billing-entry" key={entry.id}>
                  <span
                    className={`billing-entry-icon ${entry.amount > 0 ? "grant" : ""}`}
                    aria-hidden="true"
                  >
                    {entry.id.startsWith("pending:") ? (
                      <Clock3 size={14} />
                    ) : entry.amount > 0 ? (
                      "+"
                    ) : (
                      "−"
                    )}
                  </span>
                  <div>
                    <strong>{entry.description}</strong>
                    <time dateTime={entry.createdAt}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <span
                    className={`billing-entry-amount ${entry.amount > 0 ? "grant" : ""}`}
                  >
                    {entry.amount > 0 ? "+" : ""}
                    {creditCount(entry.amount)}
                  </span>
                </div>
              ))
            ) : (
              <p className="billing-empty">
                Your credits and usage will appear here.
              </p>
            )}
          </div>
          {rows.length > 5 && (
            <Button
              variant="ghost"
              className="billing-show-all"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll
                ? "Show recent activity"
                : `Show all ${rows.length} entries`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
