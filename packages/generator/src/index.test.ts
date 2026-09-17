import { describe, expect, it } from 'vitest';
import { generateSnippet, LANGUAGES, type Language } from './index.ts';

/**
 * Languages that spell a block with braces and end a statement with a
 * semicolon. Python does neither, which is the point of keeping the list.
 */
const BRACE_LANGUAGES = ['java', 'typescript'] as const;

const DECLARATION_PATTERNS: Record<
  (typeof BRACE_LANGUAGES)[number],
  { declaration: RegExp; counter: RegExp }
> = {
  java: {
    declaration: /(?:int|double|boolean|String) (\w+) =/g,
    counter: /for \(int (\w+) = 0;/g,
  },
  typescript: {
    declaration: /\blet (\w+) =/g,
    counter: /for \(let (\w+) = 0;/g,
  },
};

const LINE_COUNTS = [10, 20, 35];
const SEEDS = Array.from({ length: 300 }, (_, i) => i);

function everySnippet(language: Language): { lines: number; seed: number; text: string }[] {
  return LINE_COUNTS.flatMap((lines) =>
    SEEDS.map((seed) => ({ lines, seed, text: generateSnippet({ seed, language, lines }) })),
  );
}

describe('generateSnippet', () => {
  it('is deterministic for a given seed', () => {
    for (const language of LANGUAGES) {
      for (const lines of LINE_COUNTS) {
        for (const seed of [0, 1, 7, 99, 12345]) {
          const first = generateSnippet({ seed, language, lines });
          const second = generateSnippet({ seed, language, lines });
          expect(second, `${language}/${lines}/${seed}`).toBe(first);
        }
      }
    }
  });

  it('gives different seeds different text', () => {
    for (const language of LANGUAGES) {
      const texts = SEEDS.slice(0, 50).map((seed) =>
        generateSnippet({ seed, language, lines: 20 }),
      );
      expect(new Set(texts).size, language).toBe(texts.length);
    }
  });

  /**
   * These are the version tripwire: if generated output changes at all, they
   * fail, and GENERATOR_VERSION has to be bumped in the same commit.
   */
  it('matches the pinned Java output for seed 1, 10 lines', () => {
    expect(generateSnippet({ seed: 1, language: 'java', lines: 10 })).toBe(
      [
        'double valid = 11.7;',
        'String size = "lrf";',
        'int count = 5;',
        'valid = 7.1 - 9.6;',
        '',
        'if (count >= 10) {',
        '    System.out.println(count);',
        '}',
        '',
        'boolean buf = false;',
      ].join('\n'),
    );
  });

  it('matches the pinned Java output for seed 42, 20 lines', () => {
    expect(generateSnippet({ seed: 42, language: 'java', lines: 20 })).toBe(
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
        'for (int i = 0; i < buf; i++) {',
        '    do {',
        '        System.out.println(delta);',
        '        buf -= 9;',
        '    } while (i != buf);',
        '    buf -= i;',
        '    delta = "xl2";',
        '}',
      ].join('\n'),
    );
  });

  it('matches the pinned TypeScript output for seed 1, 10 lines', () => {
    expect(generateSnippet({ seed: 1, language: 'typescript', lines: 10 })).toBe(
      [
        'let valid = 11.7;',
        'let size = "lrf";',
        'let count = 5;',
        'valid = 7.1 - 9.6;',
        '',
        'if (count >= 10) {',
        '    console.log(count);',
        '}',
        '',
        'let buf = false;',
      ].join('\n'),
    );
  });

  it('matches the pinned TypeScript output for seed 45, 20 lines', () => {
    expect(generateSnippet({ seed: 45, language: 'typescript', lines: 20 })).toBe(
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

  it('matches the pinned Python output for seed 1, 10 lines', () => {
    expect(generateSnippet({ seed: 1, language: 'python', lines: 10 })).toBe(
      [
        'valid = 11.7',
        'size = "lrf"',
        'count = 5',
        'valid = 7.1 - 9.6',
        '',
        'if count >= 10:',
        '    print(count)',
        '',
        'buf = False',
        'size = "y7y"',
      ].join('\n'),
    );
  });

  it('matches the pinned Python output for seed 42, 20 lines', () => {
    expect(generateSnippet({ seed: 42, language: 'python', lines: 20 })).toBe(
      [
        'delta = "nj"',
        'buf = 1',
        '',
        'for i in range(2):',
        '    print(i)',
        '',
        'for i in range(buf):',
        '    buf = 11 - i',
        '    delta = "ry7"',
        '',
        'while buf != 2:',
        '    if buf >= 11:',
        '        print(buf)',
        '    buf += 9',
        '',
        'size = 5.3',
        'buf = 98',
        'limit = "pmq"',
        'size -= 11.3',
        'print(buf)',
      ].join('\n'),
    );
  });
});

/**
 * Invariants that hold whatever the syntax is. Anything mentioning a brace or
 * a semicolon belongs in the brace-language block below, not here — Python is
 * in this list and has neither.
 */
describe.each(LANGUAGES)('generated %s', (language) => {
  const snippets = everySnippet(language);

  it('indents in multiples of four', () => {
    for (const { text, lines, seed } of snippets) {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const lead = line.length - line.trimStart().length;
        expect(lead % 4, `${lines}/${seed}`).toBe(0);
      }
    }
  });

  it('never indents by more than one level at a time', () => {
    // Free in a braced language; in Python a skipped level is a syntax error.
    for (const { text, lines, seed } of snippets) {
      let previous = 0;
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        const lead = (line.length - line.trimStart().length) / 4;
        expect(lead, `${lines}/${seed}: jumped from ${previous} to ${lead}`).toBeLessThanOrEqual(
          previous + 1,
        );
        previous = lead;
      }
    }
  });

  it('lands on exactly the requested line count', () => {
    for (const { text, lines, seed } of snippets) {
      expect(text.split('\n').length, `${lines}/${seed}`).toBe(lines);
    }
  });

  it('never assigns a variable to itself', () => {
    for (const { text, lines, seed } of snippets) {
      for (const line of text.split('\n')) {
        // The semicolon is optional so this still bites in Python.
        expect(line.trim(), `${lines}/${seed}`).not.toMatch(/^(\w+) = \1;?$/);
      }
    }
  });

  it('never compares a variable with itself', () => {
    for (const { text, lines, seed } of snippets) {
      // Paren-free, because Python conditions have no parentheses to anchor on.
      const matches = text.matchAll(/(\w+) (?:[<>]=?|[=!]==?) (\w+)/g);
      for (const match of matches) {
        expect(match[1], `${lines}/${seed}: ${match[0]}`).not.toBe(match[2]);
      }
    }
  });
});

/** Everything below is specific to how a language spells a block. */
describe.each(BRACE_LANGUAGES)('generated %s', (language) => {
  const snippets = everySnippet(language);

  it('balances braces', () => {
    for (const { text, lines, seed } of snippets) {
      let depth = 0;
      for (const char of text) {
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        expect(
          depth,
          `${lines}/${seed} closed a brace that was never opened`,
        ).toBeGreaterThanOrEqual(0);
      }
      expect(depth, `${lines}/${seed} left a brace open`).toBe(0);
    }
  });

  it('never emits an empty block body', () => {
    for (const { text, lines, seed } of snippets) {
      expect(/\{\s*\n\s*\}/.test(text), `${lines}/${seed} has an empty body`).toBe(false);
    }
  });

  it('ends every line with a semicolon or a brace', () => {
    for (const { text, lines, seed } of snippets) {
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue;
        expect(line.trim(), `${lines}/${seed}`).toMatch(/[;{}]$/);
      }
    }
  });

  it('declares every variable it references', () => {
    // Declarations are the one shape that differs: a Java type name versus
    // `let`. Loop counters are declared in the for-header either way.
    const { declaration, counter } = DECLARATION_PATTERNS[language];

    for (const { text, lines, seed } of snippets) {
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
          expect(declared.has(name), `${lines}/${seed}: ${name} assigned but never declared`).toBe(
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
    for (const { text, lines, seed } of snippets) {
      // Matches == and != while stepping over the === and !== containing them.
      expect(text, `${lines}/${seed}`).not.toMatch(/[^=!<>]==[^=]|![=][^=]/);
    }
  });

  it('emits strict equality somewhere across the corpus', () => {
    // Without this, the test above would also pass if the printer stopped
    // emitting equality comparisons altogether.
    expect(snippets.some(({ text }) => /[=!]==/.test(text))).toBe(true);
  });

  it('never emits a whole-number double literal', () => {
    // `12.0` is decoration in TypeScript, where inference makes `12` the same
    // number. Java keeps the suffix, so this assertion is TypeScript-only.
    for (const { text, lines, seed } of snippets) {
      expect(text, `${lines}/${seed}`).not.toMatch(/\d+\.0(?!\d)/);
    }
  });

  it('still emits fractional double literals across the corpus', () => {
    // Without this, the test above would also pass if doubles disappeared.
    expect(snippets.some(({ text }) => /\d+\.[1-9]/.test(text))).toBe(true);
  });

  it('never leaks Java syntax', () => {
    for (const { text, lines, seed } of snippets) {
      expect(text, `${lines}/${seed}`).not.toMatch(
        /\bSystem\.out\b|^\s*(?:int|double|String) \w+ =/m,
      );
    }
  });
});

describe('the Python printer', () => {
  const snippets = everySnippet('python');

  it('never reads a name before assigning it', () => {
    // Python declares by assigning, so "declared before use" is an ordering
    // property rather than a keyword to grep for.
    const KEYWORDS = new Set(['if', 'while', 'for', 'in', 'range', 'print', 'True', 'False']);

    for (const { text, lines, seed } of snippets) {
      const assigned = new Set<string>();

      for (const raw of text.split('\n')) {
        if (raw.trim() === '') continue;
        // String contents are not identifiers.
        const line = raw.replace(/"[^"]*"/g, '""');

        const loop = /^\s*for (\w+) in range\((.*)\):$/.exec(line);
        const assignment = /^\s*(\w+) (=|\+=|-=|\*=) (.*)$/.exec(line);
        const read = loop?.[2] ?? assignment?.[3] ?? line;

        for (const match of read.matchAll(/[A-Za-z_]\w*/g)) {
          const name = match[0];
          if (KEYWORDS.has(name)) continue;
          expect(
            assigned.has(name),
            `${lines}/${seed}: ${name} read before assignment in ${line.trim()}`,
          ).toBe(true);
        }

        const target = assignment?.[1];
        if (target !== undefined) {
          // `x += 1` reads x as well as writing it.
          if (assignment?.[2] !== '=') {
            expect(
              assigned.has(target),
              `${lines}/${seed}: ${target} compounded before assignment`,
            ).toBe(true);
          }
          assigned.add(target);
        }

        const counter = loop?.[1];
        if (counter !== undefined) assigned.add(counter);
      }
    }
  });

  it('never emits a brace, a semicolon or a do-while', () => {
    for (const { text, lines, seed } of snippets) {
      // A generated string can spell a keyword by chance — easy/248 produces
      // "do" — so quote contents come out before the keyword check.
      const code = text.replace(/"[^"]*"/g, '""');
      expect(code, `${lines}/${seed}`).not.toMatch(/[{};]/);
      expect(code, `${lines}/${seed}`).not.toMatch(/\bdo\b/);
    }
  });

  it('opens every block with a colon and an indented body', () => {
    // Without this, the test above would also pass on a program with no blocks.
    let blocks = 0;

    for (const { text, lines, seed } of snippets) {
      const rows = text.split('\n');
      rows.forEach((line, index) => {
        if (!line.trimEnd().endsWith(':')) return;
        blocks += 1;
        const lead = line.length - line.trimStart().length;
        const next = rows[index + 1];
        expect(next, `${lines}/${seed}: block header is the last line`).toBeDefined();
        const nextLead = next === undefined ? -1 : next.length - next.trimStart().length;
        expect(nextLead, `${lines}/${seed}: ${line.trim()} has no indented body`).toBe(lead + 4);
      });
    }

    expect(blocks).toBeGreaterThan(0);
  });

  it('never leaks Java or TypeScript syntax', () => {
    for (const { text, lines, seed } of snippets) {
      // Same hazard as above: a string could spell `true`.
      const code = text.replace(/"[^"]*"/g, '""');
      expect(code, `${lines}/${seed}`).not.toMatch(
        /\bSystem\.out\b|\bconsole\.log\b|\blet \w+ =|\b(?:true|false)\b/,
      );
    }
  });

  it('emits Python booleans somewhere across the corpus', () => {
    // Without this, the leak test above would pass if booleans vanished.
    expect(snippets.some(({ text }) => /\b(?:True|False)\b/.test(text))).toBe(true);
  });
});
