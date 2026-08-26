export function captureSubmitTarget<T>(event: { currentTarget: T }): T {
  return event.currentTarget;
}

export function resetFormSafely(form: { reset: () => void } | null | undefined): void {
  form?.reset();
}
