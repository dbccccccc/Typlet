// Typlet original: not ported from Typst.
//
// The entry point of the `typlet` command (see cli.ts).

import { main } from './cli.js';

process.exitCode = await main(process.argv.slice(2));
