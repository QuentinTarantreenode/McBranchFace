// Browser APIs jsdom lacks and the components call on mount. Test files in the node environment
// have no DOM and skip this; a test that needs other behaviour installs its own over these.
if (typeof HTMLDialogElement !== "undefined") {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
  Element.prototype.scrollIntoView ??= () => {};
  // No Web Animations in jsdom: transitions finish at once.
  Element.prototype.animate ??= function () {
    const a = { cancel() {}, finish() {}, currentTime: 0, effect: null, finished: Promise.resolve() } as unknown as Animation;
    Object.defineProperty(a, "onfinish", { set: (fn: () => void) => setTimeout(fn, 0) });
    return a;
  };
  // No layout in jsdom: menus place themselves on resize, which never comes here.
  Object.assign(globalThis, {
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  // The notification plugin uses the web API; denied unless a test grants it.
  Object.assign(globalThis, { Notification: class { static permission = "denied"; } });
}
