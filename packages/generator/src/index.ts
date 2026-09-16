import type { Program } from './ast.ts';
import { TIERS, type LanguageCapabilities, type Tier } from './config.ts';
import { generateProgram } from './generate.ts';
import { printJava } from './printers/java.ts';
import { printPython } from './printers/python.ts';
import { printTypescript } from './printers/typescript.ts';
import { createRng } from './rng.ts';

export type { Program, Stmt, Expr, ValueType } from './ast.ts';
export type { GeneratorConfig, LanguageCapabilities, Tier } from './config.ts';
export { TIERS } from './config.ts';

/**
 * Bump whenever generated output changes for any existing seed. Snippet
 * identity is (generatorVersion, language, tier, seed), so a silent change
 * would leave ghosts replaying against text that no longer exists.
 */
export const GENERATOR_VERSION = 2;

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
  tier: Tier;
}

/** Pure: the same request always produces byte-identical text. */
export function generateSnippet({ seed, language, tier }: SnippetRequest): string {
  const print = PRINTERS[language];
  const program = generateProgram(createRng(seed), TIERS[tier], CAPABILITIES[language], print);
  return print(program);
}
