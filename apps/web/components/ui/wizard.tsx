import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "./button";

export function WizardProgress({
  steps,
  currentIndex,
  completedKeys = [],
  stepHref,
}: {
  steps: Array<{ key: string; label: string }>;
  currentIndex: number;
  completedKeys?: readonly string[];
  stepHref?: (key: string) => string;
}) {
  const percent = steps.length <= 1 ? 100 : Math.round((currentIndex / (steps.length - 1)) * 100);
  const completed = new Set(completedKeys);
  return (
    <nav className="wizard-progress" aria-label="Setup steps">
      <div className="wizard-progress-bar" style={{ width: `${percent}%` }} aria-hidden="true" />
      <ol className="wizard-steps">
        {steps.map((step, index) => {
          const current = index === currentIndex;
          const done = !current && completed.has(step.key);
          const href = stepHref?.(step.key);
          const className = current ? "is-current" : done ? "is-done" : "";
          const label = (
            <>
              <span className="wizard-step-index">{index + 1}</span>
              <span className="wizard-step-label">{step.label}</span>
            </>
          );
          return (
            <li key={step.key} className={className}>
              {href ? (
                <Link
                  href={href}
                  className="wizard-step-button"
                  aria-current={current ? "step" : undefined}
                  aria-label={`Go to ${step.label} step`}
                >
                  {label}
                </Link>
              ) : (
                <span className="wizard-step-static">
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
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
