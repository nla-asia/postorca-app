import { useEffect } from "react";
import { Settings } from "lucide-react";
import AgentChat from "../components/AgentChat";
import Mark from "../components/BrandMark";
import { Button } from "../components/ui";
import { useAgentChat } from "../lib/useAgentChat";
import type { BrandProject } from "../lib/brand";
import "./Agent.css";

/** The same Orca conversation UI, with a persistent conversation per project. */
export default function Agent({
  userId,
  project,
  onSettings,
  onTurnComplete,
}: {
  userId: string;
  project: BrandProject;
  onSettings: () => void;
  onTurnComplete: () => Promise<void>;
}) {
  const chat = useAgentChat(userId, "chat", project.id);
  useEffect(() => {
    if (chat.ready && !chat.working) void onTurnComplete();
  }, [chat.ready, chat.working, onTurnComplete]);
  return (
    <section
      className="chat-page agent-page"
      aria-label={`${project.name} agent chat`}
    >
      <header className="work-header">
        <Mark small />
        <div className="work-heading project-chat-title">
          <h1>{project.name}</h1>
          <small className="muted">Orca</small>
        </div>
        <Button
          variant="ghost"
          onClick={onSettings}
          aria-label="Project settings"
          title="Project settings"
        >
          <Settings size={18} aria-hidden="true" />
        </Button>
      </header>
      <AgentChat chat={chat} />
    </section>
  );
}
