// Typlet original: not ported from Typst.
//
// The syntax module: Typst's lexer and parser, ported from typst-syntax.

export { SyntaxKind, SyntaxMode, kindName } from './kind.js';
export { SyntaxNode, type SyntaxDiagnostic } from './node.js';
export { parse, parseCode, parseMath } from './parser.js';
