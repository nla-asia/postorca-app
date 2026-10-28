import type { Metadata } from "next";
import { Mark } from "../../components/brand";

export const metadata: Metadata = {
  title: "Privacy Policy — PostOrca Browser Extension",
  description:
    "How the PostOrca browser extension and its companion service handle browser-task data, screenshots, and local connection information.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    title: "Privacy Policy — PostOrca Browser Extension",
    description: "How PostOrca handles browser-task data.",
    url: "https://orca.atpa.site/privacy",
  },
};

export default function Privacy() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <a href="/" className="wordmark" aria-label="PostOrca home">
          <Mark /><span>PostOrca</span>
        </a>
        <nav aria-label="Main navigation"><a href="/">Back to home</a></nav>
      </header>
      <main id="main" className="privacy-page">
        <p className="privacy-eyebrow">PostOrca browser extension</p>
        <h1>Privacy policy</h1>
        <p className="privacy-updated">Last updated: October 28, 2026</p>
        <p className="privacy-intro">
          The PostOrca extension connects your browser to the PostOrca desktop
          app so Orca can carry out browser tasks using your existing website
          sign-ins. This policy covers the extension and the browser-task data
          processed by the companion desktop app and PostOrca service.
        </p>

        <section aria-labelledby="scope">
          <h2 id="scope">Where Orca works</h2>
          <p>
            Orca opens and controls its own tabs. These are normally placed in a
            green Orca tab group; some tasks, such as recording, use a separate
            window. The extension checks that a tab was opened by Orca before
            forwarding commands or browser events for it. It does not routinely
            scan your other tabs or collect your browser history.
          </p>
          <p>
            Orca uses the browser profile in which you installed the extension.
            Websites in Orca tabs can therefore use your existing signed-in
            sessions. Content accessible in those tabs can include private or
            sensitive information.
          </p>
        </section>

        <section aria-labelledby="information">
          <h2 id="information">Information we handle</h2>
          <ul>
            <li><strong>Browser-task content.</strong> Page URLs and titles,
              visible text and accessibility information, screenshots, task
              inputs and actions, and files retrieved for your tasks. This can
              include personal information, communications, and other content
              on websites you ask Orca to use.</li>
            <li><strong>Browser protocol data.</strong> The extension forwards
              debugging commands, results, and events for Orca tabs to the
              desktop app. Depending on the task, these can contain page
              resources, network request and response information, and
              session-related information. Websites may use cookies or other
              credentials when Orca accesses pages or fetches files.</li>
            <li><strong>Connection information.</strong> A randomly generated
              browser-profile identifier, browser name, user agent, extension
              version, connection status, and connection errors.</li>
          </ul>
          <p>
            The extension stores the profile identifier in local extension
            storage. Connection status and the IDs of Orca-owned tabs are kept
            in browser session storage. It does not ask you to enter website
            passwords into the extension.
          </p>
        </section>

        <section aria-labelledby="processing">
          <h2 id="processing">How information moves and is used</h2>
          <p>
            The extension discovers the desktop app through Chrome native
            messaging and connects to an authenticated relay on your own
            computer. The extension itself connects to that local relay rather
            than directly to an AI provider.
          </p>
          <p>
            Browser tasks are not processed entirely on your device. The desktop
            app sends task results, including page content and requested
            screenshots or files, to the PostOrca server. The service stores task
            history and attachments and sends relevant task context to the AI
            provider to generate responses and decide the next task action.
            The current text-model integration uses OpenAI. Technical logs and
            diagnostic traces may also contain task context and results.
          </p>
          <p>
            We use this information to perform your requested or scheduled tasks,
            show results and history, maintain your browser connection, and
            diagnose service problems. Websites you interact with receive the
            requests and content involved in those actions under their own
            privacy policies.
          </p>
        </section>

        <section aria-labelledby="sharing">
          <h2 id="sharing">Sharing and limited use</h2>
          <p>
            Browser-task data is processed by PostOrca and the hosting, storage,
            and AI service providers needed to deliver the requested features.
            We do not sell browser-task data or use it for advertising or
            unrelated profiling. We may disclose information when legally
            required or necessary to investigate abuse and protect the service.
          </p>
          <p>
            Our use of information received through the extension and Google
            APIs adheres to the Chrome Web Store User Data Policy, including its
            Limited Use requirements. Browser data is used only to provide or
            improve the user-facing features described in the extension listing
            and interface, subject to that policy&apos;s permitted exceptions.
          </p>
        </section>

        <section aria-labelledby="retention">
          <h2 id="retention">Storage, retention, and deletion</h2>
          <p>
            The extension&apos;s profile identifier remains locally until its
            storage is cleared or the extension is removed. Browser session
            state is temporary. The desktop app also stores local connection
            preferences, and retrieved files can remain in your Downloads/PostOrca
            folder until you delete them.
          </p>
          <p>
            Task history, attachments, and diagnostic records can remain on the
            PostOrca server after a task ends; there is no automatic deletion at
            the end of a browser session. Uninstalling the extension does not
            delete server records or downloaded files. Contact us to request
            access, correction, or deletion of your server-side browser-task
            data. Records required for legal obligations or security may need
            to be retained. AI providers also apply their own retention policies.
          </p>
        </section>

        <section aria-labelledby="choices">
          <h2 id="choices">Your controls</h2>
          <p>
            You can close Orca tabs, cancel Chrome&apos;s debugger connection,
            disable or uninstall the extension, or quit the desktop app to stop
            browser control. Cancel any scheduled browser routines in PostOrca
            if you no longer want them to run. Stopping a task does not undo
            actions already completed or delete information already processed.
          </p>
          <p>
            Only ask Orca to access information you want processed for your task.
            You can use a separate browser profile to limit which signed-in
            accounts and website data are available to Orca.
          </p>
        </section>

        <section aria-labelledby="contact">
          <h2 id="contact">Contact and policy changes</h2>
          <p>
            For privacy questions or data requests, email the PostOrca team at{" "}
            <a href="mailto:nla@autopilotstartup.com">nla@autopilotstartup.com</a>. Include
            your account email and the relevant task, without sending passwords
            or other credentials.
          </p>
          <p>
            We will publish changes to this policy on this page and update the
            date above. The policy is available at{" "}
            <a href="https://orca.atpa.site/privacy">orca.atpa.site/privacy</a>.
          </p>
        </section>
      </main>
      <footer className="site-footer">
        <a className="wordmark" href="/" aria-label="PostOrca home">
          <Mark /><span>PostOrca</span>
        </a>
        <nav aria-label="Footer"><a href="/">Home</a><a href="/privacy/" aria-current="page">Privacy</a></nav>
        <span className="copyright">© {new Date().getFullYear()} PostOrca</span>
      </footer>
    </>
  );
}
