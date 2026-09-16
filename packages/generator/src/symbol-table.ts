import type { ValueType } from './ast.ts';

export interface Variable {
  name: string;
  type: ValueType;
}

/**
 * A stack of scopes. This is what makes variables reappear across a snippet
 * instead of every line being an island.
 *
 * Scopes are arrays rather than Maps so that iteration order is a property of
 * the code and not of the runtime's hashing.
 */
export class SymbolTable {
  #scopes: Variable[][] = [[]];

  push(): void {
    this.#scopes.push([]);
  }

  pop(): void {
    if (this.#scopes.length === 1) {
      throw new Error('SymbolTable: popped the root scope');
    }
    this.#scopes.pop();
  }

  /** Declares into the innermost scope. */
  declare(name: string, type: ValueType): void {
    if (this.isVisible(name)) {
      throw new Error(`SymbolTable: ${name} is already visible — no shadowing`);
    }
    const scope = this.#scopes[this.#scopes.length - 1];
    if (scope === undefined) {
      throw new Error('SymbolTable: no scope to declare into');
    }
    scope.push({ name, type });
  }

  /** Everything in scope, innermost last. */
  visible(): Variable[] {
    return this.#scopes.flat();
  }

  visibleOfType(type: ValueType): Variable[] {
    return this.visible().filter((variable) => variable.type === type);
  }

  isVisible(name: string): boolean {
    return this.visible().some((variable) => variable.name === name);
  }
}
