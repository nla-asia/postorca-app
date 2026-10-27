import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChatQuestion } from "../lib/tasks";
import { Button } from "./ui";

/**
 * Answers Orca's multiple-choice question: pick options or write your own. The
 * answer is sent as an ordinary chat message.
 */
export default function QuestionWidget({
  questions,
  active,
  onSubmit,
}: {
  questions: ChatQuestion[];
  /** Only the latest unanswered question accepts an answer. */
  active: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const question = questions[index];
  if (!question) return null;
  const answer = (i: number) =>
    [
      ...(selected[i] ?? []),
      ...(custom[i]?.trim() ? [custom[i].trim()] : []),
    ].join(", ");
  const disabled = !active || submitting;
  return (
    <form
      className="question-widget"
      onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !questions.every((_, i) => answer(i))) return;
        setSubmitting(true);
        try {
          await onSubmit(
            questions
              .map(
                (q, i) => `Q${i + 1}: ${q.question}\nA${i + 1}: ${answer(i)}`,
              )
              .join("\n\n"),
          );
        } finally {
          setSubmitting(false);
        }
      }}
    >
      {questions.length > 1 && (
        <div className="question-navigation">
          <Button
            aria-label="Previous question"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <span>
            {index + 1} of {questions.length}
          </span>
          <Button
            aria-label="Next question"
            disabled={
              index === questions.length - 1 || (active && !answer(index))
            }
            onClick={() => setIndex(index + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
      <fieldset disabled={disabled}>
        <legend>{question.question}</legend>
        {question.multiple && question.options.length > 0 && (
          <p className="question-hint">Select all that apply.</p>
        )}
        <div className="question-options">
          {question.options.map((option) => (
            <label
              key={option}
              className={`question-option ${(selected[index] ?? []).includes(option) ? "selected" : ""}`}
            >
              <input
                type={question.multiple ? "checkbox" : "radio"}
                name={`question-${index}`}
                checked={(selected[index] ?? []).includes(option)}
                onChange={(event) => {
                  setSelected((current) => ({
                    ...current,
                    [index]: question.multiple
                      ? event.target.checked
                        ? [...(current[index] ?? []), option]
                        : (current[index] ?? []).filter(
                            (value) => value !== option,
                          )
                      : [option],
                  }));
                  if (!question.multiple)
                    setCustom((current) => ({ ...current, [index]: "" }));
                }}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
        <label className="question-custom">
          {question.options.length ? "Or add your own answer" : "Your answer"}
          <textarea
            rows={2}
            value={custom[index] ?? ""}
            placeholder="Type your answer…"
            onChange={(event) => {
              setCustom((current) => ({
                ...current,
                [index]: event.target.value,
              }));
              if (!question.multiple)
                setSelected((current) => ({ ...current, [index]: [] }));
            }}
          />
        </label>
      </fieldset>
      {active && (
        <div className="question-footer">
          {index < questions.length - 1 ? (
            <Button disabled={!answer(index)} onClick={() => setIndex(index + 1)}>
              Next <ChevronRight size={15} />
            </Button>
          ) : (
            <Button
              variant="primary"
              type="submit"
              disabled={disabled || !questions.every((_, i) => answer(i))}
            >
              {submitting ? "Sending…" : "Respond"}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
