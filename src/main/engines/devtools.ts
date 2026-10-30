import type {ChildProcess} from 'node:child_process';
import {parseDevtoolsUrl} from '../cdp/client';

export function waitForDevtools(child: ChildProcess, timeoutMs = 10000): Promise<string | null> {
  return new Promise(resolve => {
    let buffer = '';
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(url);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    if (!child.stderr) {
      finish(null);
      return;
    }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      buffer = (buffer + chunk).slice(-131072);
      for (const line of buffer.split(/[\r\n]+/)) {
        const url = parseDevtoolsUrl(line);
        if (url) {
          finish(url);
          return;
        }
      }
    });
    child.stderr.on('end', () => finish(null));
    child.stderr.on('error', () => finish(null));
  });
}
