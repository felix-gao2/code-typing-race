import type { CompareOp, Expr, Program, Stmt } from '../ast.ts';
import { isBlock } from '../ast.ts';

const INDENT = '    ';

/**
 * Loose equality is an error in every real TypeScript codebase, so printing
 * `==` would make an otherwise fine snippet read as a mistake. Every other
 * operator in the AST renders unchanged.
 */
const TS_COMPARE: Record<CompareOp, string> = {
  '<': '<',
  '<=': '<=',
  '>': '>',
  '>=': '>=',
  '==': '===',
  '!=': '!==',
};

export function printTypescript(program: Program): string {
  const lines: string[] = [];

  program.forEach((stmt, index) => {
    const previous = program[index - 1];
    // Blocks get breathing room, the way the style target has it.
    if (previous !== undefined && (isBlock(stmt) || isBlock(previous))) {
      lines.push('');
    }
    lines.push(...printStmt(stmt, 0));
  });

  return lines.join('\n');
}

function printStmt(stmt: Stmt, depth: number): string[] {
  const pad = INDENT.repeat(depth);

  switch (stmt.kind) {
    // No type annotation: every declaration has an initialiser, so inference
    // covers it, and `let n: number = 27` is the form a linter complains about.
    // `let` rather than `const` because the generator reassigns freely.
    case 'declare':
      return [`${pad}let ${stmt.name} = ${printExpr(stmt.init)};`];
    case 'assign':
      return [`${pad}${stmt.name} = ${printExpr(stmt.value)};`];
    case 'compound':
      return [`${pad}${stmt.name} ${stmt.op} ${printExpr(stmt.value)};`];
    case 'print':
      return [`${pad}console.log(${printExpr(stmt.value)});`];
    case 'if':
      return [
        `${pad}if (${printExpr(stmt.condition)}) {`,
        ...printBody(stmt.body, depth),
        `${pad}}`,
      ];
    case 'for':
      return [
        `${pad}for (let ${stmt.variable} = 0; ${stmt.variable} < ${printExpr(stmt.limit)}; ${stmt.variable}++) {`,
        ...printBody(stmt.body, depth),
        `${pad}}`,
      ];
    case 'while':
      return [
        `${pad}while (${printExpr(stmt.condition)}) {`,
        ...printBody(stmt.body, depth),
        `${pad}}`,
      ];
    case 'doWhile':
      return [
        `${pad}do {`,
        ...printBody(stmt.body, depth),
        `${pad}} while (${printExpr(stmt.condition)});`,
      ];
  }
}

function printBody(body: Stmt[], depth: number): string[] {
  return body.flatMap((stmt) => printStmt(stmt, depth + 1));
}

function printExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'int':
      return String(expr.value);
    case 'double': {
      // `12.0` is valid TS, but inference makes the suffix decoration rather
      // than type information — `let x = 12` is a number either way — and no
      // TypeScript developer types it. Go is the opposite case: there `:= 12.0`
      // is what makes the variable a float64, so its printer keeps the suffix.
      const value = expr.tenths / 10;
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    }
    case 'boolean':
      return expr.value ? 'true' : 'false';
    case 'string':
      return `"${expr.value}"`;
    case 'ref':
      return expr.name;
    case 'binary':
      return `${printExpr(expr.left)} ${expr.op} ${printExpr(expr.right)}`;
    case 'compare':
      return `${printExpr(expr.left)} ${TS_COMPARE[expr.op]} ${printExpr(expr.right)}`;
  }
}
