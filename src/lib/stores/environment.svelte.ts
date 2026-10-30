// What the machine offers: git and the provider CLIs with their state, GitHub Desktop, and what the window
// can do (tray, autostart). Without a ready git, or without roots, only the onboarding makes sense.
import { api } from "$lib/api";
import type { ToolAction } from "$lib/bindings/ToolAction";
import type { ToolId } from "$lib/bindings/ToolId";
import type { ToolStatus } from "$lib/bindings/ToolStatus";
import type { WindowCapabilities } from "$lib/bindings/WindowCapabilities";
import { t } from "$lib/i18n/index.svelte";
import { settings } from "./settings.svelte";
import { toasts } from "./toasts.svelte";

const NO_WINDOW_CAPS: WindowCapabilities = { tray: false, autostart: false, startedHidden: false, home: null };

class Environment {
  /** Replaced as a whole with every check. */
  tools = $state.raw<ToolStatus[]>([]);
  envChecked = $state(false);
  envChecking = $state(false);
  githubDesktop = $state(false);
  windowCaps = $state.raw<WindowCapabilities>(NO_WINDOW_CAPS);

  resetForTests() {
    this.tools = [];
    this.envChecked = false;
    this.envChecking = false;
    this.githubDesktop = false;
    this.windowCaps = NO_WINDOW_CAPS;
  }

  /** git is the one hard requirement; without it (or without roots) only the onboarding makes sense. */
  needsOnboarding = $derived(
    !!settings.config && (settings.config.roots.length === 0 || (this.envChecked && this.tools.find((x) => x.id === "Git")?.state !== "Ready")),
  );

  tool(id: ToolId) {
    return this.tools.find((x) => x.id === id);
  }

  async refreshEnvironment() {
    this.envChecking = true;
    try {
      this.tools = await api.environmentStatus();
      this.envChecked = true;
    } catch (e) {
      toasts.fail(e);
    } finally {
      this.envChecking = false;
    }
  }

  /** A probe that fails leaves the offer away, as if it were not installed. */
  probeGithubDesktop() {
    api.githubDesktopAvailable().then((v) => (this.githubDesktop = v), () => {});
  }

  async runTool(id: ToolId, action: ToolAction) {
    try {
      await api.runToolCommand(id, action);
      toasts.toast("info", t.tool.terminalOpened);
    } catch (e) {
      toasts.fail(e);
    }
  }
}

export const environment = new Environment();
