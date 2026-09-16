import { describe, expect, it } from 'vitest';
import { TIERS, type Tier } from './config.ts';
import { generateSnippet, LANGUAGES, type Language } from './index.ts';

const TIER_NAMES: Tier[] = ['easy', 'medium', 'hard'];
const SEEDS = Array.from({ length: 300 }, (_, i) => i);

function everySnippet(language: Language): { tier: Tier; seed: number; text: string }[] {
  return TIER_NAMES.flatMap((tier) =>
    SEEDS.map((seed) => ({ tier, seed, text: generateSnippet({ seed, language, tier }) })),
  );
}

describe('generateSnippet', () => {
  it('is deterministic for a given seed', () => {
    for (const language of LANGUAGES) {
      for (const tier of TIER_NAMES) {
        for (const seed of [0, 1, 7, 99, 12345]) {
          const first = generateSnippet({ seed, language, tier });
          const second = generateSnippet({ seed, language, tier });
          expect(second, `${language}/${tier}/${seed}`).toBe(first);
        }
      }
    }
  });

  it('gives different seeds different text', () => {
    for (const language of LANGUAGES) {
      const texts = SEEDS.slice(0, 50).map((seed) =>
        generateSnippet({ seed, language, tier: 'medium' }),
      );
      expect(new Set(texts).size, language).toBe(texts.length);
    }
  });

  /**
   * These are the version tripwire: if generated output changes at all, they
   * fail, and GENERATOR_VERSION has to be bumped in the same commit.
   */
  it('matches the pinned Java output for seed 1, easy', () => {
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

  it('matches the pinned Java output for seed 42, medium', () => {
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

  it('matches the pinned TypeScript output for seed 1, easy', () => {
    expect(generateSnippet({ seed: 1, language: 'typescript', tier: 'easy' })).toBe(
      [
        'let valid = 11.7;',
        'let size = "lrf";',
        'let count = 5;',
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
        'console.log(count);',
      ].join('\n'),
    );
  });

  it('matches the pinned TypeScript output for seed 45, medium', () => {
    expect(generateSnippet({ seed: 45, language: 'typescript', tier: 'medium' })).toBe(
      [
        'let rate = "mb";',
        'let limit = false;',
        'let ok = 10;',
        'rate = "brg";',
        '',
        'do {',
        '    while (ok === 8) {',
        '        limit = true;',
        '        ok -= 1;',
        '    }',
        '    rate = "q7";',
        '    ok += 5;',
        '} while (ok < 1);',
        '',
        'limit = ok !== 12;',
        '',
        'do {',
        '    let step = 7.9;',
        '    ok -= 2;',
        '} while (ok <= 5);',
      ].join('\n'),
    );
  });
});

/**
 * Both printers target brace-and-semicolon languages, so every structural
 * invariant below holds for either one. Python will need its own set.
 */
describe.each(LANGUAGES)('generated %s', (language) => {
  const snippets = everySnippet(language);

  it('balances braces', () => {
    for (const { text, tier, seed } of snippets) {
      let depth = 0;
      for (const char of text) {
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        expect(
          depth,
          `${tier}/${seed} closed a brace that was never opened`,
        ).toBeGreaterThanOrEqual(0);
      }
      expect(depth, `${tier}/${seed} left a brace open`).toBe(0);
    }
  });

  it('never emits an empty block body', () => {
    for (const { text, tier, seed } of snippets) {
      expect(/\{\s*\n\s*\}/.test(text), `${tier}/${seed} has an empty body`).toBe(false);
    }
  });

  it('ends every line with a semicolon or a brace', () => {
    for (const { text, tier, seed } of snippets) {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        expect(line.trim(), `${tier}/${seed}`).toMatch(/[;{}]$/);
      }
    }
  });

  it('indents in multiples of four', () => {
    for (const { text, tier, seed } of snippets) {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const lead = line.length - line.trimStart().length;
        expect(lead % 4, `${tier}/${seed}`).toBe(0);
      }
    }
  });

  it('stays within a quarter of the tier budget', () => {
    for (const { text, tier, seed } of snippets) {
      expect(text.length, `${tier}/${seed} overshot`).toBeLessThanOrEqual(
        TIERS[tier].charBudget * 1.25,
      );
      expect(text.length, `${tier}/${seed} undershot`).toBeGreaterThanOrEqual(
        TIERS[tier].charBudget * 0.9,
      );
    }
  });

  it('never assigns a variable to itself', () => {
    for (const { text, tier, seed } of snippets) {
      for (const line of text.split('\n')) {
        expect(line.trim(), `${tier}/${seed}`).not.toMatch(/^(\w+) = \1;$/);
      }
    }
  });

  it('never compares a variable with itself', () => {
    for (const { text, tier, seed } of snippets) {
      const matches = text.matchAll(/\((\w+) (?:[<>]=?|[=!]==?) (\w+)\)/g);
      for (const match of matches) {
        expect(match[1], `${tier}/${seed}: ${match[0]}`).not.toBe(match[2]);
      }
    }
  });

  it('declares every variable it references', () => {
    // Declarations are the one shape that differs: a Java type name versus
    // `let`. Loop counters are declared in the for-header either way.
    const declaration =
      language === 'java' ? /(?:int|double|boolean|String) (\w+) =/g : /\blet (\w+) =/g;
    const counter = language === 'java' ? /for \(int (\w+) = 0;/g : /for \(let (\w+) = 0;/g;

    for (const { text, tier, seed } of snippets) {
      const declared = new Set<string>();
      for (const match of text.matchAll(declaration)) {
        const name = match[1];
        if (name !== undefined) declared.add(name);
      }
      for (const match of text.matchAll(counter)) {
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

describe('the TypeScript printer', () => {
  const snippets = everySnippet('typescript');

  it('never emits loose equality', () => {
    for (const { text, tier, seed } of snippets) {
      // Matches == and != while stepping over the === and !== containing them.
      expect(text, `${tier}/${seed}`).not.toMatch(/[^=!<>]==[^=]|![=][^=]/);
    }
  });

  it('emits strict equality somewhere across the corpus', () => {
    // Without this, the test above would also pass if the printer stopped
    // emitting equality comparisons altogether.
    expect(snippets.some(({ text }) => /[=!]==/.test(text))).toBe(true);
  });

  it('never leaks Java syntax', () => {
    for (const { text, tier, seed } of snippets) {
      expect(text, `${tier}/${seed}`).not.toMatch(
        /\bSystem\.out\b|^\s*(?:int|double|String) \w+ =/m,
      );
    }
  });
});
