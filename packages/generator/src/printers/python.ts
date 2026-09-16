import type { Expr, Program, Stmt } from '../ast.ts';
import { isBlock } from '../ast.ts';

const INDENT = '    ';

/**
 * Python has no `do`, so a doWhile node should never reach this printer — the
 * capability set drops it before generation. Reaching it means the two have
 * fallen out of step, which is worth a crash rather than a rewritten loop.
 */
function unsupported(kind: string): never {
  throw new Error(`printPython: ${kind} is not a Python statement — check LanguageCapabilities`);
}

export function printPython(program: Program): string {
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
    // Python declares by assigning, so the two are the same line.
    case 'declare':
    case 'assign':
      return [
        `${pad}${stmt.name} = ${printExpr(stmt.kind === 'declare' ? stmt.init : stmt.value)}`,
      ];
    case 'compound':
      return [`${pad}${stmt.name} ${stmt.op} ${printExpr(stmt.value)}`];
    case 'print':
      return [`${pad}print(${printExpr(stmt.value)})`];
    case 'if':
      return [`${pad}if ${printExpr(stmt.condition)}:`, ...printBody(stmt.body, depth)];
    case 'for':
      return [
        `${pad}for ${stmt.variable} in range(${printExpr(stmt.limit)}):`,
        ...printBody(stmt.body, depth),
      ];
    case 'while':
      return [`${pad}while ${printExpr(stmt.condition)}:`, ...printBody(stmt.body, depth)];
    case 'doWhile':
      return unsupported('doWhile');
  }
}

function printBody(body: Stmt[], depth: number): string[] {
  return body.flatMap((stmt) => printStmt(stmt, depth + 1));
}

function printExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'int':
      return String(expr.value);
    case 'double':
      // Unlike TypeScript, the suffix is load-bearing here: `rate = 12` is an
      // int and `rate = 12.0` is a float, so it stays.
      return (expr.tenths / 10).toFixed(1);
    case 'boolean':
      return expr.value ? 'True' : 'False';
    case 'string':
      return `"${expr.value}"`;
    case 'ref':
      return expr.name;
    case 'binary':
    case 'compare':
      return `${printExpr(expr.left)} ${expr.op} ${printExpr(expr.right)}`;
  }
}
