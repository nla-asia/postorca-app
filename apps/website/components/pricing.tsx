import { ArrowDown, Check, Megaphone, Sparkles, Wallet } from "lucide-react";
// Plans, the credit rate and welcome credits come from the API, so the site always
// shows what the app charges.
import { creditTerms, membershipPackages } from "../../api/src/billing/terms";
import { settings } from "../../api/src/settings";

const count = (value: number) => new Intl.NumberFormat("en").format(value);
const price = (cents: number) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const { builder, influencer, extra } = membershipPackages;
const plans = [
  {
    offer: builder,
    icon: Sparkles,
    pitch: "For building your brand with Orca every week.",
    period: "per month",
    allowance: `${count(builder.credits)} credits each month`,
  },
  {
    offer: influencer,
    icon: Megaphone,
    pitch: "For daily content across every account you grow.",
    period: "per month",
    allowance: `${count(influencer.credits)} credits each month`,
    featured: true,
  },
  {
    offer: extra,
    icon: Wallet,
    pitch: "A top-up whenever you need a little more room.",
    period: "one time",
    allowance: `${count(extra.credits)} additional credits`,
  },
];

export function Pricing() {
  return (
    <section
      className="pricing-section section-shell"
      id="pricing"
      aria-labelledby="pricing-title"
    >
      <div className="section-heading">
        <div>
          <div className="section-kicker">Simple, usage-based pricing</div>
          <h2 id="pricing-title">Pay for the work Orca does.</h2>
        </div>
        <p>
          Start with {count(settings.welcomeCredits)} free credits.{" "}
          <br />
          Choose a plan when you want more.
        </p>
      </div>
      <div className="pricing-grid">
        {plans.map(
          ({ offer, icon: Icon, pitch, period, allowance, featured }) => (
            <article
              key={offer.id}
              className={`pricing-card ${featured ? "pricing-card-featured" : ""}`}
            >
              <div className="pricing-name">
                <Icon size={16} aria-hidden="true" />
                <h3>{offer.name}</h3>
                {featured && <span className="pricing-badge">Most room</span>}
              </div>
              <p className="pricing-price">
                {price(offer.amount)}
                <span>USD {period}</span>
              </p>
              <p className="pricing-allowance">
                <Check size={14} aria-hidden="true" />
                {allowance}
              </p>
              <p className="pricing-pitch">{pitch}</p>
            </article>
          ),
        )}
      </div>
      <div className="pricing-notes">
        <div>
          <h3>How credits work</h3>
          <p>
            One credit covers ${creditTerms.usdPerCredit} of AI usage. Each
            reply from Orca is charged what it actually cost, rounded up to a
            whole credit. Unused credits roll over and never expire.
          </p>
        </div>
        <div>
          <h3>Changing plans</h3>
          <p>
            Upgrade any time: you pay the new plan now and start a fresh month
            with its credits. Downgrades apply at your next renewal. Credits you
            already have always stay.
          </p>
        </div>
        <div>
          <h3>Where to subscribe</h3>
          <p>
            Choose a plan in the app, under Settings → Billing &amp; Usage.
            Checkout is handled securely by Stripe.
          </p>
          <a href="#download" className="text-link">
            Get PostOrca
            <ArrowDown size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}
