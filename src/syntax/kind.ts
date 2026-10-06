// Ported from Typst 0.15.1: crates/typst-syntax/src/kind.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.

/**
 * A syntactical building block of a Typst file. Created by the lexer or the
 * parser. The variants, their order and their names match typst-syntax, so
 * `SyntaxKind[kind]` gives the same name as Rust's `Debug` output.
 */
export enum SyntaxKind {
  /** The end of token stream. */
  End,
  /** An invalid sequence of characters. */
  Error,

  /** A shebang: `#! ...` */
  Shebang,
  /** A line comment: `// ...`. */
  LineComment,
  /** A block comment: `/* ... *\/`. */
  BlockComment,

  /** The contents of a file or content block. */
  Markup,
  /** Plain text without markup. */
  Text,
  /** Whitespace. Contains at most one newline in markup. */
  Space,
  /** A forced line break: `\`. */
  Linebreak,
  /** A paragraph break, indicated by one or multiple blank lines. */
  Parbreak,
  /** An escape sequence: `\#`, `\u{1F5FA}`. */
  Escape,
  /** A shorthand for a unicode codepoint: `~` or `-?`. */
  Shorthand,
  /** A smart quote: `'` or `"`. */
  SmartQuote,
  /** Strong content: `*Strong*`. */
  Strong,
  /** Emphasized content: `_Emphasized_`. */
  Emph,
  /** Raw text with optional syntax highlighting: `` `...` ``. */
  Raw,
  /** A language tag at the start of raw text: ``typ ``. */
  RawLang,
  /** A raw delimiter consisting of 1 or 3+ backticks: `` ` ``. */
  RawDelim,
  /** A sequence of whitespace to ignore in a raw text. */
  RawTrimmed,
  /** A hyperlink: `https://typst.org`. */
  Link,
  /** A label: `<intro>`. */
  Label,
  /** A reference: `@target`, `@target[..]`. */
  Ref,
  /** Introduces a reference: `@target`. */
  RefMarker,
  /** A section heading: `= Introduction`. */
  Heading,
  /** Introduces a section heading: `=`, `==`, ... */
  HeadingMarker,
  /** An item in a bullet list: `- ...`. */
  ListItem,
  /** Introduces a list item: `-`. */
  ListMarker,
  /** An item in an enumeration: `+ ...` or `1. ...`. */
  EnumItem,
  /** Introduces an enumeration item: `+`, `1.`. */
  EnumMarker,
  /** An item in a term list: `/ Term: Details`. */
  TermItem,
  /** Introduces a term item: `/`. */
  TermMarker,

  /** A mathematical equation: `$x$`, `$ x^2 $`. */
  Equation,
  /** The contents of a mathematical equation: `x^2 + 1`. */
  Math,
  /** A lone text fragment in math: `x`, `25`, `3.1415`, `=`, `|`, `[`. */
  MathText,
  /** An identifier in math: `pi`. */
  MathIdent,
  /** A field access in math: `arrow.r.long.double.bar`. */
  MathFieldAccess,
  /** A shorthand for a unicode codepoint in math: `a <= b`. */
  MathShorthand,
  /** An alignment point in math: `&`. */
  MathAlignPoint,
  /** A function call in math: `mat(delim: "[", a, b; ..#($c$,), d)`. */
  MathCall,
  /** Function arguments in math: `(delim: "[", a, b; ..#($c$,), d)`. */
  MathArgs,
  /** Matched delimiters in math: `[x + y]`. */
  MathDelimited,
  /** A base with optional attachments in math: `a_1^2`. */
  MathAttach,
  /** Grouped primes in math: `a'''`. */
  MathPrimes,
  /** A fraction in math: `x/2`. */
  MathFrac,
  /** A root in math: `√x`, `∛x` or `∜x`. */
  MathRoot,

  /** A hash that switches into code mode: `#`. */
  Hash,
  /** A left curly brace, starting a code block: `{`. */
  LeftBrace,
  /** A right curly brace, terminating a code block: `}`. */
  RightBrace,
  /** A left square bracket, starting a content block: `[`. */
  LeftBracket,
  /** A right square bracket, terminating a content block: `]`. */
  RightBracket,
  /** A left round parenthesis: `(`. */
  LeftParen,
  /** A right round parenthesis: `)`. */
  RightParen,
  /** A comma separator in a sequence: `,`. */
  Comma,
  /** A semicolon terminating an expression: `;`. */
  Semicolon,
  /** A colon between name/key and value: `:`. */
  Colon,
  /** The strong text toggle, multiplication operator, and wildcard import: `*`. */
  Star,
  /** Toggles emphasized text and indicates a subscript in math: `_`. */
  Underscore,
  /** Starts and ends a mathematical equation: `$`. */
  Dollar,
  /** The unary plus and binary addition operator: `+`. */
  Plus,
  /** The unary negation and binary subtraction operator: `-`. */
  Minus,
  /** The division operator and fraction operator in math: `/`. */
  Slash,
  /** The superscript operator in math: `^`. */
  Hat,
  /** The field access and method call operator: `.`. */
  Dot,
  /** The assignment operator: `=`. */
  Eq,
  /** The equality operator: `==`. */
  EqEq,
  /** The inequality operator: `!=`. */
  ExclEq,
  /** The less-than operator: `<`. */
  Lt,
  /** The less-than or equal operator: `<=`. */
  LtEq,
  /** The greater-than operator: `>`. */
  Gt,
  /** The greater-than or equal operator: `>=`. */
  GtEq,
  /** The add-assign operator: `+=`. */
  PlusEq,
  /** The subtract-assign operator: `-=`. */
  HyphEq,
  /** The multiply-assign operator: `*=`. */
  StarEq,
  /** The divide-assign operator: `/=`. */
  SlashEq,
  /** Indicates a spread or sink: `..`. */
  Dots,
  /** An arrow between a closure's parameters and body: `=>`. */
  Arrow,
  /** A root: `√`, `∛` or `∜`. */
  Root,
  /** An exclamation mark; groups with directly preceding text in math: `!`. */
  Bang,

  /** The `not` operator. */
  Not,
  /** The `and` operator. */
  And,
  /** The `or` operator. */
  Or,
  /** The `none` literal. */
  None,
  /** The `auto` literal. */
  Auto,
  /** The `let` keyword. */
  Let,
  /** The `set` keyword. */
  Set,
  /** The `show` keyword. */
  Show,
  /** The `context` keyword. */
  Context,
  /** The `if` keyword. */
  If,
  /** The `else` keyword. */
  Else,
  /** The `for` keyword. */
  For,
  /** The `in` keyword. */
  In,
  /** The `while` keyword. */
  While,
  /** The `break` keyword. */
  Break,
  /** The `continue` keyword. */
  Continue,
  /** The `return` keyword. */
  Return,
  /** The `import` keyword. */
  Import,
  /** The `include` keyword. */
  Include,
  /** The `as` keyword. */
  As,

  /** The contents of a code block. */
  Code,
  /** An identifier: `it`. */
  Ident,
  /** A boolean: `true`, `false`. */
  Bool,
  /** An integer: `120`. */
  Int,
  /** A floating-point number: `1.2`, `10e-4`. */
  Float,
  /** A numeric value with a unit: `12pt`, `3cm`, `2em`, `90deg`, `50%`. */
  Numeric,
  /** A quoted string: `"..."`. */
  Str,
  /** A code block: `{ let x = 1; x + 2 }`. */
  CodeBlock,
  /** A content block: `[*Hi* there!]`. */
  ContentBlock,
  /** A grouped expression: `(1 + 2)`. */
  Parenthesized,
  /** An array: `(1, "hi", 12cm)`. */
  Array,
  /** A dictionary: `(thickness: 3pt, dash: "solid")`. */
  Dict,
  /** A named pair: `thickness: 3pt`. */
  Named,
  /** A keyed pair: `"spacy key": true`. */
  Keyed,
  /** A unary operation: `-x`. */
  Unary,
  /** A binary operation: `a + b`. */
  Binary,
  /** A field access: `properties.age`. */
  FieldAccess,
  /** An invocation of a function or method: `f(x, y)`. */
  FuncCall,
  /** A function call's argument list: `(12pt, y)`. */
  Args,
  /** Spread arguments or an argument sink: `..x`. */
  Spread,
  /** A closure: `(x, y) => z`. */
  Closure,
  /** A closure's parameters: `(x, y)`. */
  Params,
  /** A let binding: `let x = 1`. */
  LetBinding,
  /** A set rule: `set text(...)`. */
  SetRule,
  /** A show rule: `show heading: it => emph(it.body)`. */
  ShowRule,
  /** A contextual expression: `context text.lang`. */
  Contextual,
  /** An if-else conditional: `if x { y } else { z }`. */
  Conditional,
  /** A while loop: `while x { y }`. */
  WhileLoop,
  /** A for loop: `for x in y { z }`. */
  ForLoop,
  /** A module import: `import "utils.typ": a, b, c`. */
  ModuleImport,
  /** Items to import from a module: `a, b, c`. */
  ImportItems,
  /** A path to an imported name from a submodule: `a.b.c`. */
  ImportItemPath,
  /** A renamed import item: `a as d`. */
  RenamedImportItem,
  /** A module include: `include "chapter1.typ"`. */
  ModuleInclude,
  /** A break from a loop: `break`. */
  LoopBreak,
  /** A continue in a loop: `continue`. */
  LoopContinue,
  /** A return from a function: `return`, `return x + 1`. */
  FuncReturn,
  /** A destructuring pattern: `(x, _, ..y)`. */
  Destructuring,
  /** A destructuring assignment expression: `(x, y) = (1, 2)`. */
  DestructAssignment,
}

/** The syntax mode of a portion of Typst code. */
export enum SyntaxMode {
  /** Text and markup, as in the top level. */
  Markup,
  /** Math atoms, operators, etc., as in equations. */
  Math,
  /** Keywords, literals and operators, as after hashes. */
  Code,
}

const K = SyntaxKind;

/** Is this a bracket, brace, or parenthesis? */
export function isGrouping(kind: SyntaxKind): boolean {
  return (
    kind === K.LeftBracket ||
    kind === K.LeftBrace ||
    kind === K.LeftParen ||
    kind === K.RightBracket ||
    kind === K.RightBrace ||
    kind === K.RightParen
  );
}

/** Does this node terminate a preceding expression? */
export function isTerminator(kind: SyntaxKind): boolean {
  return (
    kind === K.End || kind === K.Semicolon || kind === K.RightBrace || kind === K.RightParen || kind === K.RightBracket
  );
}

/** Is this a code or content block. */
export function isBlock(kind: SyntaxKind): boolean {
  return kind === K.CodeBlock || kind === K.ContentBlock;
}

/** Does this node need termination through a semicolon or linebreak? */
export function isStmt(kind: SyntaxKind): boolean {
  return (
    kind === K.LetBinding ||
    kind === K.SetRule ||
    kind === K.ShowRule ||
    kind === K.ModuleImport ||
    kind === K.ModuleInclude
  );
}

/** Is this node a keyword. */
export function isKeyword(kind: SyntaxKind): boolean {
  return kind >= K.Not && kind <= K.As;
}

/** Whether this kind of node is automatically skipped by the parser in code and math mode. */
export function isTrivia(kind: SyntaxKind): boolean {
  return (
    kind === K.Shebang || kind === K.LineComment || kind === K.BlockComment || kind === K.Space || kind === K.Parbreak
  );
}

/** Whether this is an error. */
export function isError(kind: SyntaxKind): boolean {
  return kind === K.Error;
}

const NAMES: Partial<Record<SyntaxKind, string>> = {
  [K.End]: 'end of tokens',
  [K.Error]: 'syntax error',
  [K.Shebang]: 'shebang',
  [K.LineComment]: 'line comment',
  [K.BlockComment]: 'block comment',
  [K.Markup]: 'markup',
  [K.Text]: 'text',
  [K.Space]: 'space',
  [K.Linebreak]: 'line break',
  [K.Parbreak]: 'paragraph break',
  [K.Escape]: 'escape sequence',
  [K.Shorthand]: 'shorthand',
  [K.SmartQuote]: 'smart quote',
  [K.Strong]: 'strong content',
  [K.Emph]: 'emphasized content',
  [K.Raw]: 'raw block',
  [K.RawLang]: 'raw language tag',
  [K.RawTrimmed]: 'raw trimmed',
  [K.RawDelim]: 'raw delimiter',
  [K.Link]: 'link',
  [K.Label]: 'label',
  [K.Ref]: 'reference',
  [K.RefMarker]: 'reference marker',
  [K.Heading]: 'heading',
  [K.HeadingMarker]: 'heading marker',
  [K.ListItem]: 'list item',
  [K.ListMarker]: 'list marker',
  [K.EnumItem]: 'enum item',
  [K.EnumMarker]: 'enum marker',
  [K.TermItem]: 'term list item',
  [K.TermMarker]: 'term marker',
  [K.Equation]: 'equation',
  [K.Math]: 'math',
  [K.MathText]: 'math text',
  [K.MathIdent]: 'math identifier',
  [K.MathFieldAccess]: 'math field access',
  [K.MathShorthand]: 'math shorthand',
  [K.MathAlignPoint]: 'math alignment point',
  [K.MathCall]: 'math function call',
  [K.MathArgs]: 'math call arguments',
  [K.MathDelimited]: 'delimited math',
  [K.MathAttach]: 'math attachments',
  [K.MathFrac]: 'math fraction',
  [K.MathRoot]: 'math root',
  [K.MathPrimes]: 'math primes',
  [K.Hash]: 'hash',
  [K.LeftBrace]: 'opening brace',
  [K.RightBrace]: 'closing brace',
  [K.LeftBracket]: 'opening bracket',
  [K.RightBracket]: 'closing bracket',
  [K.LeftParen]: 'opening paren',
  [K.RightParen]: 'closing paren',
  [K.Comma]: 'comma',
  [K.Semicolon]: 'semicolon',
  [K.Colon]: 'colon',
  [K.Star]: 'star',
  [K.Underscore]: 'underscore',
  [K.Dollar]: 'dollar sign',
  [K.Plus]: 'plus',
  [K.Minus]: 'minus',
  [K.Slash]: 'slash',
  [K.Hat]: 'hat',
  [K.Dot]: 'dot',
  [K.Eq]: 'equals sign',
  [K.EqEq]: 'equality operator',
  [K.ExclEq]: 'inequality operator',
  [K.Lt]: 'less-than operator',
  [K.LtEq]: 'less-than or equal operator',
  [K.Gt]: 'greater-than operator',
  [K.GtEq]: 'greater-than or equal operator',
  [K.PlusEq]: 'add-assign operator',
  [K.HyphEq]: 'subtract-assign operator',
  [K.StarEq]: 'multiply-assign operator',
  [K.SlashEq]: 'divide-assign operator',
  [K.Dots]: 'dots',
  [K.Arrow]: 'arrow',
  [K.Root]: 'root',
  [K.Bang]: 'exclamation mark',
  [K.Not]: 'operator `not`',
  [K.And]: 'operator `and`',
  [K.Or]: 'operator `or`',
  [K.None]: '`none`',
  [K.Auto]: '`auto`',
  [K.Let]: 'keyword `let`',
  [K.Set]: 'keyword `set`',
  [K.Show]: 'keyword `show`',
  [K.Context]: 'keyword `context`',
  [K.If]: 'keyword `if`',
  [K.Else]: 'keyword `else`',
  [K.For]: 'keyword `for`',
  [K.In]: 'keyword `in`',
  [K.While]: 'keyword `while`',
  [K.Break]: 'keyword `break`',
  [K.Continue]: 'keyword `continue`',
  [K.Return]: 'keyword `return`',
  [K.Import]: 'keyword `import`',
  [K.Include]: 'keyword `include`',
  [K.As]: 'keyword `as`',
  [K.Code]: 'code',
  [K.Ident]: 'identifier',
  [K.Bool]: 'boolean',
  [K.Int]: 'integer',
  [K.Float]: 'float',
  [K.Numeric]: 'numeric value',
  [K.Str]: 'string',
  [K.CodeBlock]: 'code block',
  [K.ContentBlock]: 'content block',
  [K.Parenthesized]: 'group',
  [K.Array]: 'array',
  [K.Dict]: 'dictionary',
  [K.Named]: 'named pair',
  [K.Keyed]: 'keyed pair',
  [K.Unary]: 'unary expression',
  [K.Binary]: 'binary expression',
  [K.FieldAccess]: 'field access',
  [K.FuncCall]: 'function call',
  [K.Args]: 'call arguments',
  [K.Spread]: 'spread',
  [K.Closure]: 'closure',
  [K.Params]: 'closure parameters',
  [K.LetBinding]: '`let` expression',
  [K.SetRule]: '`set` expression',
  [K.ShowRule]: '`show` expression',
  [K.Contextual]: '`context` expression',
  [K.Conditional]: '`if` expression',
  [K.WhileLoop]: 'while-loop expression',
  [K.ForLoop]: 'for-loop expression',
  [K.ModuleImport]: '`import` expression',
  [K.ImportItems]: 'import items',
  [K.ImportItemPath]: 'imported item path',
  [K.RenamedImportItem]: 'renamed import item',
  [K.ModuleInclude]: '`include` expression',
  [K.LoopBreak]: '`break` expression',
  [K.LoopContinue]: '`continue` expression',
  [K.FuncReturn]: '`return` expression',
  [K.Destructuring]: 'destructuring pattern',
  [K.DestructAssignment]: 'destructuring assignment expression',
};

/** A human-readable name for the kind, as used in error messages. */
export function kindName(kind: SyntaxKind): string {
  return NAMES[kind] ?? SyntaxKind[kind];
}
