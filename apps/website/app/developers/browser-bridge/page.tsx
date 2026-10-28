import type { Metadata } from "next";
import { Mark } from "../../../components/brand";

export const metadata: Metadata = {
  title: "Browser Bridge Developer Guide — PostOrca",
  description: "Connect your own local agent to Chrome using PostOrca Browser Bridge. Download the Node.js companion example and implement the authenticated relay protocol.",
  alternates: { canonical: "/developers/browser-bridge" },
  openGraph: { title: "PostOrca Browser Bridge Developer Guide", description: "A local browser bridge for your agent.", url: "https://orca.atpa.site/developers/browser-bridge" },
};

const messages = [
  ["Companion → extension", "challenge", '{"type":"challenge","nonce":"random UTF-8 string"}'],
  ["Extension → companion", "proof", '{"type":"proof","proof":"HMAC-SHA256 hex digest"}'],
  ["Companion → extension", "accepted", '{"type":"accepted"}'],
  ["Extension → companion", "hello", '{"type":"hello","id":"profile UUID","browser":"Chrome","userAgent":"…","extensionVersion":"…"}'],
  ["Companion → extension", "createTab", '{"seq":1,"type":"createTab","url":"about:blank","newWindow":false}'],
  ["Extension → companion", "result", '{"seq":1,"type":"result","result":{"tabId":123,"targetId":"…","url":"about:blank","title":""}}'],
  ["Companion → extension", "cdp", '{"seq":2,"type":"cdp","tabId":123,"method":"Runtime.evaluate","params":{"expression":"document.title","returnByValue":true}}'],
  ["Extension → companion", "error", '{"seq":2,"type":"error","message":"reason"}'],
  ["Extension → companion", "cdpEvent", '{"type":"cdpEvent","tabId":123,"method":"Page.loadEventFired","params":{}}'],
  ["Companion → extension", "closeTab", '{"seq":3,"type":"closeTab","tabId":123}'],
  ["Extension → companion", "detached", '{"type":"detached","tabId":123,"reason":"target_closed"}'],
];

export default function BrowserBridgeGuide() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <a href="/" className="wordmark" aria-label="PostOrca home"><Mark /><span>PostOrca</span></a>
        <nav aria-label="Main navigation"><a href="/">Home</a><a href="/privacy/">Privacy</a></nav>
      </header>
      <main id="main" className="privacy-page bridge-guide">
        <p className="privacy-eyebrow">For agent and desktop software developers</p>
        <h1>Connect your agent to Chrome</h1>
        <p className="privacy-intro">PostOrca Browser Bridge connects a locally installed companion to Chrome. Use PostOrca, run the standalone example, or implement the protocol in your own software.</p>
        <p>The extension has no separate account or AI model. Its companion provides the agent and determines how browser data is processed. Existing agents need an integration; installing the extension alone does not connect them.</p>

        <section aria-labelledby="quickstart">
          <h2 id="quickstart">Try the standalone companion</h2>
          <p>Requires Node.js 22 or newer and Chrome 125 or newer. The example registers a separate native host on Windows or macOS; a Linux Chrome registration path is also included. Native launch has been verified on Windows. No PostOrca desktop app, API server, account, or AI key is needed.</p>
          <ol>
            <li>Install the extension. For development, load the extension folder unpacked at <code>chrome://extensions</code>. Copy the actual extension ID shown there.</li>
            <li><a href="/downloads/postorca-browser-companion.tgz" download>Download the Node.js companion example</a>, or install it using the command below.</li>
            <li>Install its native host and start it with the same extension ID. Keep the process running.</li>
          </ol>
          <pre><code>{`npm install --global https://orca.atpa.site/downloads/postorca-browser-companion.tgz
postorca-browser-bridge install --extension-id YOUR_EXTENSION_ID
postorca-browser-bridge start --extension-id YOUR_EXTENSION_ID`}</code></pre>
          <p>In the extension popup, open <strong>Connection settings</strong>, set the host to <code>com.postorca.browser.example</code>, and save. In a second terminal, run:</p>
          <pre><code>postorca-browser-bridge demo</code></pre>
          <p>The example opens an empty tab, writes a confirmation message, reads its title, then closes it. Your terminal should print <code>PostOrca bridge demo</code>. It does not contact an external website or AI service. The package includes its source and integration README.</p>
          <p>Stop the companion with Ctrl+C and run <code>postorca-browser-bridge uninstall</code> to unregister the example. Select <strong>Use PostOrca</strong> in Connection settings to switch back. Finish ongoing tasks before switching: reconnecting closes tabs from the previous bridge session.</p>
        </section>

        <section aria-labelledby="agent">
          <h2 id="agent">Attach your own agent</h2>
          <p>The example writes connected browsers and their CDP endpoints to <code>~/.postorca-browser-companion/connection.json</code>. Read this file from your local software, then use a WebSocket CDP client or Playwright&apos;s <code>chromium.connectOverCDP(endpoint)</code>. The README includes a Playwright example.</p>
          <p>The endpoint contains a credential. Keep it local and private. The example binds only to <code>127.0.0.1</code>, checks the extension origin, and requires proof of a fresh pairing secret. There is one active automation client per connected browser profile; a new client replaces the old one and closes its tabs.</p>
          <p>Browser-level CDP support is intentionally limited to <code>Browser.getVersion</code>, <code>Browser.close</code>, <code>Target.createTarget</code>, <code>Target.closeTarget</code>, <code>Target.getTargets</code>, <code>Target.getTargetInfo</code>, and <code>Target.getBrowserContexts</code>. Discovery, auto-attach, and download behavior setup calls are acknowledged for Playwright compatibility. Session commands are forwarded through Chrome&apos;s Debugger API; unsupported CDP domains and browser-wide operations may fail. This is not a full remote-debugging endpoint.</p>
        </section>

        <section aria-labelledby="native-host">
          <h2 id="native-host">Implement your own companion</h2>
          <p>Register a native messaging host with a unique name, such as <code>com.example.my_agent</code>. Users select that host in Connection settings. The default <code>com.postorca.browser</code> remains reserved for PostOrca. A web page cannot register a native host: your local installer must do so.</p>
          <p>Follow <a href="https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging">Chrome&apos;s native messaging format and OS-specific registration instructions</a>. Restrict <code>allowed_origins</code> to the actual installed extension ID. The native host receives <code>{'{"type":"pair"}'}</code> and returns one length-prefixed UTF-8 JSON message:</p>
          <pre><code>{`{"ok":true,"port":12345,"secret":"64 hexadecimal characters"}`}</code></pre>
          <p>The port must be an integer from 1 to 65535. Generate a new 32-byte secret for each companion run. Return <code>{'{"ok":false,"code":"not_running"}'}</code> if unavailable. Validate the caller&apos;s extension origin before returning any secret. The host&apos;s stdout must contain only framed protocol messages.</p>
          <p>The extension connects to <code>ws://127.0.0.1:PORT/extension</code>. The companion checks the WebSocket <code>Origin</code> against <code>chrome-extension://EXTENSION_ID</code>, then sends a random challenge. The extension signs the nonce&apos;s UTF-8 bytes with HMAC-SHA256 using the decoded hexadecimal secret, and returns a lowercase hexadecimal digest. Verify the digest in constant time before accepting. Complete the handshake within five seconds.</p>
          <p>The selected host receives the browser-profile identifier and browser metadata after authentication. Keep pairing credentials in a user-private location, never embed them in the extension, and remove live pairing information when stopping.</p>
        </section>

        <section aria-labelledby="protocol">
          <h2 id="protocol">Relay messages</h2>
          <p>Messages are JSON text frames. Match command replies by <code>seq</code>; asynchronous events have no sequence. <code>cdp</code> commands and <code>cdpEvent</code> messages can include a Chrome child-target <code>sessionId</code> for an iframe or worker.</p>
          <div className="protocol-messages">
            {messages.map(([direction, type, example]) => (
              <div key={type}><h3>{type}</h3><p>{direction}</p><pre><code>{example}</code></pre></div>
            ))}
          </div>
          <p>A successful command returns <code>{'{"type":"result","seq":NUMBER,"result":{…}}'}</code>. <code>closeTab</code> returns an empty result. Send <code>{'{"type":"ping"}'}</code> every 20 seconds; the extension answers <code>{'{"type":"pong"}'}</code>. Close a connection that misses heartbeats. The example uses a 60-second command timeout.</p>
          <p>The extension checks ownership before controlling a tab or forwarding its events. Tab IDs refer to this Chrome session, not arbitrary CDP target IDs. Most new tabs join the green Orca group; <code>newWindow: true</code> opens an unfocused window for tasks such as recording. Reconnection closes old bridge-owned tabs. Dismissing Chrome&apos;s debugging banner closes the affected bridge tab.</p>
        </section>

        <section aria-labelledby="responsibilities">
          <h2 id="responsibilities">Data handling and user control</h2>
          <p>Your companion can receive sensitive page content, screenshots, network events, and data from signed-in websites, and can take actions in bridge-created tabs. Explain these capabilities to users before starting tasks. Provide your own authorization controls, privacy policy, retention and deletion process, and any disclosures about remote servers or AI providers.</p>
          <p>The example itself does not upload browser data. PostOrca&apos;s own desktop integration can send task results to the PostOrca service and its AI provider. See the <a href="/privacy/">extension privacy policy</a>. Users can close tabs, cancel Chrome&apos;s debugger attachment, disable the extension, or stop the companion. Do not represent a browser profile as isolated from its existing accounts: bridge tabs use that profile&apos;s signed-in sessions.</p>
          <p>Questions or integration feedback: <a href="mailto:nla@autopilotstartup.com">nla@autopilotstartup.com</a>.</p>
        </section>
      </main>
      <footer className="site-footer">
        <a className="wordmark" href="/"><Mark /><span>PostOrca</span></a>
        <nav aria-label="Footer"><a href="/">Home</a><a href="/privacy/">Privacy</a></nav>
        <span className="copyright">© {new Date().getFullYear()} PostOrca</span>
      </footer>
    </>
  );
}
