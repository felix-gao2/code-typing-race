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
        'double weight = 11.7;',
        'String name = "lrf";',
        'int n = 5;',
        'weight = 29.5;',
        '',
        'for (int i = 0; i < n; i++) {',
        '    System.out.println(i);',
        '}',
        '',
        'n = 12;',
      ].join('\n'),
    );
  });

  it('matches the pinned Java output for seed 42, 20 lines', () => {
    expect(generateSnippet({ seed: 42, language: 'java', lines: 20 })).toBe(
      [
        'String label = "nj";',
        'int total = 1;',
        '',
        'while (total < 3) {',
        '    total -= 1;',
        '    for (int i = 0; i < 4; i++) {',
        '        label = "wsh";',
        '        total += 6;',
        '    }',
        '    double average = 5.8;',
        '}',
        '',
        'for (int i = 0; i < total; i++) {',
        '    do {',
        '        System.out.println(label);',
        '        total -= 9;',
        '    } while (i != total);',
        '    total -= i;',
        '    label = "xl2";',
        '}',
      ].join('\n'),
    );
  });

  it('matches the pinned TypeScript output for seed 1, 10 lines', () => {
    expect(generateSnippet({ seed: 1, language: 'typescript', lines: 10 })).toBe(
      [
        'let weight = 11.7;',
        'let name = "lrf";',
        'let n = 5;',
        'weight = 29.5;',
        '',
        'for (let i = 0; i < n; i++) {',
        '    console.log(i);',
        '}',
        '',
        'n = 12;',
      ].join('\n'),
    );
  });

  it('matches the pinned TypeScript output for seed 45, 20 lines', () => {
    expect(generateSnippet({ seed: 45, language: 'typescript', lines: 20 })).toBe(
      [
        'let name = "mb";',
        'let valid = false;',
        'let score = 10;',
        'name = "brg";',
        '',
        'do {',
        '    while (score === 8) {',
        '        valid = true;',
        '        score -= 1;',
        '    }',
        '    console.log(name);',
        '    score += 8;',
        '} while (score < 1);',
        '',
        'valid = score >= 2;',
        'name = "nn4";',
        '',
        'for (let i = 0; i < 9; i++) {',
        '    name = "noi";',
        '}',
      ].join('\n'),
    );
  });

  it('matches the pinned Python output for seed 1, 10 lines', () => {
    expect(generateSnippet({ seed: 1, language: 'python', lines: 10 })).toBe(
      [
        'weight = 11.7',
        'name = "lrf"',
        'n = 5',
        'weight = 29.5',
        '',
        'for i in range(n):',
        '    print(i)',
        '',
        'n = 12',
        'weight = 86.5',
      ].join('\n'),
    );
  });

  it('matches the pinned Python output for seed 42, 20 lines', () => {
    expect(generateSnippet({ seed: 42, language: 'python', lines: 20 })).toBe(
      [
        'label = "nj"',
        'total = 1',
        '',
        'for i in range(2):',
        '    print(i)',
        '',
        'for i in range(total):',
        '    total = 11 - i',
        '    label = "ry7"',
        '',
        'while total != 2:',
        '    if total >= 11:',
        '        print(label)',
        '    total += 9',
        '',
        'average = 5.3',
        'total = 98',
        'mode = "pmq"',
        'average -= 11.3',
        'total *= 2',
      ].join('\n'),
    );
  });

  /**
   * A seventh, eighth and ninth pin, chosen for what they contain rather
   * than picked at random like the six above.
   *
   * The six were not enough: the float-equality fix moved 1227 lines of
   * corpus output without touching one of them, because not one held a
   * double comparison. These were selected by scoring every seed under 600
   * for construct coverage and taking the best. Between them they hold a
   * double compared by ordering, a modulus, a do-while, two levels of
   * nesting, a compound assignment, a boolean declaration and a print.
   * Python has no do-while, so its pin is the best of the rest.
   */
  it('matches the pinned Java output for seed 153, 35 lines', () => {
    expect(generateSnippet({ seed: 153, language: 'java', lines: 35 })).toBe(
      [
        'int n = 8;',
        'double rate = 8.7;',
        '',
        'for (int i = 0; i < 3; i++) {',
        '    n = 7 % i;',
        '    rate = 11.4;',
        '    for (int j = 0; j < n; j++) {',
        '        n = 20;',
        '    }',
        '}',
        '',
        'for (int i = 0; i < 5; i++) {',
        '    System.out.println(i);',
        '    do {',
        '        n += i;',
        '        boolean ok = false;',
        '        rate += 2.5;',
        '    } while (n != 10);',
        '}',
        '',
        'if (n > 4) {',
        '    String text = "bn1";',
        '    n *= 3;',
        '}',
        '',
        'n -= 2;',
        '',
        'if (rate > 7.4) {',
        '    System.out.println(n);',
        '}',
        '',
        'rate = 56.8;',
        'n -= 7;',
        'boolean valid = rate <= 5.4;',
        'rate = 0.4;',
      ].join('\n'),
    );
  });

  it('matches the pinned TypeScript output for seed 153, 35 lines', () => {
    expect(generateSnippet({ seed: 153, language: 'typescript', lines: 35 })).toBe(
      [
        'let n = 8;',
        'let rate = 8.7;',
        '',
        'for (let i = 0; i < 3; i++) {',
        '    n = 7 % i;',
        '    rate = 11.4;',
        '    for (let j = 0; j < n; j++) {',
        '        n = 20;',
        '    }',
        '}',
        '',
        'for (let i = 0; i < 5; i++) {',
        '    console.log(i);',
        '    do {',
        '        n += i;',
        '        let ok = false;',
        '        rate += 2.5;',
        '    } while (n !== 10);',
        '}',
        '',
        'if (n > 4) {',
        '    let text = "bn1";',
        '    n *= 3;',
        '}',
        '',
        'n -= 2;',
        '',
        'if (rate > 7.4) {',
        '    console.log(n);',
        '}',
        '',
        'rate = 56.8;',
        'n -= 7;',
        'let valid = rate <= 5.4;',
        'rate = 0.4;',
      ].join('\n'),
    );
  });

  it('matches the pinned Python output for seed 131, 20 lines', () => {
    expect(generateSnippet({ seed: 131, language: 'python', lines: 20 })).toBe(
      [
        'n = 3',
        'factor = 0.7',
        '',
        'for i in range(n):',
        '    if factor >= 9.4:',
        '        print(i)',
        '        done = factor > 0.9',
        '        n += 8',
        '    if factor >= 0.2:',
        '        factor = 61.1',
        '        n = 97',
        '        mode = "a91"',
        '    for j in range(12):',
        '        n = 6 % j',
        '',
        'prefix = "uv5"',
        '',
        'for i in range(8):',
        '    prefix = "az"',
        '    factor *= 7.8',
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

  it('leaves fewer than 37% of its variables unread', () => {
    // A ratchet, not a law: real code has some write-only variables, so the
    // target is not zero. It was 51% before the repair pass, 40% after it, and
    // is 35% now that generation stops declaring a variable while one is still
    // unread. This exists so it cannot quietly climb back.
    let declared = 0;
    let unread = 0;
    for (const { text } of snippets) {
      // String contents are not code.
      const rows = text.split('\n').map((line) =>
        line
          .split('"')
          .filter((_, i) => i % 2 === 0)
          .join(' '),
      );
      const names = new Set<string>();
      for (const row of rows) {
        const found = /^\s*(?:int|double|boolean|String|let)?\s*([a-z]\w*) = /.exec(row);
        if (found?.[1] !== undefined) names.add(found[1]);
      }
      for (const name of names) {
        const word = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`);
        declared += 1;
        const read = rows.some((row) => {
          const target = /^\s*(?:int|double|boolean|String|let)?\s*([a-z]\w*) (?:=|[-+*]=) /.exec(
            row,
          );
          // Everything right of the `=` is a read; so is the whole row when
          // the row is writing some other variable.
          if (word.test(target === null ? row : row.slice(row.indexOf('=') + 1))) return true;
          return target?.[1] !== undefined && target[1] !== name && word.test(row);
        });
        if (!read) unread += 1;
      }
    }
    expect(unread / declared, `${unread} of ${declared}`).toBeLessThan(0.37);
  });

  it('never does arithmetic on two literals', () => {
    // `limit = 12 - 7;` is a constant with extra steps: a compiler folds it
    // and so does a reader. Arithmetic should be about something.
    for (const { text, lines, seed } of snippets) {
      for (const line of text.split('\n')) {
        // String contents are not expressions.
        const code = line
          .split('"')
          .filter((_, i) => i % 2 === 0)
          .join(' ');
        expect(code, `${lines}/${seed}`).not.toMatch(
          /(?:^|[^\w.])\d+(?:\.\d+)? [-+*%] \d+(?:\.\d+)?(?![\w.])/,
        );
      }
    }
  });

  it('still does arithmetic on a variable across the corpus', () => {
    // Without this, the test above would also pass if arithmetic vanished.
    expect(
      snippets.some(({ text }) =>
        /\b[a-z]\w* [-+*%] \d+(?:\.\d+)?|\d+(?:\.\d+)? [-+*%] \b[a-z]/.test(text),
      ),
    ).toBe(true);
  });

  it('never compares a double for equality', () => {
    // `ratio == 4.9` is a bug wherever it is written: the literal is not the
    // value the arithmetic lands on. Nothing here executes, but a snippet
    // that teaches the eye a mistake is the wrong text to practise on.
    for (const { text, lines, seed } of snippets) {
      for (const line of text.split('\n')) {
        expect(line, `${lines}/${seed}`).not.toMatch(/[=!]==?\s*-?\d+\.\d/);
        expect(line, `${lines}/${seed}`).not.toMatch(/\d+\.\d\s*[=!]==?/);
      }
    }
  });

  it('still compares doubles across the corpus', () => {
    // Without this, the test above would also pass if doubles stopped being
    // compared at all rather than being compared by ordering.
    const compared = snippets.some(({ text }) =>
      text.split('\n').some((line) => /[<>]=?/.test(line) && /\d+\.\d/.test(line)),
    );
    expect(compared).toBe(true);
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
