// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { flushSync, tick } from "svelte";
import { i18n } from "$lib/i18n/index.svelte";
import Checkbox from "./Checkbox.svelte";
import ContextMenu from "./ContextMenu.svelte";
import Radio from "./Radio.svelte";
import Segmented from "./Segmented.svelte";
import ViewTabs from "./ViewTabs.svelte";
import { Square } from "@lucide/svelte";
import TagPill from "./TagPill.svelte";
import BranchName from "./BranchName.svelte";
import { delayed } from "./delay.svelte";
import { contextmenu, isItem, menu, openBelow, type MenuEntry } from "./menu.svelte";
import { fullText, setTooltipHome, tooltip } from "./tooltip";
import { doubleClick } from "./gestures";
import { dismissAll } from "./dismiss";
import { waitFor } from "../../test/wait";

beforeAll(() => {
  i18n.set("En");
});
afterEach(() => {
  menu.current = null;
  vi.useRealTimers();
  document.querySelector("[role=tooltip]")?.removeAttribute("data-open");
});

describe("Modal", () => {
  it("is anchored at the top, moves by its head, resizes from the corner and resets on double click", async () => {
    const onsize = vi.fn();
    const { container } = render((await import("../../test/ModalHarness.svelte")).default, { savedSize: { width: 700, height: 500 }, onsize });
    await tick();
    const dialog = container.ownerDocument.querySelector("dialog")!;
    // Anchored at the top: growing content never moves the head.
    expect(dialog.style.marginTop).toBe("6vh");
    expect(dialog.style.width).toBe("700px");
    expect(dialog.style.height).toBe("500px");
    const head = screen.getByRole("heading", { name: "Settings" }).closest("header")!;
    await fireEvent.pointerDown(head, { clientX: 100, clientY: 100, button: 0 });
    await fireEvent.pointerMove(head, { clientX: 140, clientY: 130 });
    await fireEvent.pointerUp(head, { clientX: 140, clientY: 130 });
    expect(dialog.style.translate).toBe("40px 30px");
    const grip = screen.getByRole("separator", { name: "Resize" });
    await fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, button: 0 });
    await fireEvent.pointerMove(grip, { clientX: 60, clientY: 40 });
    await fireEvent.pointerUp(grip, { clientX: 60, clientY: 40 });
    expect(onsize).toHaveBeenLastCalledWith({ width: 760, height: 540 });
    await fireEvent.dblClick(head);
    expect(dialog.style.translate).toBe("0px 0px");
    expect(onsize).toHaveBeenLastCalledWith(null);
  });
});

describe("Checkbox", () => {
  it("toggles by click and reports the new state", async () => {
    const onchange = vi.fn();
    render(Checkbox, { label: "Mine only", description: "Hides others", onchange });
    const box = screen.getByRole("checkbox");
    await fireEvent.click(box);
    expect(onchange).toHaveBeenCalledWith(true);
    // Box and label share a two-column grid; the description sits in the label column.
    expect(box.closest("label")?.className).toContain("grid-cols-[16px_minmax(0,1fr)]");
    expect(screen.getByText("Hides others").className).toContain("col-start-2");
  });

  it("shows indeterminate and disabled states", () => {
    render(Checkbox, { indeterminate: true, disabled: true, ariaLabel: "all" });
    const box = screen.getByRole("checkbox", { name: "all" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.disabled).toBe(true);
    expect(box.closest("label")?.className).toContain("grid-cols-[16px]");
  });
});

describe("Radio", () => {
  it("selects its value", async () => {
    render(Radio, { group: "a", value: "b", label: "Option B", name: "g" });
    const r = screen.getByRole("radio") as HTMLInputElement;
    expect(r.checked).toBe(false);
    await fireEvent.change(r);
    expect(r.closest("label")?.querySelector(".bg-accent")).not.toBeNull();
  });
});

describe("Segmented", () => {
  it("switches by click and with the arrow keys, wrapping around", async () => {
    const onchange = vi.fn();
    const options = [
      { id: "a", label: "A", count: 2 },
      { id: "b", label: "B" },
    ];
    render(Segmented, { options, value: "a", onchange, label: "Scope" });
    await fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(onchange).toHaveBeenLastCalledWith("b");
    const list = screen.getByRole("tablist");
    await fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(onchange).toHaveBeenLastCalledWith("b");
    await fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(onchange).toHaveBeenLastCalledWith("b");
    onchange.mockClear();
    await fireEvent.keyDown(list, { key: "Enter" });
    expect(onchange).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /A/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("BranchName", () => {
  it("shows remote, prefix and rest as segments, reads and copies as the real name", async () => {
    const { container } = render(BranchName, { name: "feature/ui/checklist", remote: "origin" });
    expect([...container.querySelectorAll(".mbf-seg")].map((s) => s.textContent?.trim())).toEqual(["origin", "feature", "ui/checklist"]);
    expect(container.querySelector(".mbf-segs")?.getAttribute("aria-label")).toBe("origin/feature/ui/checklist");
    const data = new Map<string, string>();
    const e = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(e, "clipboardData", { value: { setData: (k: string, v: string) => data.set(k, v) } });
    container.querySelector("span")!.dispatchEvent(e);
    expect(data.get("text/plain")).toBe("origin/feature/ui/checklist");
    expect(e.defaultPrevented).toBe(true);
  });

  it("offers to copy the name on right click, with and without its remote", async () => {
    const { container } = render(BranchName, { name: "feature/x", remote: "origin" });
    await fireEvent.contextMenu(container.querySelector(".mbf-segs")!, { clientX: 10, clientY: 10 });
    const items = menu.current!.entries.filter(isItem);
    expect(items.map((i) => i.label)).toEqual(["Copy branch name", "Copy origin/feature/x"]);
    expect(menu.current!.modal).toBe(false);
  });

  it("leaves the right click to a row with a menu of its own, but not inside a popover of that row", async () => {
    const row = document.createElement("div");
    const rowMenu = contextmenu(row, () => [{ label: "Row", run: () => {} }]);
    document.body.append(row);
    render(BranchName, { target: row, props: { name: "feature/x" } });
    await fireEvent.contextMenu(row.querySelector(".mbf-segs")!);
    expect(menu.current!.entries.filter(isItem).map((i) => i.label)).toEqual(["Row"]);

    const picker = document.createElement("div");
    picker.dataset.menuScope = "";
    row.append(picker);
    render(BranchName, { target: picker, props: { name: "feature/y" } });
    await fireEvent.contextMenu(picker.querySelector(".mbf-segs")!);
    expect(menu.current!.entries.filter(isItem).map((i) => i.label)).toEqual(["Copy branch name"]);
    rowMenu.destroy();
    row.remove();
  });

  it("lifts a menu over a modal dialog into the top layer", async () => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    render(BranchName, { target: dialog, props: { name: "feature/x" } });
    await fireEvent.contextMenu(dialog.querySelector(".mbf-segs")!);
    expect(menu.current!.modal).toBe(true);
    dialog.remove();
  });

  it("shows a name without prefix as it is, on one line even in headers", () => {
    // Wrapped, the segments before the rest grew as tall as it: headers truncate too, the tip has it all.
    const { container } = render(BranchName, { name: "main", size: "lg" });
    expect(container.textContent!.trim()).toBe("main");
    expect(container.querySelector(".truncate")).not.toBeNull();
    expect(container.querySelector("wbr")).toBeNull();
  });
});

describe("TagPill", () => {
  it("offers removal only when asked", async () => {
    const onremove = vi.fn();
    render(TagPill, { tag: "release", onremove, removeLabel: "Remove release" });
    await fireEvent.click(screen.getByRole("button", { name: "Remove release" }));
    expect(onremove).toHaveBeenCalled();
  });
});

describe("menu", () => {
  const entries = (run = vi.fn()): MenuEntry[] => [
    { heading: "feature/x" },
    "sep",
    { label: "Delete", run, keys: "Del", danger: true },
    { label: "Locked", run, disabled: "Locked branch" },
    "sep",
    "sep",
    { label: "Copy", run, count: 2, hint: "name" },
    "sep",
  ];

  it("drops leading, trailing and doubled separators and ignores menus without items", () => {
    menu.show({ x: 1, y: 2, entries: entries() });
    expect(menu.current?.entries.filter((e) => e === "sep")).toHaveLength(2);
    menu.close();
    menu.show({ x: 1, y: 2, entries: [{ heading: "only" }] });
    expect(menu.current).toBeNull();
    expect(isItem("sep")).toBe(false);
  });

  it("opens on right click and Shift+F10, and below a button", () => {
    const node = document.createElement("div");
    document.body.appendChild(node);
    const action = contextmenu(node, () => entries());
    node.dispatchEvent(new MouseEvent("contextmenu", { clientX: 5, clientY: 6, bubbles: true, cancelable: true }));
    expect(menu.current?.x).toBe(5);
    menu.close(false);
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true }));
    expect(menu.current).not.toBeNull();
    action.update(() => [{ label: "Other", run: () => {} }]);
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu" }));
    expect(menu.current?.entries).toHaveLength(1);
    node.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    action.destroy();
    openBelow(node, entries(), "Report");
    expect(menu.current?.anchor).toBeDefined();
  });

  it("opens nothing on what is still loading", () => {
    const row = document.createElement("div");
    row.setAttribute("aria-busy", "true");
    document.body.appendChild(row);
    const action = contextmenu(row, () => entries());
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    row.dispatchEvent(e);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu" }));
    expect(menu.current).toBeNull();
    // Nor the WebView's own menu in its place.
    expect(e.defaultPrevented).toBe(true);
    row.setAttribute("aria-busy", "false");
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(menu.current).not.toBeNull();
    menu.close(false);
    action.destroy();
    row.remove();
  });

  it("a second press on its button closes a dropdown instead of reopening it; a press elsewhere still closes", async () => {
    render(ContextMenu);
    const button = document.createElement("button");
    const other = document.createElement("div");
    document.body.append(button, other);
    button.addEventListener("click", () => openBelow(button, entries()));
    // As a real press: pointerdown reaches the window first, then the click the button.
    const press = async (el: HTMLElement) => {
      await fireEvent.pointerDown(el);
      await fireEvent.click(el);
    };
    await press(button);
    expect(menu.current?.trigger).toBe(button);
    await press(button);
    expect(menu.current).toBeNull();
    await press(button);
    await fireEvent.pointerDown(other);
    expect(menu.current).toBeNull();
    button.remove();
    other.remove();
  });

  it("closes on a press on the window title bar, which the page itself never sees", async () => {
    render(ContextMenu);
    menu.show({ x: 10, y: 10, entries: entries() });
    await tick();
    expect(menu.current).not.toBeNull();
    dismissAll();
    expect(menu.current).toBeNull();
  });

  it("closes on a press beside it even where the element stops the event, and when a list scrolls under it", async () => {
    render(ContextMenu);
    // A resize handle stops its pointerdown so no parent starts a drag; the menu must close anyway.
    const handle = document.createElement("div");
    handle.addEventListener("pointerdown", (e) => e.stopPropagation());
    const list = document.createElement("div");
    document.body.append(handle, list);
    menu.show({ x: 10, y: 10, entries: entries() });
    await tick();
    await fireEvent.pointerDown(handle);
    expect(menu.current).toBeNull();
    // Scrolling another list leaves it; scrolling the list it was opened on closes it.
    const row = document.createElement("div");
    list.append(row);
    menu.show({ x: 10, y: 10, entries: entries(), source: row });
    await tick();
    await fireEvent.scroll(handle);
    expect(menu.current).not.toBeNull();
    await fireEvent.scroll(list);
    expect(menu.current).toBeNull();
    handle.remove();
    list.remove();
  });

  it("runs items by keyboard, skips disabled ones, closes on Escape", async () => {
    const run = vi.fn();
    render(ContextMenu);
    menu.show({ x: 10, y: 10, entries: entries(run) });
    await tick();
    const el = screen.getByRole("menu");
    await fireEvent.keyDown(el, { key: "ArrowDown" });
    await fireEvent.keyDown(el, { key: "ArrowUp" });
    await fireEvent.keyDown(el, { key: "End" });
    await fireEvent.keyDown(el, { key: "Home" });
    await fireEvent.keyDown(el, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(menu.current).toBeNull();
    menu.show({ x: 10, y: 10, entries: entries(run) });
    await tick();
    await fireEvent.click(screen.getByText("Locked"));
    expect(run).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "x" });
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(menu.current).toBeNull();
  });

  it("opens a submenu in place and keeps multiple choice open", async () => {
    const pick = vi.fn();
    const toggle = vi.fn();
    render(ContextMenu);
    menu.show({
      x: 10,
      y: 10,
      entries: [
        { label: "Ignore", run: () => {}, submenu: [{ label: "30 days", run: pick }] },
        { label: "QA", checked: false, keepOpen: true, run: toggle },
      ],
    });
    await tick();
    await fireEvent.click(screen.getByText("QA"));
    expect(toggle).toHaveBeenCalled();
    expect(screen.getByRole("menuitemcheckbox").getAttribute("aria-checked")).toBe("true");
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowRight" });
    await tick();
    expect(screen.getByText("30 days")).toBeTruthy();
    await fireEvent.click(screen.getByText("30 days"));
    expect(pick).toHaveBeenCalled();
  });

  it("opens a submenu on hover beside its parent, which stays; left arrow and Escape step back", async () => {
    const pick = vi.fn();
    render(ContextMenu);
    menu.show({
      x: 10,
      y: 10,
      entries: [
        { label: "Ignore", run: () => {}, submenu: [{ label: "30 days", run: pick }] },
        { label: "Lock", run: () => {} },
      ],
    });
    await tick();
    await fireEvent.pointerEnter(screen.getByText("Ignore").closest("button")!);
    await waitFor(() => expect(screen.getByText("30 days")).toBeTruthy());
    // Both levels are shown at once: the parent is not replaced.
    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(screen.getByText("Lock")).toBeTruthy();
    await fireEvent.keyDown(screen.getAllByRole("menu")[1], { key: "ArrowLeft" });
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowRight" });
    await tick();
    await fireEvent.keyDown(screen.getAllByRole("menu")[1], { key: "Escape" });
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(menu.current).not.toBeNull();
    // Moving on to a plain item closes the submenu after a short grace period.
    await fireEvent.pointerEnter(screen.getByText("Ignore").closest("button")!);
    await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
    await fireEvent.pointerEnter(screen.getByText("Lock").closest("button")!);
    await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(1));
    menu.close(false);
  });

  it("Escape after a submenu opened on hover closes only the submenu; a second Escape closes the menu", async () => {
    render(ContextMenu);
    menu.show({
      x: 10,
      y: 10,
      entries: [
        { label: "Ignore", run: () => {}, submenu: [{ label: "30 days", run: () => {} }] },
        { label: "Lock", run: () => {} },
      ],
    });
    await tick();
    await fireEvent.pointerEnter(screen.getByText("Ignore").closest("button")!);
    await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
    // A key goes where the focus is: hovering leaves it on the parent menu.
    const parent = screen.getAllByRole("menu")[0];
    expect(document.activeElement).toBe(parent);
    await fireEvent.keyDown(parent, { key: "Escape" });
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByText("Lock")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    await fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(menu.current).toBeNull();
  });

  it("Escape with the focus outside both menus also closes the submenu first", async () => {
    render(ContextMenu);
    menu.show({ x: 10, y: 10, entries: [{ label: "Ignore", run: () => {}, submenu: [{ label: "30 days", run: () => {} }] }] });
    await tick();
    await fireEvent.pointerEnter(screen.getByText("Ignore").closest("button")!);
    await waitFor(() => expect(screen.getAllByRole("menu")).toHaveLength(2));
    (document.activeElement as HTMLElement | null)?.blur();
    await fireEvent.keyDown(document.body, { key: "Escape" });
    await tick();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    // The parent has the focus back, so the next key goes there.
    expect(document.activeElement).toBe(screen.getByRole("menu"));
    await fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(menu.current).toBeNull();
  });

  it("shows tiles first and groups with labels, tiles run by click and arrow keys", async () => {
    const open = vi.fn();
    const copy = vi.fn();
    render(ContextMenu);
    menu.show({
      x: 10,
      y: 10,
      entries: [
        { tiles: [{ label: "Folder", run: open }, { label: "Copy", run: copy }] },
        { group: "Branch" },
        { label: "Lock", run: () => {} },
      ],
    });
    await tick();
    expect(screen.getByText("Branch")).toBeTruthy();
    await fireEvent.click(screen.getByRole("menuitem", { name: "Folder" }));
    expect(open).toHaveBeenCalled();
    menu.show({ x: 10, y: 10, entries: [{ tiles: [{ label: "Folder", run: open }, { label: "Copy", run: copy }] }, { label: "Lock", run: () => {} }] });
    await tick();
    const el = screen.getByRole("menu");
    await fireEvent.keyDown(el, { key: "ArrowRight" });
    await fireEvent.keyDown(el, { key: "Enter" });
    expect(copy).toHaveBeenCalled();
  });

  it("closes when the pointer goes down outside", async () => {
    render(ContextMenu);
    menu.show({ x: 0, y: 0, entries: entries() });
    await tick();
    await fireEvent.pointerDown(document.body);
    expect(menu.current).toBeNull();
  });
});

describe("tooltip", () => {
  const hover = (node: HTMLElement) => node.dispatchEvent(new PointerEvent("pointerenter", { clientX: 10, clientY: 10, pointerType: "mouse" }));
  const tip = () => document.querySelector("[role=tooltip]") as HTMLElement;

  it("names a gesture only while the element or an ancestor has it, and only where the tip asks", () => {
    vi.useFakeTimers();
    const row = document.createElement("div");
    const cell = document.createElement("span");
    const other = document.createElement("span");
    row.append(cell);
    document.body.append(row, other);
    const open = vi.fn();
    const dbl = doubleClick(cell, { run: open, hint: "A double click opens it." });
    const menuOff = contextmenu(row, () => [{ label: "x", run: () => {} }]);
    const tc = tooltip(cell, { text: "cell", foot: "Dragging moves it.", gestures: true });
    const to = tooltip(other, { text: "other", gestures: true });
    vi.advanceTimersByTime(1000);
    hover(cell);
    vi.advanceTimersByTime(400);
    // Own gesture first, then the ancestor's context menu, after the tip's own foot.
    expect(tip().querySelector(".mbf-tooltip-foot")?.textContent).toBe("Dragging moves it.\nA double click opens it.\nA right click opens more actions.");
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(open).toHaveBeenCalledOnce();
    // No gesture, no promise.
    hover(other);
    vi.advanceTimersByTime(400);
    expect(tip().querySelector(".mbf-tooltip-foot")).toBeNull();
    // Gone with the gesture.
    dbl.destroy();
    menuOff.destroy();
    hover(cell);
    vi.advanceTimersByTime(400);
    expect(tip().querySelector(".mbf-tooltip-foot")?.textContent).toBe("Dragging moves it.");
    // Hidden and cooled down, so the next test starts cold.
    cell.dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(1000);
    for (const x of [tc, to]) x.destroy();
    row.remove();
    other.remove();
  });

  it("shows at once on hover, every time, with every part rendered", () => {
    vi.useFakeTimers();
    const a = document.createElement("button");
    const b = document.createElement("button");
    document.body.append(a, b);
    const ta = tooltip(a, {
      title: "Repo",
      keys: "F1",
      text: "body",
      rows: [["k", "v"]],
      pills: [{ text: "qa", color: "red" }],
      sections: [{ title: "State", rows: [["x", "y"]], mono: true }, { title: "empty" }, { text: "note" }],
      foot: "C:/path",
      wide: true,
    });
    const tb = tooltip(b, "plain");
    vi.advanceTimersByTime(1000);
    hover(a);
    expect(tip().hasAttribute("data-open")).toBe(true);
    expect(tip().hasAttribute("data-wide")).toBe(true);
    expect(tip().querySelectorAll(".mbf-tooltip-section")).toHaveLength(2);
    expect(tip().querySelector(".mbf-tooltip-foot")?.textContent).toBe("C:/path");
    a.dispatchEvent(new PointerEvent("pointermove", { clientX: 12, clientY: 12 }));
    a.dispatchEvent(new PointerEvent("pointerleave"));
    hover(b);
    expect(tip().textContent).toBe("plain");
    b.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(tip().hasAttribute("data-open")).toBe(false);
    ta.destroy();
    tb.destroy();
  });

  it("a lazy tip is built only when it shows, and every time from the current state", () => {
    vi.useFakeTimers();
    const a = document.createElement("button");
    document.body.append(a);
    let value = "first";
    let built = 0;
    const t = tooltip(a, () => (built++, { title: value }));
    expect(built).toBe(0);
    expect(a.dataset.tip).toBe("");
    vi.advanceTimersByTime(1000);
    hover(a);
    vi.advanceTimersByTime(400);
    expect(built).toBe(1);
    expect(tip().textContent).toContain("first");
    a.dispatchEvent(new PointerEvent("pointerleave"));
    value = "second";
    vi.advanceTimersByTime(1000);
    hover(a);
    vi.advanceTimersByTime(400);
    expect(tip().textContent).toContain("second");
    t.destroy();
  });

  it("a tip whose builder loads shows once it is there, and not after the pointer left", async () => {
    vi.useFakeTimers();
    const a = document.createElement("button");
    document.body.append(a);
    let release: (v: { title: string }) => void = () => {};
    const t = tooltip(a, () => new Promise((r) => (release = r)));
    const settle = async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    };
    vi.advanceTimersByTime(1000);
    hover(a);
    vi.advanceTimersByTime(400);
    a.dispatchEvent(new PointerEvent("pointerleave"));
    release({ title: "too late" });
    await settle();
    expect(document.body.textContent).not.toContain("too late");
    vi.advanceTimersByTime(1000);
    hover(a);
    vi.advanceTimersByTime(400);
    release({ title: "loaded" });
    await settle();
    expect(tip().textContent).toContain("loaded");
    t.destroy();
  });

  it("a tip of pills only still shows (the tags beyond the first ones)", () => {
    vi.useFakeTimers();
    const a = document.createElement("span");
    document.body.append(a);
    const t = tooltip(a, { pills: [{ text: "qa", color: "red" }] });
    expect(a.dataset.tip).toBe("");
    vi.advanceTimersByTime(1000);
    hover(a);
    vi.advanceTimersByTime(400);
    expect(tip().textContent).toContain("qa");
    t.destroy();
  });

  it("renders a head, cards with typed rows and bars, and paths that break only after separators", () => {
    vi.useFakeTimers();
    setTooltipHome("C:\\Users\\me");
    const a = document.createElement("span");
    document.body.append(a);
    const t = tooltip(a, {
      title: "repo",
      path: "C:/Users/me/src\\repo",
      sections: [
        { title: "Copies", note: "C:\\dev", noteKind: "path", rows: [{ value: "a\\b", kind: "path", pill: { text: "main", color: "red" }, current: "this one" }] },
        { title: "Prefixes", bars: [{ label: "feature", count: 4, color: "blue" }, { label: "fix", count: 1, color: "red" }] },
      ],
    });
    vi.advanceTimersByTime(1000);
    hover(a);
    vi.advanceTimersByTime(400);
    expect(tip().hasAttribute("data-rich")).toBe(true);
    const path = tip().querySelector(".mbf-tooltip-head .mbf-tooltip-path")!;
    expect(path.textContent).toBe("~\\src\\repo");
    expect(path.querySelectorAll("wbr")).toHaveLength(3);
    expect(tip().querySelectorAll(".mbf-tooltip-section")).toHaveLength(2);
    // A pill names its row like a label: in the first column, the value keeps the second to itself.
    expect(tip().querySelector(".mbf-tooltip-rows > .mbf-tooltip-label > .mbf-tooltip-pill")?.textContent).toBe("main");
    expect(tip().querySelector(".mbf-tooltip-cell .mbf-tooltip-pill")).toBeNull();
    expect(tip().querySelector(".mbf-tooltip-current")?.textContent).toBe("this one");
    const fills = [...tip().querySelectorAll<HTMLElement>(".mbf-tooltip-bar-fill")].map((f) => f.style.width);
    expect(fills).toEqual(["100%", "25%"]);
    t.update({ path: "/x/y" });
    expect(tip().hasAttribute("data-rich")).toBe(false);
    expect(tip().querySelector(".mbf-tooltip-plain")?.textContent).toBe("/x/y");
    setTooltipHome(null);
    t.destroy();
  });

  it("updates or hides while shown, ignores touch and empty content", () => {
    vi.useFakeTimers();
    const a = document.createElement("span");
    document.body.append(a);
    const t = tooltip(a, "one");
    a.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    vi.advanceTimersByTime(500);
    expect(tip()?.hasAttribute("data-open") ?? false).toBe(false);
    hover(a);
    vi.advanceTimersByTime(500);
    t.update("two");
    expect(tip().textContent).toBe("two");
    t.update(null);
    expect(tip().hasAttribute("data-open")).toBe(false);
    expect(a.dataset.tip).toBeUndefined();
    t.update({ text: "" });
    a.dispatchEvent(new PointerEvent("pointerdown"));
    t.destroy();
  });

  it("shows a full-text tip only while the text is cut off, and on keyboard focus", () => {
    vi.useFakeTimers();
    const a = document.createElement("span");
    document.body.append(a);
    const t = fullText(a, "C:/a/long/path");
    expect(a.dataset.tip).toBe("overflow");
    hover(a);
    vi.advanceTimersByTime(500);
    expect(tip()?.hasAttribute("data-open") ?? false).toBe(false);
    Object.defineProperty(a, "scrollWidth", { value: 300 });
    Object.defineProperty(a, "clientWidth", { value: 100 });
    hover(a);
    vi.advanceTimersByTime(500);
    expect(tip().hasAttribute("data-open")).toBe(true);
    a.dispatchEvent(new PointerEvent("pointerleave"));
    (a as unknown as { matches: () => boolean }).matches = () => true;
    a.dispatchEvent(new FocusEvent("focusin"));
    expect(tip().hasAttribute("data-open")).toBe(true);
    a.dispatchEvent(new FocusEvent("focusout"));
    t.update("other");
    t.update(null);
    t.destroy();
  });
});

describe("delayed", () => {
  it("turns true only after the flag held for the delay", () => {
    vi.useFakeTimers();
    let flag = $state(false);
    let d!: { value: boolean };
    const stop = $effect.root(() => {
      d = delayed(() => flag, 150);
    });
    flag = true;
    flushSync();
    vi.advanceTimersByTime(100);
    expect(d.value).toBe(false);
    vi.advanceTimersByTime(60);
    expect(d.value).toBe(true);
    flag = false;
    flushSync();
    expect(d.value).toBe(false);
    stop();
  });
});

describe("ViewTabs", () => {
  it("marks the open view, switches by click and by the arrows, and keeps the names in the tips when compact", async () => {
    const onchange = vi.fn();
    const Icon = Square;
    const options = [
      { id: "a", label: "One", icon: Icon },
      { id: "b", label: "Two", icon: Icon, badge: 3 },
      { id: "c", label: "Three", icon: Icon },
    ];
    const { rerender } = render(ViewTabs, { options, value: "b", onchange, label: "Views" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("Two");
    await fireEvent.click(screen.getByRole("tab", { name: /Three/ }));
    expect(onchange).toHaveBeenLastCalledWith("c");
    await fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onchange).toHaveBeenLastCalledWith("c");
    await fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onchange).toHaveBeenLastCalledWith("a");
    await rerender({ options, value: "b", onchange, label: "Views", compact: true });
    expect(screen.getByRole("tab", { name: "Two" }).textContent).not.toContain("Two");
  });
});
