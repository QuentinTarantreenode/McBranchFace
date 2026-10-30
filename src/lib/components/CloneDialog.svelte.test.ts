// @vitest-environment jsdom
// Cloning a repository into a folder: the suggested name and target, the run, a failure, the repo
// showing up in the list.
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { dialogs } from "$lib/stores/dialogs.svelte";
import { backend, start } from "../../test/views";
import { waitFor } from "../../test/wait";
import CloneDialog from "./CloneDialog.svelte";

vi.mock("@lucide/svelte", async () => (await import("../../test/icons")).iconModule());

const field = (name: RegExp) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const cloneButton = () => screen.getByRole("button", { name: "Clone" }) as HTMLButtonElement;

it("suggests the folder name from the address and clones into a listed folder, which is scanned", async () => {
  await start({ git_clone: () => ({ sha: "abc", backupDir: null, stashed: false, warning: null, summary: null }) });
  dialogs.cloneOpen = { parent: null };
  render(CloneDialog);
  expect(field(/Clone into folder/).value).toBe("C:/ws");
  expect(cloneButton().disabled).toBe(true);
  await fireEvent.input(field(/Repository address/), { target: { value: "https://example.com/acme/widgets.git" } });
  expect(field(/Folder name/).value).toBe("widgets");
  expect(cloneButton().disabled).toBe(false);
  const scans = backend.called("scan").length;
  await fireEvent.click(cloneButton());
  await waitFor(() => expect(screen.getByText("widgets cloned")).toBeTruthy());
  const call = backend.called("git_clone")[0];
  expect(call.url).toBe("https://example.com/acme/widgets.git");
  expect(call.target).toBe("C:/ws/widgets");
  await waitFor(() => expect(backend.called("scan")).toHaveLength(scans + 1));
  expect(backend.called("save_config")).toHaveLength(0);
  await fireEvent.click(screen.getAllByRole("button", { name: "Close" }).at(-1)!);
  expect(dialogs.cloneOpen).toBeNull();
});

it("keeps what was typed and says why when the clone fails", async () => {
  await start({ git_clone: () => Promise.reject({ kind: "AlreadyExists", op: "Clone", detail: "C:/ws/widgets exists", path: "C:/ws/widgets", changed: false }) });
  dialogs.cloneOpen = { parent: "C:/ws" };
  render(CloneDialog);
  await fireEvent.input(field(/Repository address/), { target: { value: "git@example.com:acme/widgets.git" } });
  await fireEvent.input(field(/Folder name/), { target: { value: "mine" } });
  const scans = backend.called("scan").length;
  await fireEvent.click(cloneButton());
  expect((await screen.findByRole("alert")).textContent).toContain("C:/ws/widgets exists");
  expect(field(/Repository address/).value).toBe("git@example.com:acme/widgets.git");
  expect(field(/Folder name/).value).toBe("mine");
  expect(backend.called("git_clone")[0].target).toBe("C:/ws/mine");
  expect(backend.called("scan")).toHaveLength(scans);
});

it("refuses a folder name no folder can have", async () => {
  await start({});
  dialogs.cloneOpen = { parent: "C:/ws" };
  render(CloneDialog);
  await fireEvent.input(field(/Repository address/), { target: { value: "https://example.com/acme/widgets.git" } });
  await fireEvent.input(field(/Folder name/), { target: { value: "a:b" } });
  expect(screen.getByText("This cannot be the name of a folder.")).toBeTruthy();
  expect(cloneButton().disabled).toBe(true);
});

it("adds a clone outside the listed folders as a folder of its own", async () => {
  await start({ git_clone: () => ({ sha: "abc", backupDir: null, stashed: false, warning: null, summary: null }), folder_kinds: (a) => (a.paths as string[]).map(() => true) });
  dialogs.cloneOpen = { parent: "D:/elsewhere" };
  render(CloneDialog);
  await fireEvent.input(field(/Repository address/), { target: { value: "https://example.com/acme/widgets.git" } });
  await fireEvent.click(cloneButton());
  await waitFor(() => expect(screen.getByText("widgets cloned")).toBeTruthy());
  await waitFor(() => expect(backend.called("save_config")).toHaveLength(1));
  expect((backend.called("save_config")[0].config as { roots: string[] }).roots).toEqual(["C:/ws", "D:/elsewhere/widgets"]);
});
