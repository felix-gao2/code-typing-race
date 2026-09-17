import { describe, expect, it } from 'vitest';
import { toEvents } from './input.ts';

const at = 1234;

describe('typing', () => {
  it('turns a single character into a single event', () => {
    expect(toEvents({ inputType: 'insertText', data: 'c' }, at)).toStrictEqual([
      { kind: 'char', char: 'c', at },
    ]);
  });

  it('splits a multi-character insertion, which an IME can produce', () => {
    expect(toEvents({ inputType: 'insertText', data: 'abc' }, at)).toStrictEqual([
      { kind: 'char', char: 'a', at },
      { kind: 'char', char: 'b', at },
      { kind: 'char', char: 'c', at },
    ]);
  });

  it('keeps the characters a dead key composes', () => {
    // The whole reason for listening on beforeinput: keydown never sees these.
    for (const char of ['"', "'", '`', '^', '~']) {
      expect(toEvents({ inputType: 'insertText', data: char }, at)).toStrictEqual([
        { kind: 'char', char, at },
      ]);
    }
  });

  it('produces nothing for an insertion with no data', () => {
    expect(toEvents({ inputType: 'insertText', data: null }, at)).toStrictEqual([]);
  });
});

describe('enter', () => {
  it.each(['insertLineBreak', 'insertParagraph'])('maps %s to a line break', (inputType) => {
    expect(toEvents({ inputType, data: null }, at)).toStrictEqual([
      { kind: 'char', char: '\n', at },
    ]);
  });
});

describe('backspace', () => {
  it('maps a backward delete to a backspace', () => {
    expect(toEvents({ inputType: 'deleteContentBackward', data: null }, at)).toStrictEqual([
      { kind: 'backspace', at },
    ]);
  });

  it('refuses a word delete rather than guessing at it', () => {
    expect(toEvents({ inputType: 'deleteWordBackward', data: null }, at)).toStrictEqual([]);
  });

  it('ignores a forward delete', () => {
    expect(toEvents({ inputType: 'deleteContentForward', data: null }, at)).toStrictEqual([]);
  });
});

describe('paste is blocked', () => {
  it.each(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank'])(
    'produces nothing for %s, however much text it carries',
    (inputType) => {
      expect(toEvents({ inputType, data: 'count += 1;' }, at)).toStrictEqual([]);
    },
  );
});

describe('anything unrecognised', () => {
  it('is refused', () => {
    expect(toEvents({ inputType: 'formatBold', data: null }, at)).toStrictEqual([]);
    expect(toEvents({ inputType: 'historyUndo', data: null }, at)).toStrictEqual([]);
    expect(toEvents({ inputType: '', data: 'x' }, at)).toStrictEqual([]);
  });
});
