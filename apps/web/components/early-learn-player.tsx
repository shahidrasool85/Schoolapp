"use client";

import { FormEvent, useState } from "react";
import { Button } from "./ui";
import { api } from "../lib/api";
import { userFacingError } from "../lib/errors";

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

function choiceLabel(item: Item, id: string) {
  const choice = item.choices.find((row) => row.id === id);
  return choice ? `${choice.emoji ? `${choice.emoji} ` : ""}${choice.label}` : id;
}

function initialAnswers(items: Item[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const item of items) {
    if (item.itemType === "ordering") {
      answers[item.id] = { order: [...item.choices.map((row) => row.id)].reverse() };
    } else if (item.itemType === "matching") {
      const lefts = item.choices.filter((_, index) => index % 2 === 0);
      answers[item.id] = { pairs: lefts.map((left) => [left.id, ""]) };
    } else if (item.itemType === "multiple_choice") {
      answers[item.id] = { choiceIds: [] };
    }
  }
  return answers;
}

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
      setAnswers(initialAnswers(props.items));
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

  function moveOrder(item: Item, index: number, direction: -1 | 1) {
    const order = [...((answers[item.id] as { order?: string[] } | undefined)?.order ?? item.choices.map((row) => row.id))];
    const next = index + direction;
    if (next < 0 || next >= order.length) return;
    const swap = order[index]!;
    order[index] = order[next]!;
    order[next] = swap;
    setAnswers((current) => ({ ...current, [item.id]: { order } }));
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
                  value={String(
                    (answers[item.id] as { value?: string; text?: string } | undefined)?.value ??
                      (answers[item.id] as { text?: string } | undefined)?.text ??
                      "",
                  )}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [item.id]:
                        item.itemType === "numeric"
                          ? { value: event.target.value === "" ? "" : event.target.value }
                          : { text: event.target.value },
                    }))
                  }
                  inputMode={item.itemType === "numeric" ? "numeric" : "text"}
                  aria-label={item.promptText}
                />
              ) : item.itemType === "ordering" ? (
                <ol className="early-order">
                  {((answers[item.id] as { order?: string[] } | undefined)?.order ?? item.choices.map((row) => row.id)).map(
                    (choiceId, index) => (
                      <li key={choiceId} className="early-choice">
                        <span>{choiceLabel(item, choiceId)}</span>
                        <span className="page-header-actions">
                          <button type="button" className="secondary" onClick={() => moveOrder(item, index, -1)}>
                            Up
                          </button>
                          <button type="button" className="secondary" onClick={() => moveOrder(item, index, 1)}>
                            Down
                          </button>
                        </span>
                      </li>
                    ),
                  )}
                </ol>
              ) : item.itemType === "matching" ? (
                <div className="stack">
                  {item.choices
                    .filter((_, index) => index % 2 === 0)
                    .map((left, index) => {
                      const pairs = ((answers[item.id] as { pairs?: Array<[string, string]> } | undefined)?.pairs ?? []) as Array<
                        [string, string]
                      >;
                      const selected = pairs[index]?.[1] ?? "";
                      return (
                        <label key={left.id}>
                          {choiceLabel(item, left.id)} matches
                          <select
                            value={selected}
                            onChange={(event) => {
                              const next = item.choices
                                .filter((_, choiceIndex) => choiceIndex % 2 === 0)
                                .map((row, pairIndex) => [
                                  row.id,
                                  pairIndex === index ? event.target.value : (pairs[pairIndex]?.[1] ?? ""),
                                ]);
                              setAnswers((current) => ({ ...current, [item.id]: { pairs: next } }));
                            }}
                            aria-label={`Match for ${left.label}`}
                          >
                            <option value="">Choose</option>
                            {item.choices
                              .filter((_, choiceIndex) => choiceIndex % 2 === 1)
                              .concat(item.choices.filter((_, choiceIndex) => choiceIndex % 2 === 0 && choiceIndex !== index * 2))
                              .filter((row, pos, list) => list.findIndex((entry) => entry.id === row.id) === pos)
                              .map((right) => (
                                <option key={right.id} value={right.id}>
                                  {choiceLabel(item, right.id)}
                                </option>
                              ))}
                          </select>
                        </label>
                      );
                    })}
                </div>
              ) : (
                <div className="early-choices">
                  {item.choices.map((choice) => {
                    const multi = item.itemType === "multiple_choice";
                    const selectedIds = ((answers[item.id] as { choiceIds?: string[] } | undefined)?.choiceIds ?? []) as string[];
                    const checked = multi
                      ? selectedIds.includes(choice.id)
                      : (answers[item.id] as { choiceId?: string } | undefined)?.choiceId === choice.id;
                    return (
                      <label key={choice.id} className="early-choice">
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={item.id}
                          value={choice.id}
                          checked={checked}
                          onChange={() =>
                            setAnswers((current) => {
                              if (!multi) {
                                return { ...current, [item.id]: { choiceId: choice.id } };
                              }
                              const ids = new Set(((current[item.id] as { choiceIds?: string[] } | undefined)?.choiceIds ?? []) as string[]);
                              if (ids.has(choice.id)) ids.delete(choice.id);
                              else ids.add(choice.id);
                              return { ...current, [item.id]: { choiceIds: [...ids] } };
                            })
                          }
                        />
                        <span>
                          {choice.emoji ? `${choice.emoji} ` : ""}
                          {choice.label}
                        </span>
                      </label>
                    );
                  })}
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
