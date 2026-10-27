import { useEffect, useState } from "react";
import { ArrowRight, Bell, X } from "lucide-react";
import "./InAppNotifications.css";

type Note = { id: number; title: string; body: string; taskId?: string };

/** A soft two-note chime, synthesized so the app ships no sound file. */
function chime() {
  try {
    const audio = new AudioContext();
    const start = audio.currentTime;
    [880, 1318.5].forEach((frequency, index) => {
      const at = start + index * 0.14;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = "sine";
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      tone.connect(gain).connect(audio.destination);
      tone.start(at);
      tone.stop(at + 0.6);
    });
    setTimeout(() => void audio.close(), 1200);
  } catch {
    // No audio output: the banner still shows.
  }
}

/**
 * Notifications the OS wouldn't show (they are off for this app), shown in the
 * app instead: a full-width banner with a chime that stays until the founder
 * opens or dismisses it. The newest is shown; dismissing it reveals the next.
 */
export default function InAppNotifications({
  onOpen,
}: {
  onOpen: (taskId: string) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const dismiss = (id: number) =>
    setNotes((current) => current.filter((note) => note.id !== id));
  useEffect(
    () =>
      window.postorca?.onNotification((notification) => {
        setNotes((current) =>
          [
            { id: Date.now() + Math.random(), ...notification },
            ...current,
          ].slice(0, 5),
        );
        chime();
      }),
    [],
  );
  const note = notes[0];
  if (!note) return null;
  const open = () => {
    dismiss(note.id);
    if (note.taskId) onOpen(note.taskId);
  };
  return (
    <div className="in-app-notification" role="alert" key={note.id}>
      <Bell size={17} aria-hidden="true" />
      <p>
        <strong>{note.title}</strong>
        {note.body && <span>{note.body}</span>}
      </p>
      {notes.length > 1 && <small>{notes.length - 1} more</small>}
      {note.taskId && (
        <button
          type="button"
          className="in-app-notification-open"
          onClick={open}
        >
          Open
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="in-app-notification-close"
        aria-label="Dismiss notification"
        onClick={() => dismiss(note.id)}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
