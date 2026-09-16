import type { BinaryOp, CompareOp, CompoundOp, Expr, Program, Stmt, ValueType } from './ast.ts';
import { isBlock } from './ast.ts';
import type { GeneratorConfig } from './config.ts';
import type { Rng } from './rng.ts';
import { SymbolTable, type Variable } from './symbol-table.ts';

const NUMERIC_TYPES: readonly ValueType[] = ['int', 'double'];
const STRING_LEAD = 'abcdefghijklmnopqrstuvwxyz';
const STRING_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LOOP_VARIABLES = ['i', 'j', 'k'] as const;

/**
 * Declaration types as repeats. Ints carry most snippets, and booleans are
 * rare on purpose — in real code a boolean is usually the result of a
 * comparison, not a thing you keep declaring.
 */
const DECLARATION_TYPES: readonly ValueType[] = [
  'int',
  'int',
  'int',
  'int',
  'double',
  'double',
  'string',
  'string',
  'boolean',
];

/** Nesting gets rarer the deeper it goes, so depth 3 stays a treat. */
const NESTING_DECAY = 0.45;

/** Operands inside an expression stay small: `i * 2`, not `i * 87`. */
const OPERAND_MAX = 12;

interface Ctx {
  rng: Rng;
  config: GeneratorConfig;
  table: SymbolTable;
  loopDepth: number;
  /** Loop counters. Readable anywhere, but never assigned to — real code
   * doesn't reassign `i` inside its own loop, and it reads as a mistake. */
  loopVariables: string[];
}

/**
 * Generates until the rendered program exceeds the tier's character budget.
 * Rendering is pure, so measuring this way stays deterministic.
 */
export function generateProgram(
  rng: Rng,
  config: GeneratorConfig,
  render: (program: Program) => string,
): Program {
  const ctx: Ctx = {
    rng,
    config,
    table: new SymbolTable(),
    loopDepth: 0,
    loopVariables: [],
  };
  const program: Program = [];
  let rendered = 0;

  do {
    // Near the budget, only single lines are allowed: a block generated at the
    // end can add 100+ characters and blow straight past the tier.
    const roomForBlock = rendered < config.charBudget * 0.8;
    let stmt = genStatement(ctx, 0, program, roomForBlock);

    // Even inside the window a block can overshoot badly, and the length of
    // one is only knowable after generating it. Re-roll it as a single line.
    if (isBlock(stmt) && render([...program, stmt]).length > config.charBudget * 1.2) {
      stmt = genStatement(ctx, 0, program, false);
    }

    program.push(stmt);
    rendered = render(program).length;
  } while (rendered < config.charBudget);

  return program;
}

/**
 * Two attempts at not repeating the previous statement's shape. Bounded, so a
 * scope holding exactly one variable still terminates — it just repeats.
 */
function genStatement(ctx: Ctx, depth: number, recent: readonly Stmt[], allowBlock = true): Stmt {
  let stmt = genStatementOnce(ctx, depth, allowBlock);
  for (let attempt = 0; attempt < 2 && repeatsShape(recent, stmt); attempt += 1) {
    stmt = genStatementOnce(ctx, depth, allowBlock);
  }
  // Still repeating means the scope has nothing else to talk about. Declaring
  // introduces a fresh name, which is both a new subject and more material.
  return repeatsShape(recent, stmt) ? genDeclaration(ctx) : stmt;
}

/**
 * Statements about the same variable in quick succession read as filler —
 * `step = 11; step -= 11;`, or the `n = 26; count = 8.3; n = 22;` ping-pong
 * that comes from having only two variables to talk about.
 */
function repeatsShape(recent: readonly Stmt[], next: Stmt): boolean {
  const name = subject(next);
  if (name === undefined) {
    return false;
  }
  return recent.slice(-2).some((stmt) => subject(stmt) === name);
}

/** The variable a statement is about, if it's about one. */
function subject(stmt: Stmt): string | undefined {
  switch (stmt.kind) {
    case 'declare':
    case 'assign':
    case 'compound':
      return stmt.name;
    case 'print':
      return stmt.value.kind === 'ref' ? stmt.value.name : undefined;
    default:
      return undefined;
  }
}

function genStatementOnce(ctx: Ctx, depth: number, allowBlock: boolean): Stmt {
  const canNest = allowBlock && depth < ctx.config.maxDepth;
  // A block needs something to test and something to do. With nothing but one
  // variable in scope, every body is that variable again — so declarations
  // come first as a consequence, not as a quota.
  const ready = numericVars(ctx).length > 0 && ctx.table.visible().length > 1;
  // Scaled by how much there is to work with, so early blocks stay rare
  // without a rule saying "declare three things first".
  const material = Math.min(1, ctx.table.visible().length / 3);
  const chance = ctx.config.blockChance * NESTING_DECAY ** depth * material;

  if (canNest && ready && ctx.rng.chance(chance)) {
    return genBlock(ctx, depth);
  }
  return genSimple(ctx);
}

function genBlock(ctx: Ctx, depth: number): Stmt {
  const kind = ctx.rng.pick(['if', 'if', 'if', 'for', 'for', 'for', 'while', 'doWhile'] as const);

  if (kind === 'for') {
    const variable = loopVariable(ctx);
    const ints = ctx.table.visibleOfType('int');
    const limit: Expr =
      ints.length > 0 && ctx.rng.chance(0.3)
        ? { kind: 'ref', name: ctx.rng.pick(ints).name, type: 'int' }
        : { kind: 'int', value: ctx.rng.int(2, 12) };

    ctx.table.push();
    ctx.table.declare(variable, 'int');
    ctx.loopVariables.push(variable);
    ctx.loopDepth += 1;
    const body = genBody(ctx, depth);
    ctx.loopDepth -= 1;
    ctx.loopVariables.pop();
    ctx.table.pop();

    return { kind: 'for', variable, limit, body };
  }

  const condition = genCondition(ctx);
  ctx.table.push();
  const body = genBody(ctx, depth);

  // A while whose body never touches its condition is an infinite loop, and it
  // reads as a mistake even though nobody runs these. Guarantee one line that
  // moves the variable the condition tests.
  const tested = conditionSubject(condition);
  if (
    kind !== 'if' &&
    tested !== undefined &&
    !ctx.loopVariables.includes(tested.name) &&
    !body.some((stmt) => subject(stmt) === tested.name)
  ) {
    body.push(mutate(ctx, tested));
  }

  ctx.table.pop();

  return { kind, condition, body };
}

/** A block body always holds at least one statement — structural, not a quota. */
function genBody(ctx: Ctx, depth: number): Stmt[] {
  const [min, max] = ctx.config.bodyStatements;
  const count = ctx.rng.int(min, max);
  const body: Stmt[] = [];
  for (let i = 0; i < count; i += 1) {
    body.push(genStatement(ctx, depth + 1, body));
  }
  return body;
}

function genSimple(ctx: Ctx): Stmt {
  const visible = ctx.table.visible();
  const assignable = writable(ctx, visible);
  const numeric = writable(ctx, numericVars(ctx));

  // Weights as repeats: readable, and one rng draw regardless of the mix.
  // Declaring gets rarer as the scope fills, which is what gives a snippet a
  // handful of variables instead of one variable and twenty assignments.
  const declareWeight = Math.max(1, 7 - visible.length * 2);
  const candidates: string[] = Array<string>(declareWeight).fill('declare');
  if (assignable.length > 0) {
    candidates.push('assign', 'assign', 'assign');
  }
  if (visible.length > 0) {
    candidates.push('print', 'print');
  }
  if (numeric.length > 0) {
    candidates.push('compound', 'compound', 'compound');
  }

  switch (ctx.rng.pick(candidates)) {
    case 'assign': {
      const target = ctx.rng.pick(assignable);
      return {
        kind: 'assign',
        name: target.name,
        value: genExpr(ctx, target.type, 0, [target.name]),
      };
    }
    case 'compound': {
      const target = ctx.rng.pick(numeric);
      const op = ctx.rng.pick(['+=', '-=', '*='] as const satisfies readonly CompoundOp[]);
      const value = genExpr(ctx, target.type, 1, [target.name]);
      return {
        kind: 'compound',
        name: target.name,
        op,
        // `count *= 1;` is a statement that does nothing.
        value: op === '*=' ? atLeastTwo(ctx, value) : value,
      };
    }
    case 'print': {
      const target = ctx.rng.pick(visible);
      return { kind: 'print', value: { kind: 'ref', name: target.name, type: target.type } };
    }
    default:
      return genDeclaration(ctx);
  }
}

function genDeclaration(ctx: Ctx): Stmt {
  const type = pickDeclarationType(ctx);
  const name = freshName(ctx);
  // Depth 1 disables arithmetic: declarations read `int n = 27;`, and the
  // operators live in the assignments and compounds instead.
  const init = genExpr(ctx, type, 1);
  ctx.table.declare(name, type);
  return { kind: 'declare', name, type, init };
}

/**
 * Weighted toward ints, but biased against types already in scope — otherwise
 * the weights alone produce all-int snippets, since a snippet only declares a
 * handful of variables in total.
 */
function pickDeclarationType(ctx: Ctx): ValueType {
  const visible = ctx.table.visible();
  const unused = DECLARATION_TYPES.filter(
    (type) => !visible.some((variable) => variable.type === type),
  );
  if (unused.length > 0 && ctx.rng.chance(0.7)) {
    return ctx.rng.pick(unused);
  }
  return ctx.rng.pick(DECLARATION_TYPES);
}

/**
 * `exclude` keeps variables off the right-hand side of their own statement.
 * Without it you get `mode = mode;` and `rate = limit < limit;`, which nobody
 * has ever typed on purpose. It's a list because a comparison inside an
 * assignment has two names to keep out at once.
 */
function genExpr(ctx: Ctx, type: ValueType, depth: number, exclude: readonly string[] = []): Expr {
  if (type === 'boolean') {
    return genBooleanExpr(ctx, exclude);
  }

  const numeric = type === 'int' || type === 'double';
  if (numeric && depth < 1 && ctx.rng.chance(ctx.config.operatorChance)) {
    const ops: readonly BinaryOp[] = type === 'int' ? ['+', '-', '*', '%'] : ['+', '-', '*'];
    const op = ctx.rng.pick(ops);
    const degenerate = op === '*' || op === '%';
    const left = genExpr(ctx, type, depth + 1, exclude);
    const generated = genExpr(ctx, type, depth + 1, exclude);
    // `i - i` and `48 % 48` are noise, and `x % x` is a division by nothing.
    const right = sameOperand(left, generated) ? otherThan(ctx, type, generated) : generated;
    return {
      kind: 'binary',
      op,
      // `1 * 12` and `% 1` are arithmetic that does nothing.
      left: degenerate ? atLeastTwo(ctx, left) : left,
      right: degenerate ? atLeastTwo(ctx, right) : right,
    };
  }

  const inScope = available(ctx.table.visibleOfType(type), exclude);
  if (inScope.length > 0 && ctx.rng.chance(ctx.config.reuseRate)) {
    return { kind: 'ref', name: ctx.rng.pick(inScope).name, type };
  }

  return genLiteral(ctx, type, depth > 0);
}

function sameOperand(left: Expr, right: Expr): boolean {
  if (left.kind === 'ref' && right.kind === 'ref') {
    return left.name === right.name;
  }
  if (left.kind === 'int' && right.kind === 'int') {
    return left.value === right.value;
  }
  if (left.kind === 'double' && right.kind === 'double') {
    return left.tenths === right.tenths;
  }
  return false;
}

/** Raises a degenerate multiplier or modulus; leaves references alone. */
function atLeastTwo(ctx: Ctx, expr: Expr): Expr {
  if (expr.kind === 'int' && expr.value < 2) {
    return { kind: 'int', value: ctx.rng.int(2, OPERAND_MAX) };
  }
  if (expr.kind === 'double' && expr.tenths < 20) {
    return { kind: 'double', tenths: ctx.rng.int(20, OPERAND_MAX * 10) };
  }
  return expr;
}

/** A literal guaranteed to differ from the one it replaces. */
function otherThan(ctx: Ctx, type: ValueType, clash: Expr): Expr {
  const replacement = genLiteral(ctx, type, true);
  if (!sameOperand(clash, replacement)) {
    return replacement;
  }
  if (replacement.kind === 'int') {
    return { kind: 'int', value: replacement.value + 1 };
  }
  if (replacement.kind === 'double') {
    return { kind: 'double', tenths: replacement.tenths + 1 };
  }
  return replacement;
}

/** `boolean ok = rate < n;` is the shape worth generating — not `= true`. */
function genBooleanExpr(ctx: Ctx, exclude: readonly string[] = []): Expr {
  const numeric = available(numericVars(ctx), exclude);
  if (numeric.length > 0 && ctx.rng.chance(0.8)) {
    return comparison(ctx, ctx.rng.pick(numeric), exclude);
  }

  const booleans = available(ctx.table.visibleOfType('boolean'), exclude);
  if (booleans.length > 0 && ctx.rng.chance(ctx.config.reuseRate)) {
    return { kind: 'ref', name: ctx.rng.pick(booleans).name, type: 'boolean' };
  }

  return { kind: 'boolean', value: ctx.rng.chance(0.5) };
}

function comparison(ctx: Ctx, left: Variable, exclude: readonly string[] = []): Expr {
  const op = ctx.rng.pick([
    '<',
    '<=',
    '>',
    '>=',
    '==',
    '!=',
  ] as const satisfies readonly CompareOp[]);
  return {
    kind: 'compare',
    op,
    left: { kind: 'ref', name: left.name, type: left.type },
    // Excluding the left side stops `i == i`.
    right: genExpr(ctx, left.type, 1, [...exclude, left.name]),
  };
}

/**
 * Conditions compare numbers wherever possible, because `if (n != 84)` is what
 * code actually looks like. Strings compare with equality only.
 */
function genCondition(ctx: Ctx): Expr {
  const numeric = numericVars(ctx);
  if (numeric.length > 0) {
    return comparison(ctx, ctx.rng.pick(numeric));
  }

  const strings = ctx.table.visibleOfType('string');
  if (strings.length > 0) {
    const target = ctx.rng.pick(strings);
    return {
      kind: 'compare',
      op: ctx.rng.pick(['==', '!='] as const satisfies readonly CompareOp[]),
      left: { kind: 'ref', name: target.name, type: 'string' },
      right: genLiteral(ctx, 'string'),
    };
  }

  const booleans = ctx.table.visibleOfType('boolean');
  if (booleans.length > 0) {
    const target = ctx.rng.pick(booleans);
    return { kind: 'ref', name: target.name, type: 'boolean' };
  }

  // Unreachable in practice: blocks are only generated once a number exists.
  return { kind: 'boolean', value: true };
}

function genLiteral(ctx: Ctx, type: ValueType, small = false): Expr {
  switch (type) {
    case 'int':
      // Operands start at 1: `size - 0` and `delta += 0` are noise.
      return {
        kind: 'int',
        value: small ? ctx.rng.int(1, OPERAND_MAX) : ctx.rng.int(0, ctx.config.intMax),
      };
    case 'double':
      return {
        kind: 'double',
        tenths: ctx.rng.int(1, small ? OPERAND_MAX * 10 : ctx.config.doubleTenthsMax),
      };
    case 'boolean':
      return { kind: 'boolean', value: ctx.rng.chance(0.5) };
    case 'string': {
      const [min, max] = ctx.config.stringLength;
      const length = ctx.rng.int(min, max);
      // Leading letter: "ab9" reads like an identifier, "0pr" reads like junk.
      let value = ctx.rng.pick([...STRING_LEAD]);
      for (let i = 1; i < length; i += 1) {
        value += ctx.rng.pick([...STRING_CHARS]);
      }
      return { kind: 'string', value };
    }
  }
}

function numericVars(ctx: Ctx): Variable[] {
  return ctx.table.visible().filter((v) => NUMERIC_TYPES.includes(v.type));
}

/** Everything except loop counters, which are read-only by convention here. */
function writable(ctx: Ctx, variables: Variable[]): Variable[] {
  return variables.filter((v) => !ctx.loopVariables.includes(v.name));
}

function available(variables: Variable[], exclude: readonly string[]): Variable[] {
  return variables.filter((variable) => !exclude.includes(variable.name));
}

function freshName(ctx: Ctx): string {
  const unused = ctx.config.identifiers.filter((name) => !ctx.table.isVisible(name));
  if (unused.length > 0) {
    return ctx.rng.pick(unused);
  }
  // Pool exhausted: suffix until it's free, so a declaration never shadows.
  const base = ctx.rng.pick(ctx.config.identifiers);
  let suffix = 2;
  while (ctx.table.isVisible(`${base}${suffix}`)) {
    suffix += 1;
  }
  return `${base}${suffix}`;
}

function loopVariable(ctx: Ctx): string {
  const preferred = LOOP_VARIABLES[ctx.loopDepth];
  if (preferred !== undefined && !ctx.table.isVisible(preferred)) {
    return preferred;
  }
  for (const name of LOOP_VARIABLES) {
    if (!ctx.table.isVisible(name)) {
      return name;
    }
  }
  let suffix = 2;
  while (ctx.table.isVisible(`i${suffix}`)) {
    suffix += 1;
  }
  return `i${suffix}`;
}

/** The variable a condition tests, when it tests one. */
function conditionSubject(condition: Expr): Variable | undefined {
  if (condition.kind === 'compare' && condition.left.kind === 'ref') {
    return { name: condition.left.name, type: condition.left.type };
  }
  if (condition.kind === 'ref') {
    return { name: condition.name, type: condition.type };
  }
  return undefined;
}

/** One statement that moves a variable, so a loop can plausibly end. */
function mutate(ctx: Ctx, target: Variable): Stmt {
  if (target.type === 'int' || target.type === 'double') {
    const op = ctx.rng.pick(['+=', '-='] as const satisfies readonly CompoundOp[]);
    return {
      kind: 'compound',
      name: target.name,
      op,
      value: genLiteral(ctx, target.type, true),
    };
  }
  return {
    kind: 'assign',
    name: target.name,
    value: genExpr(ctx, target.type, 1, [target.name]),
  };
}
