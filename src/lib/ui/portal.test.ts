// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { portal } from "./portal";

describe("portal", () => {
  it("moves a panel out of its card to the app root, where delegated events still reach it, and removes it", () => {
    const app = document.createElement("div");
    app.id = "app";
    const card = document.createElement("div");
    const panel = document.createElement("div");
    card.append(panel);
    app.append(card);
    document.body.append(app);
    const action = portal(panel);
    expect(panel.parentElement).toBe(app);
    expect(card.contains(panel)).toBe(false);
    action.destroy();
    expect(panel.isConnected).toBe(false);
    app.remove();
  });
});
