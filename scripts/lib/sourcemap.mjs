// Reads and writes the `mappings` of a version 3 source map, for build steps
// that edit a bundle between two esbuild passes (scripts/lib/eager.mjs).

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGITS = new Map([...BASE64].map((c, i) => [c, i]));

/**
 * Decodes `mappings` into lines of segments. A segment is
 * `[column, source, sourceLine, sourceColumn, name?]`, or `[column]` for
 * generated code without a source, with every field absolute.
 */
export function decodeMappings(mappings) {
  // The fields after the column are relative to the previous segment that
  // has them, across lines.
  const previous = [0, 0, 0, 0, 0];
  return mappings.split(';').map((line) => {
    previous[0] = 0;
    if (line === '') return [];
    return line.split(',').map((text) => {
      const segment = [];
      let value = 0;
      let shift = 0;
      for (const c of text) {
        const digit = DIGITS.get(c);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
          continue;
        }
        const field = segment.length;
        previous[field] += value & 1 ? -(value >>> 1) : value >>> 1;
        segment.push(previous[field]);
        value = 0;
        shift = 0;
      }
      return segment;
    });
  });
}

/** Encodes lines of segments, as `decodeMappings` returns them. */
export function encodeMappings(lines) {
  const previous = [0, 0, 0, 0, 0];
  return lines
    .map((line) => {
      previous[0] = 0;
      return line
        .map((segment) => {
          let text = '';
          segment.forEach((field, i) => {
            const delta = field - previous[i];
            previous[i] = field;
            let value = delta < 0 ? (-delta << 1) | 1 : delta << 1;
            do {
              const digit = value & 31;
              value >>>= 5;
              text += BASE64[value > 0 ? digit | 32 : digit];
            } while (value > 0);
          });
          return text;
        })
        .join(',');
    })
    .join(';');
}
