// Waiting in tests: for a result, never for a fixed time. Kept apart from backend.ts, which the audit
// build bundles and which must not pull in the test runner.
import { vi } from "vitest";

/**
 * How long any wait in a test may take. Reached only by a result that never comes, or on a machine so
 * busy that rendering a view takes seconds; it stays below the test's own limit (vite.config.js), so a
 * failure names the check that waited.
 */
export const WAIT_MS = 8_000;

/**
 * vi.waitFor with the limits of this suite: the check runs every millisecond, so a result that is on
 * its way is taken as soon as it lands. Under fake timers each check moves them on by that millisecond,
 * as vi.waitFor does.
 */
export const waitFor = <T>(check: () => T | Promise<T>): Promise<T> => vi.waitFor(check, { interval: 1, timeout: WAIT_MS });
