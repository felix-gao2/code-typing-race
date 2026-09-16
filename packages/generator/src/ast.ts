/**
 * The generator emits this tree; a per-language printer renders it to text.
 * Nothing here is language-specific — `int` is the abstract notion of a whole
 * number, and each printer decides whether that is `int`, `number` or nothing
 * at all.
 */

export type ValueType = 'int' | 'double' | 'boolean' | 'string';

export type BinaryOp = '+' | '-' | '*' | '%';
export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type CompoundOp = '+=' | '-=' | '*=';

export type Expr =
  | { kind: 'int'; value: number }
  /** Stored as tenths so rendering never depends on float formatting. */
  | { kind: 'double'; tenths: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; name: string; type: ValueType }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'compare'; op: CompareOp; left: Expr; right: Expr };

export type Stmt =
  | { kind: 'declare'; name: string; type: ValueType; init: Expr }
  | { kind: 'assign'; name: string; value: Expr }
  | { kind: 'compound'; name: string; op: CompoundOp; value: Expr }
  | { kind: 'print'; value: Expr }
  | { kind: 'if'; condition: Expr; body: Stmt[] }
  | { kind: 'for'; variable: string; limit: Expr; body: Stmt[] }
  | { kind: 'while'; condition: Expr; body: Stmt[] }
  | { kind: 'doWhile'; condition: Expr; body: Stmt[] };

export type Program = Stmt[];

/** A statement that owns a body, and therefore a scope. */
export function isBlock(stmt: Stmt): boolean {
  return (
    stmt.kind === 'if' ||
    stmt.kind === 'for' ||
    stmt.kind === 'while' ||
    stmt.kind === 'doWhile'
  );
}
