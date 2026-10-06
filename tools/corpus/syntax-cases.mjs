// Syntax edge cases that random fuzzing rarely reaches: nesting past the
// parser's depth limit, unusual Unicode, raw blocks, numbers, and the
// memoized backtracking for closures and destructuring. Each case names its
// parsing mode: `math` (formulas), `code` or `markup` (preambles, content).

const deep = (open, inner, close, n) => open.repeat(n) + inner + close.repeat(n);

export const syntaxCases = [
  // Depth limit (256): errors must match, and parsing must stay fast.
  ['deep-parens-math', 'math', deep('(', 'x', ')', 300)],
  ['deep-braces-math', 'math', deep('{', 'x', '}', 300)],
  ['deep-attach', 'math', Array.from({ length: 300 }, () => 'x').join('^')],
  ['deep-frac', 'math', Array.from({ length: 300 }, () => 'x').join('/')],
  ['deep-calls-math', 'math', deep('f(', 'x', ')', 300)],
  ['deep-hash-calls', 'math', `#${deep('f(', 'x', ')', 300)}`],
  ['deep-code-blocks', 'code', deep('{', 'x', '}', 300)],
  ['deep-content-blocks', 'markup', deep('#[', 'x', ']', 300)],
  ['deep-parens-code', 'code', deep('(', '1', ')', 300)],
  ['deep-unary', 'code', `${'-'.repeat(300)}1`],
  ['deep-strong-emph', 'markup', deep('*_', 'x', '_*', 150)],
  ['deep-unclosed', 'math', '('.repeat(300)],

  // Backtracking guarded by memoization (exponential without it).
  ['memo-closures', 'code', '(x: (x: (x: (x: (x) => y) => y) => y) => y) => y'],
  ['memo-destructuring', 'code', '((a, (b, (c, d))), e) = f'],
  ['memo-mixed', 'code', '(a: (b) => c, d: (e, f) = g)'],

  // Unicode.
  ['astral-letters', 'math', '𝑥 + 𝔸_𝑛 = 😀^🇺🇸'],
  ['combining-marks', 'math', 'é + x̂̃ + abć'],
  ['zwj-sequence', 'math', '👩‍👩‍👧 x'],
  ['unicode-digits', 'math', '١٢٣.٤ + ²³ + ½'],
  ['unicode-newlines-math', 'math', 'a\u0085b\u2028c\u2029d\r\ne'],
  ['unicode-newlines-markup', 'markup', 'a\u0085\u0085b\u2028\u2028c'],
  ['cjk-strong', 'markup', '中*文*字 a*b*c 日本_語_ 한*국*'],
  ['bom', 'markup', '﻿= Heading'],
  ['shebang', 'markup', '#!/usr/bin/env typst\nx'],

  // Escapes and strings.
  ['escapes', 'math', '\\u{1F600} \\u{} \\u{110000} \\u{D800} \\u{zz} \\u{41 \\'],
  ['string-escapes', 'code', '"a\\nb\\"c\\u{41}\\u{zz}\\q" + "unclosed'],
  ['dict-dupe-escaped-key', 'code', '("a\\u{62}": 1, "ab": 2)'],

  // Numbers.
  ['numbers', 'code', '(0x1F, 0b101, 0o17, 0x, 0b102, 0o9, 1e5, 1.5e-3, 1e, 1.2E+, 1em, 1e5em, .5, 5., 1..2)'],
  ['number-suffixes', 'code', '(1pt, 2mm, 3cm, 4in, 5deg, 6rad, 7em, 8fr, 9%, 10px, 0x10pt, 0b1em)'],
  ['number-overflow', 'code', '(9223372036854775807, 9223372036854775808, 0xFFFFFFFFFFFFFFFFF, 99999999999999999999999)'],
  ['enum-numbers', 'markup', '1. a\n18446744073709551615. b\n18446744073709551616. c'],

  // Raw blocks.
  ['raw-inline', 'markup', '`a\n b` `` ``` `x`'],
  ['raw-block-dedent', 'markup', '```rust\n    fn main() {\n        x\n    }\n  ```'],
  ['raw-block-first-line', 'markup', '```  text after tag\n  a\n```'],
  ['raw-block-backtick-end', 'markup', '``` a` ```'],
  ['raw-lang-warnings', 'markup', '```C++ x``` ```++C x``` ```js```'],
  ['raw-unclosed', 'markup', '```a'],
  ['raw-crlf', 'markup', '```\r\n  a\r\n   b\r\n  ```'],

  // Markup structure.
  ['lists-columns', 'markup', '- a\n  - b\n - c\n- d\n\n+ e\n  + f\n/ t: d\n  more'],
  ['links', 'markup', 'https://typst.org/(a[b]c) https://x.y/a). https://a.b/c]'],
  ['labels-refs', 'markup', '<a:b.c> <> <x @r @r. @r: @r[s] @'],
  ['shorthands-markup', 'markup', 'a -- b --- c -? d ~ e ... f -1'],
  ['headings', 'markup', '= a\n== b <l>\n=x\n ==='],
  ['comments', 'markup', 'a // c\nb /* d /* e */ f */ g */ h'],
];
