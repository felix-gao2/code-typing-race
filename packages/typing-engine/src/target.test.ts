import { describe, expect, it } from 'vitest';
import { mapTarget } from './target.ts';

const typed = (text: string): string =>
  mapTarget(text)
    .chars.map((c) => c.char)
    .join('');

// Shaped like real generator output: braces dedent, Python does not.
const JAVA = ['int count = 5;', '', 'if (count >= 10) {', '    count -= 4;', '}'].join('\n');
const PYTHON = ['count = 5', '', 'if count >= 10:', '    count -= 4', '    print(count)'].join('\n');

describe('mapTarget', () => {
  it('types nothing for empty or whitespace-only text', () => {
    expect(mapTarget('').chars).toHaveLength(0);
    expect(mapTarget('\n\n   \n').chars).toHaveLength(0);
  });

  it('types a single line exactly as written', () => {
    expect(typed('count += 1;')).toBe('count += 1;');
  });

  it('never types leading whitespace', () => {
    expect(typed('        count -= 4;')).toBe('count -= 4;');
    expect(typed('\tcount -= 4;')).toBe('count -= 4;');
  });

  it('types one line break per line change', () => {
    expect(typed('a = 1\nb = 2')).toBe('a = 1\nb = 2');
  });

  it('crosses any run of blank lines with a single Enter', () => {
    expect(typed('a = 1\n\n\n\nb = 2')).toBe('a = 1\nb = 2');
    expect(typed('a = 1\n   \nb = 2')).toBe('a = 1\nb = 2');
  });

  it('does not type a break after the final line', () => {
    expect(typed('a = 1\n')).toBe('a = 1');
    expect(typed('a = 1\n\n\n')).toBe('a = 1');
  });

  it('types a closing brace, which a dedent rule would have missed', () => {
    expect(typed(JAVA)).toBe('int count = 5;\nif (count >= 10) {\ncount -= 4;\n}');
  });

  it('strips Python indentation without needing to know about Python', () => {
    expect(typed(PYTHON)).toBe('count = 5\nif count >= 10:\ncount -= 4\nprint(count)');
  });

  it('never types trailing whitespace', () => {
    expect(typed('a = 1   \nb = 2')).toBe('a = 1\nb = 2');
  });

  for (const [name, text] of [
    ['java', JAVA],
    ['python', PYTHON],
  ] as const) {
    it(`points every ${name} character at its own offset in the source text`, () => {
      const { chars } = mapTarget(text);
      expect(chars.length).toBeGreaterThan(0);
      for (const c of chars) {
        expect(text[c.sourceIndex]).toBe(c.char);
        expect(text.split('\n')[c.line]?.[c.column] ?? '\n').toBe(c.char);
      }
    });
  }

  it('advances source offsets monotonically', () => {
    const { chars } = mapTarget(PYTHON);
    const offsets = chars.map((c) => c.sourceIndex);
    expect(offsets).toStrictEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});
