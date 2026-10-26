import { useState } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "../components/ui";
import "./Agent.css";

export default function Agent() {
  const [input, setInput] = useState("");
  return (
    <section className="chat-page" aria-label="Agent chat">
      <header className="work-header">
        <span className="brand-mark small">
          <Sparkles size={15} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <div className="work-heading">
          <h1>Asia</h1>
        </div>
      </header>
      <div className="chat-scroll">
        <div className="chat-welcome">
          <h2>What can I help you with today?</h2>
        </div>
      </div>
      <div className="composer-wrap">
        <form className="composer" onSubmit={(event) => event.preventDefault()}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Message Asia"
            aria-label="Message your agent"
            aria-describedby="agent-preview"
          />
          <div className="composer-bottom">
            <Button
              variant="primary"
              type="submit"
              disabled
              aria-label="Send message"
              title="Agent replies are coming soon"
            >
              <ArrowUp size={18} aria-hidden="true" />
            </Button>
          </div>
        </form>
        <p id="agent-preview" className="preview-note">
          Preview · Agent replies are coming soon. Messages are not sent.
        </p>
      </div>
    </section>
  );
}
