import { describe, expect, it } from 'vitest';
import { TIERS, type Tier } from './config.ts';
import { generateSnippet } from './index.ts';

const TIER_NAMES: Tier[] = ['easy', 'medium', 'hard'];
const SEEDS = Array.from({ length: 300 }, (_, i) => i);

function everySnippet(): { tier: Tier; seed: number; text: string }[] {
  return TIER_NAMES.flatMap((tier) =>
    SEEDS.map((seed) => ({ tier, seed, text: generateSnippet({ seed, language: 'java', tier }) })),
  );
}

describe('generateSnippet', () => {
  it('is deterministic for a given seed', () => {
    for (const tier of TIER_NAMES) {
      for (const seed of [0, 1, 7, 99, 12345]) {
        const first = generateSnippet({ seed, language: 'java', tier });
        const second = generateSnippet({ seed, language: 'java', tier });
        expect(second).toBe(first);
      }
    }
  });

  it('gives different seeds different text', () => {
    const texts = SEEDS.slice(0, 50).map((seed) =>
      generateSnippet({ seed, language: 'java', tier: 'medium' }),
    );
    expect(new Set(texts).size).toBe(texts.length);
  });

  /**
   * These two are the version tripwire: if generated output changes at all,
   * these fail, and GENERATOR_VERSION has to be bumped in the same commit.
   */
  it('matches the pinned output for seed 1, easy', () => {
    expect(generateSnippet({ seed: 1, language: 'java', tier: 'easy' })).toBe(
      [
        'double valid = 11.7;',
        'String size = "lrf";',
        'int count = 5;',
        'valid = 7.1 - 9.6;',
        '',
        'if (count >= 10) {',
        '    valid *= 12.0;',
        '}',
        '',
        'while (valid <= 5.0) {',
        '    count = 5;',
        '    valid += 0.6;',
        '}',
        '',
        'System.out.println(count);',
      ].join('\n'),
    );
  });

  it('matches the pinned output for seed 42, medium', () => {
    expect(generateSnippet({ seed: 42, language: 'java', tier: 'medium' })).toBe(
      [
        'String delta = "nj";',
        'int buf = 1;',
        '',
        'while (buf < 3) {',
        '    buf -= 1;',
        '    for (int i = 0; i < 4; i++) {',
        '        delta = "wsh";',
        '        buf += 6;',
        '    }',
        '    double rate = 5.8;',
        '}',
        '',
        'delta = "ja0";',
        'buf += 8;',
        'boolean score = buf > 1;',
        'System.out.println(delta);',
        'buf = 5 * 11;',
      ].join('\n'),
    );
  });
});

describe('generated Java', () => {
  it('balances braces', () => {
    for (const { text, tier, seed } of everySnippet()) {
      let depth = 0;
      for (const char of text) {
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        expect(depth, `${tier}/${seed} closed a brace that was never opened`).toBeGreaterThanOrEqual(0);
      }
      expect(depth, `${tier}/${seed} left a brace open`).toBe(0);
    }
  });

  it('never emits an empty block body', () => {
    for (const { text, tier, seed } of everySnippet()) {
      expect(/\{\s*\n\s*\}/.test(text), `${tier}/${seed} has an empty body`).toBe(false);
    }
  });

  it('ends every line with a semicolon or a brace', () => {
    for (const { text, tier, seed } of everySnippet()) {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        expect(line.trim(), `${tier}/${seed}`).toMatch(/[;{}]$/);
      }
    }
  });

  it('indents in multiples of four', () => {
    for (const { text, tier, seed } of everySnippet()) {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const lead = line.length - line.trimStart().length;
        expect(lead % 4, `${tier}/${seed}`).toBe(0);
      }
    }
  });

  it('stays within a quarter of the tier budget', () => {
    for (const { text, tier, seed } of everySnippet()) {
      expect(text.length, `${tier}/${seed} overshot`).toBeLessThanOrEqual(
        TIERS[tier].charBudget * 1.25,
      );
      expect(text.length, `${tier}/${seed} undershot`).toBeGreaterThanOrEqual(
        TIERS[tier].charBudget * 0.9,
      );
    }
  });

  it('never assigns a variable to itself', () => {
    for (const { text, tier, seed } of everySnippet()) {
      for (const line of text.split('\n')) {
        expect(line.trim(), `${tier}/${seed}`).not.toMatch(/^(\w+) = \1;$/);
      }
    }
  });

  it('never compares a variable with itself', () => {
    for (const { text, tier, seed } of everySnippet()) {
      const matches = text.matchAll(/\((\w+) (?:[<>]=?|[=!]=) (\w+)\)/g);
      for (const match of matches) {
        expect(match[1], `${tier}/${seed}: ${match[0]}`).not.toBe(match[2]);
      }
    }
  });

  it('declares every variable it references', () => {
    for (const { text, tier, seed } of everySnippet()) {
      const declared = new Set<string>();
      for (const match of text.matchAll(/(?:int|double|boolean|String) (\w+) =/g)) {
        const name = match[1];
        if (name !== undefined) declared.add(name);
      }
      for (const match of text.matchAll(/for \(int (\w+) = 0;/g)) {
        const name = match[1];
        if (name !== undefined) declared.add(name);
      }
      // Anything used as an assignment target must have been declared.
      for (const match of text.matchAll(/^\s*(\w+) (?:=|\+=|-=|\*=) /gm)) {
        const name = match[1];
        if (name !== undefined) {
          expect(declared.has(name), `${tier}/${seed}: ${name} assigned but never declared`).toBe(
            true,
          );
        }
      }
    }
  });
});
