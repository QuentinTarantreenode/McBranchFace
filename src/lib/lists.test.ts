import { describe, expect, it } from "vitest";
import { toggled } from "./lists";

describe("toggled", () => {
  it("takes a value out when it is in, and adds it at the end when it is not", () => {
    expect(toggled(["a", "b"], "a")).toEqual(["b"]);
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
  });
});
