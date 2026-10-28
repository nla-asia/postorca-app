import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  FileText,
  Globe2,
  Inbox,
  MessageSquare,
  Search,
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
    "PostOrca is a desktop app built around Orca, an AI agent focused on your personal brand. Work with Orca on content ideas, drafts, and relevant conversations, with your brand context in one place.",
  ],
  [
    "Will it sound like me?",
    "Brand setup happens through a conversation with Orca. Share what you're building, who you're speaking to, and the topics and tone that feel right. You can give feedback on each piece of work and keep refining the direction.",
  ],
  [
    "Does Orca publish automatically?",
    "Publishing is not connected yet. Orca prepares work for your review. During onboarding, you can record how you eventually want content published—manually, through a browser, or through a specific tool.",
  ],
  [
    "How do scheduled tasks work?",
    "Use a routine for recurring work, or schedule a task once from Calendar. Scheduling runs on the server. When a task needs your browser, the desktop app and browser connection need to be available.",
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
            Your personal brand agent
          </div>
          <h1 id="hero-title">
            Meet{" "}
            <span className="hero-symbol">
              <Mark />
            </span>{" "}
            Orca.
          </h1>
          <p className="hero-copy">
            You keep building. Orca keeps your story moving.
            <br className="desktop-break" /> An AI partner for ideas, drafts,
            and conversations—in your voice.
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
              One agent. A little less on your plate.
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
            Built for the founder behind the company
          </div>
          <h2 id="intro-title">
            You have something to say.
            <br />
            <span>Make room to say it.</span>
          </h2>
          <p>
            Between shipping, talking to customers, and everything in between,
            showing up can become another job. Orca helps turn the work you're
            already doing into a presence that feels like you.
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
                From a thought to something worth sharing
              </div>
              <h2 id="workflow-title">A partner for the work.</h2>
            </div>
            <p>
              Give Orca a little direction.
              <br />
              Come back to work you can review.
            </p>
          </div>
          <div className="feature-grid">
            <article className="feature feature-large">
              <div className="feature-copy">
                <span className="feature-number">
                  01 / GET TO KNOW EACH OTHER
                </span>
                <h3>
                  A conversation.
                  <br />
                  Your point of view.
                </h3>
                <p>
                  Tell Orca what you're building, the topics you care about, and
                  where you want to show up. Your point of view comes first.
                </p>
              </div>
              <div className="onboarding-visual">
                <div className="visual-author">
                  <span className="asia-avatar">
                    <Mark />
                  </span>
                  Orca
                </div>
                <h4>What would you like to share more about?</h4>
                <div className="topic selected">
                  <span>
                    <Check size={12} />
                  </span>
                  Building in public
                </div>
                <div className="topic selected">
                  <span>
                    <Check size={12} />
                  </span>
                  Lessons from being a founder
                </div>
                <div className="topic">
                  <span />
                  The things I'm learning
                </div>
                <div className="visual-footer">
                  Your own answer is always welcome.
                  <span>
                    <ArrowRight size={16} />
                  </span>
                </div>
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
                  <span className="orbit-app app-x">𝕏</span>
                  <span className="orbit-app app-threads">@</span>
                  <span className="orbit-app app-web">
                    <Globe2 size={21} />
                  </span>
                  <span className="orbit-app app-search">
                    <Search size={21} />
                  </span>
                </div>
              </div>
              <div className="feature-copy">
                <span className="feature-number">
                  02 / FIND THE STARTING POINT
                </span>
                <h3>
                  Good ideas are already
                  <br />
                  all around you.
                </h3>
                <p>
                  Discover topics and conversations relevant to your work. Find
                  a point of view worth adding, rather than another trend to
                  chase.
                </p>
              </div>
            </article>
            <article className="feature feature-small">
              <div className="review-visual">
                <div>
                  <span className="asia-avatar">
                    <Mark />
                  </span>
                  <strong>Your launch story</strong>
                  <span className="tiny-status">For review</span>
                </div>
                <p>
                  "The most useful thing I learned this week wasn't in the
                  roadmap…"
                </p>
                <div className="visual-artifact">
                  <FileText size={15} />
                  Content draft
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
                <span className="feature-number">03 / MAKE IT YOURS</span>
                <h3>
                  Finished work.
                  <br />
                  Your final say.
                </h3>
                <p>
                  Ideas, drafts, and research land in your Inbox. Review the
                  work, leave feedback, or approve it when it feels right.
                </p>
              </div>
            </article>
            <article className="feature feature-large routine-feature">
              <div className="feature-copy">
                <span className="feature-number">
                  04 / KEEP A LITTLE MOMENTUM
                </span>
                <h3>
                  Consistency,
                  <br />
                  without the calendar guilt.
                </h3>
                <p>
                  Give recurring work a routine, or schedule a task for a
                  specific time. Keep your attention on building, with a place
                  to pick up where you left off.
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
                    Find your next conversation
                    <small>Every weekday · 09:00</small>
                  </div>
                  <span className="status-dot" />
                </div>
                <div className="rhythm-task">
                  <span>
                    <Sparkles size={15} />
                  </span>
                  <div>
                    A few ideas for next week<small>Monday · 10:00</small>
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
            <h2>Your voice is the whole point.</h2>
            <p>
              Orca brings the starting points. You bring the perspective.
              <br />
              Together, turn everyday work into a story only you could tell.
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
          <span className="section-kicker">A little momentum, every day.</span>
          <h2>
            Keep building.
            <br />
            Let your story catch up.
          </h2>
          <p>A personal brand partner, right on your desktop.</p>
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
        <span>Personal Brand Agent</span>
        <nav aria-label="Footer">
          <a href="#product">The app</a>
          <a href="#pricing">Pricing</a>
          <a href="#questions">Questions</a>
          <a href="/privacy">Privacy</a>
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
