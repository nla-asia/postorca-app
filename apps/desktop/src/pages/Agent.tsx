import AgentChat from "../components/AgentChat";
import Mark from "../components/BrandMark";
import type { useAgentChat } from "../lib/useAgentChat";

export default function Agent({
  chat,
}: {
  chat: ReturnType<typeof useAgentChat>;
}) {
  return (
    <section className="chat-page" aria-label="Agent chat">
      <header className="work-header">
        <Mark small />
        <div className="work-heading">
          <h1>Orca</h1>
        </div>
      </header>
      <AgentChat chat={chat} />
    </section>
  );
}
