import { brotliCompressSync, constants } from 'node:zlib';

/** Brotli size at maximum quality, the setting a CDN would use for static files. */
export function brotliSize(buffer) {
  return brotliCompressSync(buffer, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
    },
  }).length;
}

/**
 * Compares measured sizes with budgets. `sizes` maps file → brotli bytes, or
 * `null` when the file is missing. Returns one result per budgeted file.
 */
export function checkBudgets(budgets, sizes) {
  return Object.entries(budgets).map(([file, limit]) => {
    const size = sizes[file] ?? null;
    return { file, limit, size, ok: size !== null && size <= limit };
  });
}
