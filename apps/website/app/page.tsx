import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clapperboard,
  FileText,
  Globe2,
  Inbox,
  MessageSquare,
  Monitor,
  Search,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Mark } from "../components/brand";
import { Pricing } from "../components/pricing";
import { ProductDemo } from "../components/product-demo";
import { creditTerms } from "../../api/src/billing/terms";
import { settings } from "../../api/src/settings";

const questions = [
  [
    "What is PostOrca?",
    "PostOrca is a desktop app built around Orca, an AI agent that turns what you build into product content: launch videos, feature announcements, how-tos and what's-new round-ups, made from your code and your real app.",
  ],
  [
    "What can Orca record?",
    "Web apps in your browser, Mac apps, and iPhone apps in the iOS Simulator. Orca records your real app, so what viewers see is what your product does.",
  ],
  [
    "Will it sound like me?",
    "Orca learns what you're building, who it's for and how you talk. Every video starts as a script you approve, and you can change anything with a reply.",
  ],
  [
    "Does Orca post for me?",
    "No. Orca prepares the work for your review: the plan, the script and the finished video, all in one folder for each piece of content. You decide what goes out and where.",
  ],
  [
    "What are routines?",
    "Work Orca does for you every day on its own, like checking what changed in your projects or how your posts did. You can also schedule a task once from Calendar.",
  ],
  [
    "Which apps can I connect?",
    "The first API connectors are Gmail and Google Drive. Browser tools also help Orca research relevant sites using your signed-in browser. Each connection requires your authorization; adding a link to your profile does not grant access.",
  ],
  [
    "How do credits work?",
    `Every account starts with ${settings.welcomeCredits} free credits. One credit covers $${creditTerms.usdPerCredit} of AI usage, and each reply from Orca is charged what it actually cost, rounded up to a whole credit. Plans add credits every month, and unused credits roll over.`,
  ],
  [
    "When can I download it?",
    "The macOS release is being prepared. A download will be available here when it's ready. Support for other platforms has not been announced.",
  ],
];
export default function Home() {
  const configuredDownload = process.env.POSTORCA_MACOS_DOWNLOAD_URL;
  const download = configuredDownload?.startsWith("https://")
    ? configuredDownload
    : null;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a href="#" className="wordmark" aria-label="PostOrca home">
          <Mark />
          <span>PostOrca</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#product">The app</a>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#questions">Questions</a>
        </nav>
        <a className="button button-small button-dark" href="#download">
          Get PostOrca
          <ArrowUpRight size={14} />
        </a>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-eyebrow">
            <span className="status-dot" />
            From your code to launch videos
          </div>
          <h1 id="hero-title">
            Meet{" "}
            <span className="hero-symbol">
              <Mark />
            </span>{" "}
            Orca.
          </h1>
          <p className="hero-copy">
            You ship it. Orca shows it.
            <br className="desktop-break" /> Launch videos, feature
            announcements and how-tos, made from your code.
          </p>
          <div className="hero-actions">
            <a href="#product" className="button button-dark">
              See Orca in action
              <ArrowDown size={16} />
            </a>
            <a href="#how-it-works" className="button button-soft">
              How it works
              <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="product-stage" id="product">
            <ProductDemo />
            <p className="demo-caption">
              One agent. From your code to a finished video.
              <span>
                Explore the app above <ArrowUpRight size={12} />
              </span>
            </p>
          </div>
        </section>
        <section
          className="intro-section section-shell"
          aria-labelledby="intro-title"
        >
          <div className="section-kicker">
            Built for the founder behind the product
          </div>
          <h2 id="intro-title">
            You shipped something.
            <br />
            <span>Show it.</span>
          </h2>
          <p>
            Every feature deserves to be seen, but planning, recording and
            editing a video is another job. Orca turns what you built into
            content people can watch, starting from the code you already wrote.
          </p>
        </section>
        <section
          className="feature-section section-shell"
          id="how-it-works"
          aria-labelledby="workflow-title"
        >
          <div className="section-heading">
            <div>
              <div className="section-kicker">
                From code to a finished video
              </div>
              <h2 id="workflow-title">Plan, script, video.</h2>
            </div>
            <p>
              Give Orca a little direction.
              <br />
              Come back to a video you can review.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature feature-large">
              <div className="feature-copy">
                <span className="feature-number">
                  01 / LEARN THE PRODUCT
                </span>
                <h3>
                  Your code.
                  <br />
                  Your real app.
                </h3>
                <p>
                  Orca reads your project and recent commits, then opens the
                  running app: a web app, a Mac app, or an iPhone app in the
                  Simulator.
                </p>
              </div>
              <div className="onboarding-visual">
                <div className="visual-author">
                  <span className="asia-avatar">
                    <Mark />
                  </span>
                  Orca
                </div>
                <h4>What should the video show?</h4>
                <div className="topic selected">
                  <span>
                    <Check size={12} />
                  </span>
                  The whole product
                </div>
                <div className="topic selected">
                  <span>
                    <Check size={12} />
                  </span>
                  The feature you just shipped
                </div>
                <div className="topic">
                  <span />
                  A how-to users asked for
                </div>
                <div className="visual-footer">
                  Or say it in your own words.
                  <span>
                    <ArrowRight size={16} />
                  </span>
                </div>
              </div>
            </article>
            <article className="feature feature-small">
              <div className="review-visual">
                <div>
                  <span className="asia-avatar">
                    <Mark />
                  </span>
                  <strong>Launch video · script</strong>
                  <span className="tiny-status">For review</span>
                </div>
                <p>
                  "Meet Ledgerly, invoicing for freelancers and small
                  studios…"
                </p>
                <div className="visual-artifact">
                  <FileText size={15} />
                  script.md
                  <ArrowUpRight size={13} />
                </div>
                <footer>
                  <span>
                    <MessageSquare size={13} />
                    Follow Up
                  </span>
                  <span>
                    <Check size={13} />
                    Approve
                  </span>
                </footer>
              </div>
              <div className="feature-copy">
                <span className="feature-number">02 / APPROVE THE SCRIPT</span>
                <h3>
                  Nothing is recorded
                  <br />
                  until you say go.
                </h3>
                <p>
                  A plan and a shot-by-shot script, in plain words. Change
                  anything with a reply, then approve it.
                </p>
              </div>
            </article>
            <article className="feature feature-small">
              <div className="research-visual">
                <div className="research-orbit">
                  <div className="orbit-line line-one" />
                  <div className="orbit-line line-two" />
                  <span className="orbit-center">
                    <Mark />
                  </span>
                  <span className="orbit-app app-x"><Monitor size={21} /></span>
                  <span className="orbit-app app-threads"><Smartphone size={21} /></span>
                  <span className="orbit-app app-web">
                    <Globe2 size={21} />
                  </span>
                  <span className="orbit-app app-search">
                    <Clapperboard size={21} />
                  </span>
                </div>
              </div>
              <div className="feature-copy">
                <span className="feature-number">
                  03 / RECORD AND EDIT
                </span>
                <h3>
                  Your real app,
                  <br />
                  edited for you.
                </h3>
                <p>
                  Orca records each shot, frames it on what matters, and adds
                  voiceover and captions. The plan, script, recordings and
                  finished MP4 land in one folder.
                </p>
              </div>
            </article>
            <article className="feature feature-large routine-feature">
              <div className="feature-copy">
                <span className="feature-number">
                  04 / EVERY DAY, ON ITS OWN
                </span>
                <h3>
                  Ideas from
                  <br />
                  what you shipped.
                </h3>
                <p>
                  Routines are work Orca does for you every day on its own, like
                  checking what changed in your projects or how your posts did.
                </p>
              </div>
              <div className="rhythm-visual">
                <div className="rhythm-heading">
                  <CalendarDays size={17} />
                  <span>A week with Orca</span>
                  <span>OCT 19 — 25</span>
                </div>
                <div className="rhythm-days">
                  {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                    <div key={index}>
                      <span>{day}</span>
                      <b>{index + 19}</b>
                      {[0, 2, 4].includes(index) && <i />}
                    </div>
                  ))}
                </div>
                <div className="rhythm-task">
                  <span>
                    <Search size={15} />
                  </span>
                  <div>
                    What changed in your projects
                    <small>Every weekday · 09:00</small>
                  </div>
                  <span className="status-dot" />
                </div>
                <div className="rhythm-task">
                  <span>
                    <Sparkles size={15} />
                  </span>
                  <div>
                    How your posts did<small>Monday · 10:00</small>
                  </div>
                  <span className="status-dot" />
                </div>
              </div>
            </article>
          </div>
        </section>
        <section className="quiet-section section-shell">
          <Mark />
          <div>
            <h2>Your product is the whole point.</h2>
            <p>
              Orca does the recording and editing. You decide what it says.
              <br />
              Every video is planned with you and shows your real app.
            </p>
          </div>
        </section>
        <Pricing />
        <section
          className="faq-section section-shell"
          id="questions"
          aria-labelledby="faq-title"
        >
          <div>
            <div className="section-kicker">
              A few things you might be wondering
            </div>
            <h2 id="faq-title">Good questions.</h2>
          </div>
          <div className="faq-list">
            {questions.map(([question, answer], index) => (
              <details key={question} name="faq" open={index === 0}>
                <summary>
                  {question}
                  <span>+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="download-section section-shell" id="download">
          <div className="download-logo">
            <Mark />
          </div>
          <span className="section-kicker">Ship it. Show it.</span>
          <h2>
            Keep building.
            <br />
            Let your videos catch up.
          </h2>
          <p>From your code to launch videos, right on your desktop.</p>
          {download ? (
            <a href={download} className="button button-dark">
              Download for macOS
              <ArrowDown size={16} />
            </a>
          ) : (
            <button className="button button-dark" disabled>
              macOS release coming soon
            </button>
          )}
          <a href="#product" className="text-link">
            Take another look at Orca
            <ArrowUpRight size={14} />
          </a>
        </section>
      </main>
      <footer className="site-footer">
        <a className="wordmark" href="#" aria-label="PostOrca home">
          <Mark />
          <span>PostOrca</span>
        </a>
        <span>Product Content Agent</span>
        <nav aria-label="Footer">
          <a href="#product">The app</a>
          <a href="#pricing">Pricing</a>
          <a href="#questions">Questions</a>
          <a href="/privacy/">Privacy</a>
          <a href="/developers/browser-bridge/">For developers</a>
          <a href="/">
            orca.atpa.site
            <ArrowUpRight size={12} />
          </a>
        </nav>
        <span className="copyright">© {new Date().getFullYear()} PostOrca</span>
      </footer>
    </>
  );
}
