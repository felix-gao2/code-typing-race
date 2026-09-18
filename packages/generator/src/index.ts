import type { Program } from './ast.ts';
import { CONFIG, type LanguageCapabilities } from './config.ts';
import { generateProgram } from './generate.ts';
import { printJava } from './printers/java.ts';
import { printPython } from './printers/python.ts';
import { printTypescript } from './printers/typescript.ts';
import { createRng } from './rng.ts';

export type { Program, Stmt, Expr, ValueType } from './ast.ts';
export type { GeneratorConfig, LanguageCapabilities, LinePreset } from './config.ts';
export { CONFIG, LINE_PRESETS, isLinePreset } from './config.ts';

/**
 * Bump whenever generated output changes for any existing seed. Snippet
 * identity is (generatorVersion, language, lines, seed), so a silent change
 * would leave ghosts replaying against text that no longer exists.
 */
export const GENERATOR_VERSION = 6;

export const LANGUAGES = ['java', 'typescript', 'python'] as const;
export type Language = (typeof LANGUAGES)[number];

const PRINTERS: Record<Language, (program: Program) => string> = {
  java: printJava,
  typescript: printTypescript,
  python: printPython,
};

const CAPABILITIES: Record<Language, LanguageCapabilities> = {
  java: { doWhile: true },
  typescript: { doWhile: true },
  python: { doWhile: false },
};

export interface SnippetRequest {
  seed: number;
  language: Language;
  /** Rendered lines the snippet lands on exactly. Any count is playable; only
   * the presets in `LINE_PRESETS` are ranked. */
  lines: number;
}

/** Pure: the same request always produces byte-identical text. */
export function generateSnippet({ seed, language, lines }: SnippetRequest): string {
  if (!Number.isInteger(lines) || lines < 1) {
    throw new RangeError(`lines must be a positive integer, got ${lines}`);
  }
  const print = PRINTERS[language];
  const program = generateProgram(createRng(seed), CONFIG, CAPABILITIES[language], print, lines);
  return print(program);
}
