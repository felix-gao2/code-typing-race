/**
 * Difficulty is derived from config, never measured. Tiers are named presets
 * because snippet identity includes the tier — a freeform config object would
 * fragment identity across arbitrary settings.
 *
 * These numbers are meant to be tuned by reading output, not reasoned about.
 */
export interface GeneratorConfig {
  /** Rendered characters, after which top-level generation stops. */
  charBudget: number;
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

export type Tier = 'easy' | 'medium' | 'hard';

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

export const TIERS: Record<Tier, GeneratorConfig> = {
  easy: {
    charBudget: 180,
    maxDepth: 1,
    blockChance: 0.25,
    reuseRate: 0.4,
    operatorChance: 0.2,
    bodyStatements: [1, 2],
    intMax: 40,
    doubleTenthsMax: 200,
    stringLength: [2, 3],
    identifiers: IDENTIFIERS,
  },
  medium: {
    charBudget: 260,
    maxDepth: 2,
    blockChance: 0.4,
    reuseRate: 0.6,
    operatorChance: 0.45,
    bodyStatements: [1, 3],
    intMax: 99,
    doubleTenthsMax: 999,
    stringLength: [2, 3],
    identifiers: IDENTIFIERS,
  },
  hard: {
    charBudget: 340,
    maxDepth: 3,
    blockChance: 0.5,
    reuseRate: 0.75,
    operatorChance: 0.65,
    bodyStatements: [2, 3],
    intMax: 99,
    doubleTenthsMax: 999,
    stringLength: [2, 4],
    identifiers: IDENTIFIERS,
  },
};
