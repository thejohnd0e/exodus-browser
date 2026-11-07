import { expect, it, vi } from 'vitest';
import { TrayController, type TrayMenuItem } from '../../src/main/tray';

function setup() {
  const handlers: Record<string, () => void> = {};
  const win = { on: vi.fn((event: string, listener: () => void) => { handlers[event] = listener; }), hide: vi.fn(), show: vi.fn(), restore: vi.fn(), focus: vi.fn(), close: vi.fn(), isMinimized: vi.fn(() => false), isDestroyed: vi.fn(() => false) };
  const clicks: Record<string, () => void> = {};
  const tray = { setToolTip: vi.fn(), setContextMenu: vi.fn(), on: vi.fn((event: string, listener: () => void) => { clicks[event] = listener; }), destroy: vi.fn() };
  const createTray = vi.fn(() => tray);
  let menu: TrayMenuItem[] = [];
  const controller = new TrayController({ win, createTray, buildMenu: items => { menu = items; return items; }, labels: () => ({ show: 'Show', quit: 'Quit', tooltip: 'Exodus Browser' }) });
  return { controller, win, tray, createTray, handlers, clicks, menu: () => menu };
}

it('hides the window on minimize only while the option is enabled', () => {
  const { controller, win, handlers } = setup();
  handlers.minimize!();
  expect(win.hide).not.toHaveBeenCalled();
  controller.setEnabled(true);
  handlers.minimize!();
  expect(win.hide).toHaveBeenCalledTimes(1);
});

it('creates one tray icon with a localized menu and restores the window on click', () => {
  const { controller, win, tray, createTray, clicks, menu } = setup();
  win.isMinimized.mockReturnValue(true);
  controller.setEnabled(true);
  controller.setEnabled(true);
  expect(createTray).toHaveBeenCalledTimes(1);
  expect(tray.setToolTip).toHaveBeenCalledWith('Exodus Browser');
  expect(menu().map(item => item.label)).toEqual(['Show', 'Quit']);
  clicks.click!();
  expect(win.restore).toHaveBeenCalled(); expect(win.show).toHaveBeenCalled(); expect(win.focus).toHaveBeenCalled();
});

it('quits through the regular window close flow', () => {
  const { controller, win, menu } = setup();
  controller.setEnabled(true);
  menu()[1]!.click();
  expect(win.show).toHaveBeenCalled();
  expect(win.close).toHaveBeenCalled();
});

it('removes the icon and brings a hidden window back when disabled', () => {
  const { controller, win, tray } = setup();
  controller.setEnabled(false);
  expect(win.show).not.toHaveBeenCalled();
  controller.setEnabled(true);
  controller.setEnabled(false);
  expect(tray.destroy).toHaveBeenCalledTimes(1);
  expect(controller.active).toBe(false);
  expect(win.show).toHaveBeenCalledTimes(1);
});

it('ignores a destroyed window', () => {
  const { controller, win, handlers } = setup();
  controller.setEnabled(true);
  win.isDestroyed.mockReturnValue(true);
  handlers.minimize!(); controller.show();
  expect(win.hide).not.toHaveBeenCalled(); expect(win.show).not.toHaveBeenCalled();
});
