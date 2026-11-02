import type { Metadata } from "next";
import { Mark } from "../../../components/brand";

// Stripe Checkout and the billing portal send people here when they finish or
// cancel. Credits are granted by the API's webhook, never by visiting this page.
export const metadata: Metadata = {
  title: "Return to PostOrca",
  description: "Your billing changes appear in the PostOrca app.",
  robots: { index: false },
};

export default function BillingReturn() {
  return (
    <>
      <header className="site-header">
        <a href="/" className="wordmark" aria-label="PostOrca home">
          <Mark />
          <span>PostOrca</span>
        </a>
      </header>
      <main id="main" className="billing-return">
        <span className="billing-return-mark">
          <Mark />
        </span>
        <h1>You can return to PostOrca.</h1>
        <p>
          Close this tab and open Settings → Billing &amp; Usage in the app.
          Confirmed payments appear there automatically; new credits can take a
          moment to arrive.
        </p>
        <p className="billing-return-note">
          If you left checkout without paying, nothing was charged.
        </p>
        <a href="/#pricing" className="button button-soft">
          See plans
        </a>
      </main>
    </>
  );
}
