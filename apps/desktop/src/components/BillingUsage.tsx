import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Clock3,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import { api } from "../lib/api";
import { Button } from "./ui";
import "./BillingUsage.css";

type Billing = {
  configured: boolean;
  extraConfigured: boolean;
  hasCustomer: boolean;
  status: string;
  packages: Record<
    "membership" | "extra",
    { name: string; amount: number; credits: number }
  >;
  welcomeCredits: number;
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

export default function BillingUsage() {
  const [data, setData] = useState<Billing | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [reload, setReload] = useState(0);
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
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [reload]);
  const start = useCallback(
    async (action: "membership" | "extra" | "portal") => {
      setBusy(action);
      setActionError("");
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
    [],
  );
  const rows = data?.credits.entries ?? [];
  const hasSubscription = data ? managed.has(data.status) : false;
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
              <span className="billing-status">
                {statusLabels[data.status] ?? "Subscription status unavailable"}
              </span>
            </div>
            <div className="billing-balance-number">
              {creditCount(data.credits.balance)}
              <span>credits</span>
            </div>
            <p>Unused credits roll over. Your balance has no expiry.</p>
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
          <div className="billing-plans">
            <div className="billing-plan billing-plan-membership">
              <div className="billing-plan-title">
                <Sparkles size={16} aria-hidden="true" />
                <h5>{data.packages.membership.name}</h5>
              </div>
              <p className="billing-plan-price">
                {price(data.packages.membership.amount)}
                <span>USD / month</span>
              </p>
              <p className="billing-plan-allowance">
                {creditCount(data.packages.membership.credits)} credits each
                paid month
              </p>
              <p>For ongoing ideas, content, and work with Orca.</p>
              {hasSubscription ? (
                <Button
                  variant="primary"
                  disabled={!data.hasCustomer || busy !== null}
                  onClick={() => void start("portal")}
                >
                  {busy === "portal" ? "Opening…" : "Manage subscription"}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={!data.configured || busy !== null}
                  onClick={() => void start("membership")}
                >
                  {busy === "membership" ? "Opening…" : "Subscribe"}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
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
              <p>Top up whenever you need a little more room.</p>
              <Button
                disabled={!data.extraConfigured || busy !== null}
                onClick={() => void start("extra")}
              >
                {busy === "extra" ? "Opening…" : "Add credits"}
                <ArrowUpRight size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
          <p className="billing-footnote">
            New accounts receive {creditCount(data.welcomeCredits)} welcome
            credits once.{" "}
            {data.configured || data.extraConfigured
              ? "Payments currently use Stripe test mode."
              : "Payments are not available yet."}
          </p>
          {data.hasCustomer && !hasSubscription && (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void start("portal")}
            >
              Billing history &amp; payment methods
              <ArrowUpRight size={14} aria-hidden="true" />
            </Button>
          )}
          {paymentUrl && (
            <div className="billing-notice" role="status">
              Finish in your browser, then return here. Your balance refreshes
              automatically.{" "}
              <a href={paymentUrl} target="_blank" rel="noopener noreferrer">
                Open Stripe again
              </a>
            </div>
          )}
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
