import type { Expr, Program, Stmt, ValueType } from '../ast.ts';
import { isBlock } from '../ast.ts';

const INDENT = '    ';

const JAVA_TYPES: Record<ValueType, string> = {
  int: 'int',
  double: 'double',
  boolean: 'boolean',
  string: 'String',
};

export function printJava(program: Program): string {
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
    case 'declare':
      return [`${pad}${JAVA_TYPES[stmt.type]} ${stmt.name} = ${printExpr(stmt.init)};`];
    case 'assign':
      return [`${pad}${stmt.name} = ${printExpr(stmt.value)};`];
    case 'compound':
      return [`${pad}${stmt.name} ${stmt.op} ${printExpr(stmt.value)};`];
    case 'print':
      return [`${pad}System.out.println(${printExpr(stmt.value)});`];
    case 'if':
      return [
        `${pad}if (${printExpr(stmt.condition)}) {`,
        ...printBody(stmt.body, depth),
        `${pad}}`,
      ];
    case 'for':
      return [
        `${pad}for (int ${stmt.variable} = 0; ${stmt.variable} < ${printExpr(stmt.limit)}; ${stmt.variable}++) {`,
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
    case 'double':
      return (expr.tenths / 10).toFixed(1);
    case 'boolean':
      return expr.value ? 'true' : 'false';
    case 'string':
      return `"${expr.value}"`;
    case 'ref':
      return expr.name;
    case 'binary':
    case 'compare':
      return `${printExpr(expr.left)} ${expr.op} ${printExpr(expr.right)}`;
  }
}
