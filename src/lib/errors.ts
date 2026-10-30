/** Browser noise that is not an error of the app and must not reach the user. */
const BENIGN = [/ResizeObserver loop/i];

export function isBenign(message: string): boolean {
  return BENIGN.some((r) => r.test(message));
}

/**
 * Last line of defence: anything no handler caught ends up as a readable message instead of a
 * silent failure or an empty window. Returns the uninstall function for tests.
 */
export function installGlobalHandlers(report: (e: unknown) => void, target: Window = window): () => void {
  const onError = (e: ErrorEvent) => {
    const err = e.error ?? e.message;
    if (isBenign(String(e.message ?? ""))) return;
    report(err);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    if (isBenign(String((e.reason as Error)?.message ?? e.reason ?? ""))) return;
    report(e.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
