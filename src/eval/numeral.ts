// Ported from codex 0.3.0: src/numeral_systems.rs
// Copyright The Typst Project Developers. Licensed under Apache-2.0.
// Modified for Typlet. See THIRD_PARTY_NOTICES.md.
//
// The numeral systems of numbering patterns, by their shorthands: Arabic,
// Latin, Roman and Greek numerals, symbols, and more. Chinese numerals are
// refused.

import { bail, unsupported } from './diag.js';

/** A numeral system, like codex's `NumeralSystem`. */
type System =
  | { readonly kind: 'positional' | 'bijective' | 'symbolic' | 'fixed' | 'zerolessFixed'; readonly symbols: readonly string[] }
  | { readonly kind: 'additive'; readonly numerals: readonly (readonly [string, number])[] }
  | { readonly kind: 'chinese' };

export interface Named {
  readonly name: string;
  readonly system: () => System;
}

const chars = (s: string) => [...s];
const words = (s: string) => s.split(' ');
/** Additive numerals from `symbol:value` pairs. */
const additive = (s: string): System => ({
  kind: 'additive',
  numerals: words(s).map((pair) => {
    const i = pair.lastIndexOf(':');
    return [pair.slice(0, i), Number(pair.slice(i + 1))] as const;
  }),
});
const positional = (s: string): System => ({ kind: 'positional', symbols: chars(s) });
const bijective = (symbols: readonly string[]): System => ({ kind: 'bijective', symbols });

const ROMAN_VALUES = [1000000, 500000, 100000, 50000, 10000, 5000, 4000, 1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1, 0];
const roman = (numerals: string): System => ({
  kind: 'additive',
  numerals: words(numerals).map((n, i) => [n, ROMAN_VALUES[i]!] as const),
});
const GREEK_VALUES = [
  9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100, 90, 80, 70, 60,
  50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
];
const greek = (numerals: string): System => ({
  kind: 'additive',
  numerals: words(numerals).map((n, i) => [n, GREEK_VALUES[i]!] as const),
});
const ARMENIAN_VALUES = GREEK_VALUES.slice(0, -1);
const armenian = (letters: string): System => ({
  kind: 'additive',
  numerals: chars(letters).map((n, i) => [n, ARMENIAN_VALUES[i]!] as const),
});

/** The named numeral systems by shorthand, like codex's `NamedNumeralSystem`. */
export const SYSTEMS: ReadonlyMap<string, Named> = new Map<string, Named>([
  ['1', { name: 'arabic', system: () => positional('0123456789') }],
  [
    '①',
    {
      name: 'arabic.o',
      system: () => ({ kind: 'fixed', symbols: chars('⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿') }),
    },
  ],
  ['⓵', { name: 'arabic.oo', system: () => ({ kind: 'zerolessFixed', symbols: chars('⓵⓶⓷⓸⓹⓺⓻⓼⓽⓾') }) }],
  ['a', { name: 'latin', system: () => bijective(chars('abcdefghijklmnopqrstuvwxyz')) }],
  ['A', { name: 'Latin', system: () => bijective(chars('ABCDEFGHIJKLMNOPQRSTUVWXYZ')) }],
  ['i', { name: 'roman', system: () => roman('m̅ d̅ c̅ l̅ x̅ v̅ i̅v̅ m cm d cd c xc l xl x ix v iv i n') }],
  ['I', { name: 'Roman', system: () => roman('M̅ D̅ C̅ L̅ X̅ V̅ I̅V̅ M CM D CD C XC L XL X IX V IV I N') }],
  ['α', { name: 'greek', system: () => greek('͵θ ͵η ͵ζ ͵ϛ ͵ε ͵δ ͵γ ͵β ͵α ϡ ω ψ χ φ υ τ σ ρ ϟ π ο ξ ν μ λ κ ι θ η ζ στ ε δ γ β α 𐆊') }],
  ['Α', { name: 'Greek', system: () => greek('͵Θ ͵Η ͵Ζ ͵Ϛ ͵Ε ͵Δ ͵Γ ͵Β ͵Α Ϡ Ω Ψ Χ Φ Υ Τ Σ Ρ Ϟ Π Ο Ξ Ν Μ Λ Κ Ι Θ Η Ζ ΣΤ Ε Δ Γ Β Α 𐆊') }],
  ['ա', { name: 'armenian', system: () => armenian('քփւցրտվսռջպչոշնյմճղձհկծխլիժթըէզեդգբա') }],
  ['Ա', { name: 'Armenian', system: () => armenian('ՔՓՒՑՐՏՎՍՌՋՊՉՈՇՆՅՄՃՂՁՀԿԾԽԼԻԺԹԸԷԶԵԴԳԲԱ') }],
  ['א', { name: 'hebrew', system: () => additive('ת:400 ש:300 ר:200 ק:100 צ:90 פ:80 ע:70 ס:60 נ:50 מ:40 ל:30 כ:20 יט:19 יח:18 יז:17 טז:16 טו:15 י:10 ט:9 ח:8 ז:7 ו:6 ה:5 ד:4 ג:3 ב:2 א:1') }],
  ['一', { name: 'chinese.simple', system: () => ({ kind: 'chinese' }) }],
  ['壹', { name: 'Chinese.simple', system: () => ({ kind: 'chinese' }) }],
  ['あ', { name: 'hiragana.aiueo', system: () => bijective(chars('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん')) }],
  ['い', { name: 'hiragana.iroha', system: () => bijective(chars('いろはにほへとちりぬるをわかよたれそつねならむうゐのおくやまけふこえてあさきゆめみしゑひもせす')) }],
  ['ア', { name: 'katakana.aiueo', system: () => bijective(chars('アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン')) }],
  ['イ', { name: 'katakana.iroha', system: () => bijective(chars('イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス')) }],
  ['ㄱ', { name: 'korean.jamo', system: () => bijective(chars('ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ')) }],
  ['가', { name: 'korean.syllable', system: () => bijective(chars('가나다라마바사아자차카타파하')) }],
  ['١', { name: 'arabic.eastern', system: () => positional('٠١٢٣٤٥٦٧٨٩') }],
  ['أ', { name: 'arabic.abjad', system: () => bijective(words('أ ب ج د ه‍ و ز ح ط ي ك ل م ن س ع ف ص ق ر ش ت ث خ ذ ض ظ غ')) }],
  ['۱', { name: 'persian', system: () => positional('۰۱۲۳۴۵۶۷۸۹') }],
  ['१', { name: 'devanagari', system: () => positional('०१२३४५६७८९') }],
  ['༡', { name: 'tibetan', system: () => positional('༠༡༢༣༤༥༦༧༨༩') }],
  ['১', { name: 'bengali', system: () => positional('০১২৩৪৫৬৭৮৯') }],
  ['ক', { name: 'bengali.letter', system: () => bijective(chars('কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহ')) }],
  ['*', { name: 'symbol', system: () => ({ kind: 'symbolic', symbols: chars('*†‡§¶‖') }) }],
]);

/** Writes a number in a numeral system, like codex's `represent`. */
export function represent(named: Named, n: number): string {
  const system = named.system();
  const zero = () => bail(`the numeral system \`${named.name}\` cannot represent zero`);
  const tooLarge = () => bail(`the number ${n} is too large to be represented with the \`${named.name}\` numeral system`);
  switch (system.kind) {
    case 'positional': {
      const radix = system.symbols.length;
      let out = '';
      do {
        out = system.symbols[n % radix]! + out;
        n = Math.floor(n / radix);
      } while (n > 0);
      return out;
    }
    case 'bijective': {
      if (n === 0) zero();
      const radix = system.symbols.length;
      let out = '';
      while (n > 0) {
        n--;
        out = system.symbols[n % radix]! + out;
        n = Math.floor(n / radix);
      }
      return out;
    }
    case 'additive': {
      const last = system.numerals.at(-1)!;
      if (n === 0) return last[1] === 0 ? last[0] : zero();
      let out = '';
      for (const [numeral, weight] of system.numerals) {
        if (weight === 0 || weight > n) continue;
        const reps = Math.floor(n / weight);
        out += numeral.repeat(reps);
        n -= weight * reps;
      }
      return out;
    }
    case 'symbolic': {
      if (n === 0) zero();
      const count = system.symbols.length;
      return system.symbols[(n - 1) % count]!.repeat(Math.ceil(n / count));
    }
    case 'fixed':
      return n < system.symbols.length ? system.symbols[n]! : tooLarge();
    case 'zerolessFixed':
      if (n === 0) zero();
      return n <= system.symbols.length ? system.symbols[n - 1]! : tooLarge();
    case 'chinese':
      return unsupported(null, 'Chinese numbering');
  }
}

