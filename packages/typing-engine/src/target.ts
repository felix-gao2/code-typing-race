/**
 * Turns target text into the flat sequence of characters a player actually
 * types. Two things are dropped on the way:
 *
 * - **Leading whitespace**, because auto-indent supplies it. The caret lands on
 *   the first non-whitespace character of a line whatever its indentation, so
 *   this covers a dedent onto `}` and Python's block structure without either
 *   being a special case.
 * - **Blank lines**, which are crossed by the same single Enter that ends the
 *   line before them.
 *
 * The line break that remains is itself a typeable character, `'\n'`. That is
 * what makes "what does Enter do mid-line" and "what happens past the end of a
 * line" stop being separate rules: there is only ever a next expected
 * character, and Enter is sometimes it.
 */

export interface TypeableChar {
  /** The character to type. A line break is `'\n'`. */
  readonly char: string;
  /** Offset in the original target text, for rendering. */
  readonly sourceIndex: number;
  /** 0-based line in the original target text. */
  readonly line: number;
  /** 0-based column in the original target text. */
  readonly column: number;
}

export interface TargetMap {
  readonly text: string;
  /** Every character the player must type, in order. */
  readonly chars: readonly TypeableChar[];
}

/** Pure: the same text always maps to the same sequence. */
export function mapTarget(text: string): TargetMap {
  const chars: TypeableChar[] = [];
  const lines = text.split('\n');

  // Offset of the start of the current line in `text`.
  let lineStart = 0;
  // A line break is only typed to reach a line that has content, so it is
  // emitted lazily: we know it is needed once the next non-blank line arrives.
  let pendingBreak: TypeableChar | undefined;

  lines.forEach((line, lineIndex) => {
    const content = line.trimEnd();
    const indent = content.length - content.trimStart().length;

    if (content.trim() !== '') {
      if (pendingBreak !== undefined) {
        chars.push(pendingBreak);
        pendingBreak = undefined;
      }
      for (let column = indent; column < content.length; column++) {
        chars.push({
          // Safe: column is inside content, which is a prefix of line.
          char: content[column] as string,
          sourceIndex: lineStart + column,
          line: lineIndex,
          column,
        });
      }
      // The break that ends this line, should any later line need it.
      pendingBreak = {
        char: '\n',
        sourceIndex: lineStart + line.length,
        line: lineIndex,
        column: line.length,
      };
    }

    lineStart += line.length + 1;
  });

  // Whatever break is left over ends the final line, and is never typed.
  return { text, chars };
}
