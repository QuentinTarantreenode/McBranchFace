import { describe, expect, it, vi } from "vitest";
import { installGlobalHandlers, isBenign } from "./errors";

describe("global error handlers", () => {
  it("report uncaught errors and rejections, skip browser noise", () => {
    const target = new EventTarget() as unknown as Window;
    const report = vi.fn();
    const off = installGlobalHandlers(report, target);
    const boom = new Error("boom");
    target.dispatchEvent(Object.assign(new Event("error"), { error: boom, message: "boom" }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));
    target.dispatchEvent(Object.assign(new Event("error"), { error: null, message: "ResizeObserver loop completed with undelivered notifications." }));
    expect(report.mock.calls).toEqual([[boom], ["nope"]]);
    off();
    target.dispatchEvent(Object.assign(new Event("error"), { error: boom, message: "boom" }));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("knows benign messages", () => {
    expect(isBenign("ResizeObserver loop limit exceeded")).toBe(true);
    expect(isBenign("TypeError: x is undefined")).toBe(false);
  });
});
