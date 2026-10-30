import { describe, expect, it } from "vitest";
import { emptySelection, nextSelection, type SelectAction, type Selection } from "./selection";

const order = ["a", "b", "c", "d", "e"];
const run = (actions: SelectAction[], from: Selection = emptySelection) => actions.reduce((s, a) => nextSelection(s, a, order), from);

describe("nextSelection", () => {
  it("a click selects one, a second click on it selects none again", () => {
    expect(run([{ kind: "click", id: "b" }]).items).toEqual(["b"]);
    expect(run([{ kind: "click", id: "b" }, { kind: "click", id: "b" }])).toEqual(emptySelection);
  });

  it("Ctrl toggles, Shift spans from the anchor, Ctrl+Shift adds a span", () => {
    const s = run([{ kind: "click", id: "b" }, { kind: "click", id: "d", shift: true }]);
    expect(s.items).toEqual(["b", "c", "d"]);
    expect(s.focus).toBe("d");
    const t = run([{ kind: "click", id: "c", ctrl: true }], s);
    expect(t.items).toEqual(["b", "d"]);
    const u = run([{ kind: "click", id: "a", ctrl: true }, { kind: "click", id: "e", ctrl: true, shift: true }], t);
    expect(u.items.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("a group head selects its members, Ctrl adds or takes them out", () => {
    const s = run([{ kind: "click", id: "a" }, { kind: "group", ids: ["c", "d"], ctrl: true }]);
    expect(s.items).toEqual(["a", "c", "d"]);
    expect(run([{ kind: "group", ids: ["c", "d"], ctrl: true }], s).items).toEqual(["a"]);
    expect(run([{ kind: "group", ids: ["c", "d"] }]).items).toEqual(["c", "d"]);
    expect(run([{ kind: "group", ids: ["c", "d"] }, { kind: "group", ids: ["c", "d"] }])).toEqual(emptySelection);
  });

  it("arrows move one, Shift+arrows grow the range, and stop at the ends", () => {
    const s = run([{ kind: "move", delta: 1 }, { kind: "move", delta: 1 }]);
    expect(s.items).toEqual(["b"]);
    const t = run([{ kind: "move", delta: 1, shift: true }, { kind: "move", delta: 1, shift: true }], s);
    expect(t.items).toEqual(["b", "c", "d"]);
    expect(run([{ kind: "move", delta: -9 }], t).items).toEqual(["a"]);
  });

  it("a known set selects only it, adds it or takes it out", () => {
    const s = run([{ kind: "click", id: "a" }, { kind: "set", ids: ["c", "d"], mode: "add" }]);
    expect(s.items).toEqual(["a", "c", "d"]);
    expect(run([{ kind: "set", ids: ["a", "c"], mode: "remove" }], s).items).toEqual(["d"]);
    expect(run([{ kind: "set", ids: ["e"], mode: "only" }], s).items).toEqual(["e"]);
    expect(run([{ kind: "set", ids: ["a", "c", "d"], mode: "remove" }], s)).toEqual(emptySelection);
  });

  it("all takes what is shown, none clears", () => {
    expect(run([{ kind: "all" }]).items).toEqual(order);
    expect(run([{ kind: "all" }, { kind: "none" }])).toEqual(emptySelection);
  });

  it("a row no longer shown selects alone instead of spanning", () => {
    const s = nextSelection({ items: ["x"], anchor: "x", focus: "x" }, { kind: "click", id: "c", shift: true }, order);
    expect(s.items).toEqual(["c"]);
  });
});

describe("group head with Shift", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("spans from the anchor over every member", () => {
    const s = { items: ["a"], anchor: "a", focus: "a" };
    expect(nextSelection(s, { kind: "group", ids: ["c", "d"], shift: true }, order).items).toEqual(["a", "b", "c", "d"]);
  });
  it("keeps the rest with Ctrl and takes folded members along", () => {
    const s = { items: ["e"], anchor: "b", focus: "e" };
    expect(nextSelection(s, { kind: "group", ids: ["c", "x"], shift: true, ctrl: true }, order).items).toEqual(["e", "b", "c", "x"]);
  });
});
