import type { ReactNode } from "react";
import { Button } from "./button";

export function WizardProgress({
  steps,
  currentIndex,
}: {
  steps: Array<{ key: string; label: string }>;
  currentIndex: number;
}) {
  const percent = steps.length <= 1 ? 100 : Math.round((currentIndex / (steps.length - 1)) * 100);
  return (
    <div className="wizard-progress" aria-label="Setup progress">
      <div className="wizard-progress-bar" style={{ width: `${percent}%` }} />
      <ol className="wizard-steps">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className={index === currentIndex ? "is-current" : index < currentIndex ? "is-done" : ""}
          >
            <span className="wizard-step-index">{index + 1}</span>
            <span className="wizard-step-label">{step.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function WizardActions({
  onBack,
  onContinue,
  onSaveLater,
  continueLabel = "Continue",
  disableContinue,
}: {
  onBack?: () => void;
  onContinue?: () => void;
  onSaveLater?: () => void;
  continueLabel?: string;
  disableContinue?: boolean;
}) {
  return (
    <div className="wizard-actions">
      {onBack ? (
        <Button type="button" variant="secondary" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <div className="wizard-actions-end">
        {onSaveLater ? (
          <Button type="button" variant="ghost" onClick={onSaveLater}>
            Save and continue later
          </Button>
        ) : null}
        {onContinue ? (
          <Button type="button" onClick={onContinue} disabled={disableContinue}>
            {continueLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function WizardPanel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="wizard-panel">
      <header>
        <h2>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
