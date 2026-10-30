// The clock behind relative times ("3 minutes ago") and behind what counts days.
const seconds = () => Math.floor(Date.now() / 1000);

class Clock {
  /** Unix seconds; the app moves it on every tick, so relative times stay true. */
  now = $state(seconds());
  /** The clock to the hour, for what counts days (lenses, waiting pull requests): it changes 120 times less often. */
  hourClock = $derived(Math.floor(this.now / 3600) * 3600);

  resetForTests() {
    this.tick();
  }

  tick() {
    this.now = seconds();
  }
}

export const clock = new Clock();
