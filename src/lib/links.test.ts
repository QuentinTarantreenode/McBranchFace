import { describe, expect, it } from "vitest";
import { branchUrl } from "./links";

const github = { home: "", pullRequests: "", branch: "https://github.com/o/r/tree/{branch}" };
const azure = { home: "", pullRequests: "", branch: "https://dev.azure.com/o/p/_git/r?version=GB{branch}" };

describe("branchUrl", () => {
  it("keeps slashes and escapes what would end or split the URL", () => {
    expect(branchUrl(github, "feature/x")).toBe("https://github.com/o/r/tree/feature/x");
    expect(branchUrl(github, "fix#12")).toBe("https://github.com/o/r/tree/fix%2312");
    expect(branchUrl(azure, "a&b?c")).toBe("https://dev.azure.com/o/p/_git/r?version=GBa%26b%3Fc");
    expect(branchUrl(azure, "100%/ü")).toBe("https://dev.azure.com/o/p/_git/r?version=GB100%25/%C3%BC");
  });
});
