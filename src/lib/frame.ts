/** Runs once at the next frame. A hidden window gets no frames: a timer lands the work anyway. */
export const frame = {
  next(run: () => void) {
    // Tests fake the timers and render no frames; the build drops this branch.
    if (import.meta.env.MODE === "test") return queueMicrotask(run);
    let ran = false;
    const once = () => {
      if (ran) return;
      ran = true;
      run();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(once);
    setTimeout(once, 50);
  },
};
