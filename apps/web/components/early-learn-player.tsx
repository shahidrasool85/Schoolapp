"use client";

import { FormEvent, useState } from "react";
import { Button } from "../../components/ui";
import { api } from "../../lib/api";
import { userFacingError } from "../../lib/errors";

type Item = {
  id: string;
  promptText: string;
  promptEmoji?: string | null;
  itemType: string;
  choices: Array<{ id: string; label: string; emoji?: string | null }>;
  hint?: string | null;
};

type Result = {
  score: number;
  maxScore: number;
  completed: boolean;
  xpAwarded: number;
  results: Array<{ itemId: string; correct: boolean; explanation?: string | null }>;
};

export function EarlyLearnPlayer(props: {
  title: string;
  instructions?: string | null;
  items: Item[];
  childFriendly?: boolean;
  startPath: string;
  submitPath: (attemptId: string) => string;
}) {
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const body = await api<{ attemptId: string }>(props.startPath, { method: "POST", body: "{}" });
      setAttemptId(body.attemptId);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not start this activity."));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!attemptId) return;
    setBusy(true);
    setError("");
    try {
      const body = await api<Result>(props.submitPath(attemptId), {
        method: "POST",
        body: JSON.stringify({ answers }),
      });
      setResult(body);
    } catch (err) {
      setError(userFacingError(err as Error, "Could not submit answers."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={props.childFriendly ? "early-learn" : undefined}>
      <p className="muted">{props.instructions}</p>
      {error ? <p className="alert danger">{error}</p> : null}
      {result ? (
        <div className="section-card">
          <h2>Well done</h2>
          <p>
            Score {result.score} / {result.maxScore}
            {result.xpAwarded ? ` · ${result.xpAwarded} XP` : ""}
          </p>
          <ul className="queue-list">
            {result.results.map((row) => (
              <li key={row.itemId}>
                <strong>{row.correct ? "Correct" : "Have another look next time"}</strong>
                {row.explanation ? <span className="muted">{row.explanation}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : !attemptId ? (
        <Button type="button" onClick={() => void start()} disabled={busy}>
          Start
        </Button>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="stack">
          {props.items.map((item) => (
            <fieldset key={item.id} className="early-item">
              <legend>
                {item.promptEmoji ? <span className="early-emoji">{item.promptEmoji}</span> : null}
                {item.promptText}
              </legend>
              {item.itemType === "numeric" || item.itemType === "short_exact_text" ? (
                <input
                  className="early-input"
                  value={String((answers[item.id] as { value?: string; text?: string } | undefined)?.value ?? (answers[item.id] as { text?: string } | undefined)?.text ?? "")}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [item.id]:
                        item.itemType === "numeric"
                          ? { value: Number(event.target.value) }
                          : { text: event.target.value },
                    }))
                  }
                  inputMode={item.itemType === "numeric" ? "numeric" : "text"}
                  aria-label={item.promptText}
                />
              ) : (
                <div className="early-choices">
                  {item.choices.map((choice) => (
                    <label key={choice.id} className="early-choice">
                      <input
                        type={item.itemType === "multiple_choice" ? "checkbox" : "radio"}
                        name={item.id}
                        value={choice.id}
                        onChange={() =>
                          setAnswers((current) => ({
                            ...current,
                            [item.id]:
                              item.itemType === "ordering"
                                ? { order: [...item.choices.map((row) => row.id)] }
                                : item.itemType === "matching"
                                  ? { pairs: item.choices.length > 1 ? [[item.choices[0]!.id, item.choices[1]!.id]] : [] }
                                  : { choiceId: choice.id },
                          }))
                        }
                      />
                      <span>
                        {choice.emoji ? `${choice.emoji} ` : ""}
                        {choice.label}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {item.hint ? <p className="muted">{item.hint}</p> : null}
            </fieldset>
          ))}
          <Button type="submit" disabled={busy}>
            Check answers
          </Button>
        </form>
      )}
    </div>
  );
}
