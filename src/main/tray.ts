/**
 * Minimize-to-tray behaviour. Electron objects are injected so the logic is testable without a display.
 * The tray icon exists only while the option is enabled; closing the window keeps its normal shutdown flow.
 */
export type TrayLike = {
  setToolTip(text: string): void;
  setContextMenu(menu: unknown): void;
  on(event: 'click' | 'double-click', listener: () => void): void;
  destroy(): void;
};
export type TrayWindow = {
  on(event: 'minimize', listener: () => void): void;
  hide(): void;
  show(): void;
  restore(): void;
  focus(): void;
  close(): void;
  isMinimized(): boolean;
  isDestroyed(): boolean;
};
export type TrayMenuItem = { label: string; click: () => void };
export type TrayLabels = { show: string; quit: string; tooltip: string };

export class TrayController {
  private tray: TrayLike | null = null;
  private enabled = false;
  private quitRequested = false;

  constructor(private deps: {
    win: TrayWindow;
    createTray: () => TrayLike;
    buildMenu: (items: TrayMenuItem[]) => unknown;
    labels: () => TrayLabels;
  }) {
    deps.win.on('minimize', () => { if (this.enabled && !deps.win.isDestroyed()) deps.win.hide(); });
  }

  get active(): boolean { return this.tray !== null; }

  /** True when the close button should send the window to the tray instead of starting shutdown. */
  hideOnClose(): boolean { return this.enabled && !this.quitRequested && !this.deps.win.isDestroyed(); }

  hide(): void { if (!this.deps.win.isDestroyed()) this.deps.win.hide(); }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (!this.tray) {
        const tray = this.deps.createTray();
        tray.on('click', () => this.show());
        tray.on('double-click', () => this.show());
        this.tray = tray;
      }
      this.refresh();
    } else if (this.tray) {
      // Turning the option off while the window sits in the tray must not strand it there.
      this.dispose();
      this.show();
    }
  }

  /** Re-applies localized labels, e.g. after a language change. */
  refresh(): void {
    if (!this.tray) return;
    const labels = this.deps.labels();
    this.tray.setToolTip(labels.tooltip);
    this.tray.setContextMenu(this.deps.buildMenu([
      { label: labels.show, click: () => this.show() },
      { label: labels.quit, click: () => this.quit() },
    ]));
  }

  /** Brings the window back from the tray or from a minimized state. */
  show(): void {
    const win = this.deps.win;
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /** Uses the regular close handler, so running profiles still get the confirmation flow. */
  private quit(): void {
    this.show();
    // The explicit Quit item must reach the regular close flow rather than being hidden again.
    this.quitRequested = true;
    try { if (!this.deps.win.isDestroyed()) this.deps.win.close(); }
    finally { this.quitRequested = false; }
  }

  dispose(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
