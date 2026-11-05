import { expect, it, vi } from 'vitest';
import { cleanupManagedProcess } from '../fixtures/automation/harness';

it('retains the temporary root if browser exit cannot be confirmed', async () => {
  const remove = vi.fn(async () => {});
  await expect(cleanupManagedProcess({ stop: async () => {}, exit: new Promise(() => {}) }, remove, 10)).rejects.toThrow('EXIT_TIMEOUT');
  expect(remove).not.toHaveBeenCalled();
});

it('retains the temporary root when stop fails even if exit is observed', async () => {
  const remove = vi.fn(async () => {});
  await expect(cleanupManagedProcess({ stop: async () => { throw Error('STOP_TIMEOUT'); }, exit: Promise.resolve() }, remove, 10)).rejects.toThrow('STOP_TIMEOUT');
  expect(remove).not.toHaveBeenCalled();
});

it('removes the temporary root only after stop and exit', async () => {
  const remove = vi.fn(async () => {});
  await cleanupManagedProcess({ stop: async () => {}, exit: Promise.resolve() }, remove, 100);
  expect(remove).toHaveBeenCalledOnce();
});
