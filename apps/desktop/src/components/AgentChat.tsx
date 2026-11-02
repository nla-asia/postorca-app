import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import Mark from "./BrandMark";
import { Button } from "./ui";
import Markdown, { type ArtifactLink } from "./Markdown";
import QuestionWidget from "./QuestionWidget";
import WorkActions from "./WorkActions";
import {
  ArtifactRow,
  ArtifactViewer,
  MediaCard,
  type Viewable,
} from "./Artifacts";
import type { useAgentChat } from "../lib/useAgentChat";
import "./AgentChat.css";

/** The conversation with Orca: shared by Agent chat and onboarding. */
export default function AgentChat({
  chat,
}: {
  chat: ReturnType<typeof useAgentChat>;
}) {
  const [input, setInput] = useState("");
  const [viewing, setViewing] = useState<Viewable | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const { messages, working: thinking } = chat;
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);
  // Ideas belong to Inbox work; in chat every other artifact opens in the viewer.
  const artifactLink: ArtifactLink = (id) => {
    const item = chat.artifacts.find((value) => value.id === id);
    if (!item || item.kind === "idea") return null;
    if (item.kind === "url") {
      if (!/^https?:\/\//i.test(item.content)) return null;
      return () => window.open(item.content, "_blank", "noreferrer");
    }
    return () => setViewing({ type: "artifact", id });
  };
  const sendMessage = async (text = input) => {
    if (!text.trim() || thinking) return;
    if (await chat.send(text)) setInput("");
  };
  return (
    <>
      {chat.error && (
        <p className="chat-error" role="alert">
          {chat.error}
        </p>
      )}
      <div className="chat-scroll">
        {chat.loading ? (
          <div className="chat-loading" role="status">
            Loading…
          </div>
        ) : messages.length === 0 && !thinking ? (
          <div className="chat-welcome">
            <h2>What can I help you with today?</h2>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m) =>
              m.role === "media" ? (
                <div key={m.id} className="message agent media-message">
                  <Mark small />
                  <div>
                    {m.attachments.map((attachment) => (
                      <MediaCard
                        key={attachment.file}
                        attachment={attachment}
                        onOpen={() => setViewing({ type: "media", attachment })}
                      />
                    ))}
                  </div>
                </div>
              ) : m.role === "artifacts" ? (
                <div key={m.id} className="message agent media-message">
                  <Mark small />
                  <div>
                    {m.artifacts.map((item) => (
                      <ArtifactRow
                        key={item.id}
                        item={item}
                        onOpen={() =>
                          setViewing({ type: "artifact", id: item.id })
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : m.role === "actions" ? (
                <div key={m.id} className="message agent actions-message">
                  <Mark small />
                  <WorkActions
                    actions={m.actions}
                    working={m.working}
                    seconds={m.seconds}
                  />
                </div>
              ) : m.role === "question" ? (
                <div key={m.id} className="message agent question-message">
                  <Mark small />
                  <QuestionWidget
                    questions={m.questions}
                    active={m.active}
                    onSubmit={chat.send}
                  />
                </div>
              ) : (
                <div key={m.id} className={`message ${m.role}`}>
                  {m.role === "agent" && <Mark small />}
                  <div>
                    {m.role === "agent" && <strong>Orca</strong>}
                    {m.role === "agent" ? (
                      <Markdown text={m.text} artifact={artifactLink} />
                    ) : (
                      <p>{m.text}</p>
                    )}
                  </div>
                </div>
              ),
            )}
            {chat.failure && !thinking && (
              <div className="message agent">
                <Mark small />
                <p className="chat-turn-error" role="alert">
                  {chat.failure}
                </p>
              </div>
            )}
            {thinking &&
              !messages.some((m) => m.role === "actions" && m.working) && (
                <div className="message agent">
                  <Mark small />
                  <div className="thinking" role="status">
                    Thinking<span aria-hidden="true">•••</span>
                  </div>
                </div>
              )}
            <div ref={chatEnd} />
          </div>
        )}
      </div>
      {chat.taskId && (
        <ArtifactViewer
          taskId={chat.taskId}
          artifacts={chat.artifacts}
          viewing={viewing}
          onClose={() => setViewing(null)}
          onSaved={chat.reload}
          artifactLink={artifactLink}
        />
      )}
      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Message Orca"
            aria-label="Message your agent"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
          />
          <div className="composer-bottom">
            <Button
              variant="primary"
              type="submit"
              disabled={!input.trim() || thinking || !chat.ready}
              aria-label="Send message"
            >
              <ArrowUp size={18} aria-hidden="true" />
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
