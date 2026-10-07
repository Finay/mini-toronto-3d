import { readFileSync } from 'node:fs';

const ROOT = new URL('../data/processed/', import.meta.url);

/**
 * Reads a JSON file produced by `npm run data`. Returns undefined when it has
 * not been generated, so sources can run without it in a reduced form.
 */
export function readProcessed<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(new URL(path, ROOT), 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
