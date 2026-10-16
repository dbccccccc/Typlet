// Typlet original: not ported from Typst.

import { type Engine, newEngine } from '../eval/func.js';
import { type SourceDiagnostic, warn } from '../eval/diag.js';
import { withCollectionLimits } from '../eval/ops.js';

let active: Engine | null = null;

/** Direct layout calls also share one bounded engine with their children. */
export function getLayoutEngine(): Engine {
  return active ?? newEngine();
}

/** Keeps delayed callbacks in their formula's budget and restores nested callers. */
export function withLayoutEngine<T>(engine: Engine, warnings: SourceDiagnostic[], body: () => T): T {
  const previous = active;
  const start = engine.warnings.length;
  active = engine;
  try { return withCollectionLimits(engine.limits.collectionSize, engine.limits.stringLength, body); }
  finally {
    active = previous;
    for (const diagnostic of engine.warnings.slice(start)) warn(warnings, diagnostic);
  }
}
