/**
 * Difficulty is not a dimension of this game. Every snippet is generated at
 * the same density, and the only thing the player chooses is how many lines
 * they want. These numbers are meant to be tuned by reading output, not
 * reasoned about.
 */
export interface GeneratorConfig {
  /** How deeply blocks may nest. 0 means no blocks at all. */
  maxDepth: number;
  /** Probability that a statement is a block rather than a single line. */
  blockChance: number;
  /** Probability of referencing a visible variable instead of a literal. */
  reuseRate: number;
  /** Probability that an expression is a binary operation. */
  operatorChance: number;
  /** Statements per block body, inclusive. */
  bodyStatements: readonly [min: number, max: number];
  intMax: number;
  /** Doubles are generated as tenths, so 999 renders as 99.9. */
  doubleTenthsMax: number;
  stringLength: readonly [min: number, max: number];
  identifiers: readonly string[];
}

/**
 * Statement kinds a language does not have, switched off before generation
 * rather than patched up in the printer. This is the only thing that makes
 * generation language-aware; the tree is otherwise language-agnostic.
 */
export interface LanguageCapabilities {
  /** Python has no do-while, and no spelling of one that reads as Python. */
  doWhile: boolean;
}

const IDENTIFIERS = [
  'n',
  'count',
  'total',
  'idx',
  'buf',
  'tag',
  'rate',
  'size',
  'step',
  'flag',
  'name',
  'limit',
  'delta',
  'score',
  'mode',
  'ok',
  'done',
  'valid',
] as const;

/**
 * The one density every snippet is generated at. These are the values the old
 * `medium` tier carried: the tuned middle, and the only setting whose output
 * has been read across a corpus.
 */
export const CONFIG: GeneratorConfig = {
  maxDepth: 2,
  blockChance: 0.55,
  reuseRate: 0.6,
  operatorChance: 0.45,
  bodyStatements: [1, 3],
  intMax: 99,
  doubleTenthsMax: 999,
  stringLength: [2, 3],
  identifiers: IDENTIFIERS,
};

/**
 * Lengths the leaderboards are split by. A player may type any line count they
 * like, but only runs at one of these are ranked — an arbitrary length would
 * give every run a board of its own.
 */
export const LINE_PRESETS = [10, 20, 35] as const;
export type LinePreset = (typeof LINE_PRESETS)[number];

export function isLinePreset(lines: number): lines is LinePreset {
  return (LINE_PRESETS as readonly number[]).includes(lines);
}
