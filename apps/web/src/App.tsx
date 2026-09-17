import { generateSnippet, GENERATOR_VERSION } from '@ctr/generator';
import { ENGINE_VERSION, mapTarget } from '@ctr/typing-engine';

/**
 * Smoke test for the thing that decides this app's shape: both packages export
 * raw TypeScript with no build step, so Vite has to transform them through the
 * workspace symlink. If this renders, the pure modules can be imported
 * directly and the solo page can be built on top of them.
 */
export function App() {
  const text = generateSnippet({ seed: 42, language: 'python', tier: 'medium' });
  const target = mapTarget(text);

  return (
    <main>
      <p>
        generator v{GENERATOR_VERSION} · engine v{ENGINE_VERSION} · {text.length} characters,{' '}
        {target.chars.length} of them typed
      </p>
      <pre>{text}</pre>
    </main>
  );
}
