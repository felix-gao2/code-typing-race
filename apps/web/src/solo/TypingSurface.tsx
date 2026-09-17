import type { RunState } from '@ctr/typing-engine';
import { useEffect, useMemo, useRef } from 'react';
import type { InputIntent } from './input.ts';

interface TypingSurfaceProps {
  readonly state: RunState;
  readonly onIntent: (intent: InputIntent) => void;
  readonly onNewSnippet: () => void;
  readonly onRetry: () => void;
}

/**
 * Renders the target and captures typing. No game logic — every decision about
 * what a keystroke means belongs to the engine.
 *
 * Input is captured by a focused off-screen textarea listening for
 * `beforeinput`, with the default always prevented, so the textarea never
 * actually holds text and nothing has to be diffed back out of it.
 */
export function TypingSurface({ state, onIntent, onNewSnippet, onRetry }: TypingSurfaceProps) {
  const capture = useRef<HTMLTextAreaElement>(null);

  // Which typeable character, if any, each offset of the source text is.
  // Everything absent from this map is indentation: shown, never typed, never
  // scored.
  const typeableAt = useMemo(() => {
    const map = new Map<number, number>();
    state.target.chars.forEach((c, index) => map.set(c.sourceIndex, index));
    return map;
  }, [state.target]);

  // Every new run takes focus back, which covers restarting and the moment
  // after a picker was clicked — otherwise typing would go to the select.
  useEffect(() => {
    capture.current?.focus();
  }, [state.target]);

  useEffect(() => {
    const element = capture.current;
    if (element === null) {
      return undefined;
    }
    const handle = (event: globalThis.InputEvent) => {
      // Prevented unconditionally: anything this surface does not understand
      // must not reach the textarea either.
      event.preventDefault();
      onIntent({ inputType: event.inputType, data: event.data });
    };
    element.addEventListener('beforeinput', handle);
    return () => element.removeEventListener('beforeinput', handle);
  }, [onIntent]);

  const { text } = state.target;
  const characters = [...text].map((char, sourceIndex) => {
    const index = typeableAt.get(sourceIndex);
    const status = index === undefined ? 'skipped' : (state.chars[index]?.status ?? 'untyped');
    const caret = index !== undefined && index === state.cursor;

    return (
      <span key={sourceIndex} className={`char char-${status}`}>
        {caret ? <span className="caret" /> : null}
        {/* A line break that was typed wrong has nothing to colour, so it gets
            a visible mark of its own. */}
        {char === '\n' && status === 'wrong' ? '↵' : null}
        {char}
      </span>
    );
  });

  return (
    <div
      className="surface"
      onMouseDown={(event) => {
        // Clicking anywhere on the snippet returns focus to the capture, so a
        // stray click never silently stops the run from receiving keys.
        event.preventDefault();
        capture.current?.focus();
      }}
    >
      <pre className="target">
        {characters}
        {state.cursor >= state.chars.length ? <span className="caret caret-end" /> : null}
      </pre>
      <textarea
        ref={capture}
        className="capture"
        value=""
        onChange={() => {
          // Controlled at the empty string on purpose: `beforeinput` is
          // prevented, so this never fires. React requires the handler anyway.
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            onNewSnippet();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onRetry();
          }
        }}
        // Paste is the one anti-cheat measure that is not deferred. beforeinput
        // already refuses it; these stop the drag-and-drop and middle-click
        // routes before they become input at all.
        onPaste={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        onDragOver={(event) => event.preventDefault()}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label="Type the snippet"
      />
    </div>
  );
}
