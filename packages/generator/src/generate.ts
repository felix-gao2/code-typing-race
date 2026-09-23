import type { BinaryOp, CompareOp, CompoundOp, Expr, Program, Stmt, ValueType } from './ast.ts';
import { isBlock } from './ast.ts';
import type { GeneratorConfig, LanguageCapabilities } from './config.ts';
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

const BLOCK_KINDS = ['if', 'if', 'if', 'for', 'for', 'for', 'while', 'doWhile'] as const;

/** Nesting gets rarer the deeper it goes, so depth 3 stays a treat. */
const NESTING_DECAY = 0.45;

/** Operands inside an expression stay small: `i * 2`, not `i * 87`. */
const OPERAND_MAX = 12;

interface Ctx {
  rng: Rng;
  config: GeneratorConfig;
  caps: LanguageCapabilities;
  table: SymbolTable;
  loopDepth: number;
  /** Loop counters. Readable anywhere, but never assigned to — real code
   * doesn't reassign `i` inside its own loop, and it reads as a mistake. */
  loopVariables: string[];
  /**
   * Every name generation has produced a reference to. The declaration cap
   * reads this to decide whether a type already has a variable nobody is
   * using.
   *
   * A discarded attempt's references are unwound, since a statement that never
   * reaches the program never read anything. Left in, they vouch for variables
   * nothing mentions and the cap believes them.
   */
  reads: Set<string>;
}

/** Rendered lines. Rendering is pure, so measuring this way stays deterministic. */
function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

/**
 * Generates top-level statements until the program renders to exactly `lines`
 * lines. Exactly, not approximately: two players racing the same preset have
 * to type the same amount of work.
 *
 * The loop's only bound is the line target. Remove it and generation runs
 * forever, which is what a timed run will consume when it lands.
 */
export function generateProgram(
  rng: Rng,
  config: GeneratorConfig,
  caps: LanguageCapabilities,
  render: (program: Program) => string,
  lines: number,
): Program {
  const ctx: Ctx = {
    rng,
    config,
    caps,
    table: new SymbolTable(),
    loopDepth: 0,
    loopVariables: [],
    reads: new Set(),
  };
  const program: Program = [];
  let used = 0;

  while (used < lines) {
    // A block is a header, a body line and outside Python a closing brace,
    // and the printer puts a blank line before it. Below four there is
    // nowhere to put one.
    const roomForBlock = lines - used >= 4;
    // A discarded block's references never reach the program, so the reads it
    // recorded must not outlive it either — the declaration cap believes them.
    const before = new Set(ctx.reads);
    let stmt = genStatement(ctx, 0, program, roomForBlock);
    let total = lineCount(render([...program, stmt]));

    // How long a block runs is only knowable after generating it. Re-roll it
    // as a single line when it overshoots, and also when it would leave
    // exactly one line free: the printer separates a block from what follows
    // with a blank line, so the next statement could not fit in one.
    if (isBlock(stmt) && (total > lines || lines - total === 1)) {
      ctx.reads = before;
      stmt = genStatement(ctx, 0, program, false);
      total = lineCount(render([...program, stmt]));
    }

    program.push(stmt);
    used = total;
  }

  useTheUnread(ctx, program);
  return program;
}

/**
 * Two attempts at not repeating the previous statement's shape. Bounded, so a
 * scope holding exactly one variable still terminates — it just repeats.
 */
/**
 * A block's body, for walks that do not care which kind of block it is.
 */
function bodyOf(stmt: Stmt): Stmt[] {
  return stmt.kind === 'if' ||
    stmt.kind === 'for' ||
    stmt.kind === 'while' ||
    stmt.kind === 'doWhile'
    ? stmt.body
    : [];
}

/**
 * Every name the program reads, as opposed to writes.
 *
 * A compound assignment's target counts as a write only: `total += 1` on a
 * variable nothing ever looks at leaves it exactly as unread as `total = 1`
 * would, and the point of this walk is to find the variables a reader never
 * has a reason to care about.
 */
function readNames(program: Program): Map<string, number> {
  const counts = new Map<string, number>();
  const fromExpr = (expr: Expr): void => {
    if (expr.kind === 'ref') {
      counts.set(expr.name, (counts.get(expr.name) ?? 0) + 1);
      return;
    }
    if (expr.kind === 'binary' || expr.kind === 'compare') {
      fromExpr(expr.left);
      fromExpr(expr.right);
    }
  };
  const fromStmts = (stmts: readonly Stmt[]): void => {
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case 'declare':
          fromExpr(stmt.init);
          break;
        case 'assign':
        case 'compound':
        case 'print':
          fromExpr(stmt.value);
          break;
        case 'if':
        case 'while':
        case 'doWhile':
          fromExpr(stmt.condition);
          fromStmts(stmt.body);
          break;
        case 'for':
          fromExpr(stmt.limit);
          fromStmts(stmt.body);
          break;
      }
    }
  };
  fromStmts(program);
  return counts;
}

/** Every `declare` in the program, in source order. */
function declarations(stmts: readonly Stmt[], out: Variable[] = []): Variable[] {
  for (const stmt of stmts) {
    if (stmt.kind === 'declare') {
      out.push({ name: stmt.name, type: stmt.type });
    }
    declarations(bodyOf(stmt), out);
  }
  return out;
}

/**
 * The statements a name is visible to: everything after its declaration in
 * the declaring block, and everything nested inside those. A name declared
 * in a block body is not visible after the block closes, which is why this
 * cannot simply collect every later statement.
 */
function sitesFor(stmts: readonly Stmt[], name: string, visible: boolean, out: Stmt[]): void {
  let seen = visible;
  for (const stmt of stmts) {
    if (seen) {
      out.push(stmt);
    }
    if (stmt.kind === 'declare' && stmt.name === name) {
      seen = true;
      continue;
    }
    sitesFor(bodyOf(stmt), name, seen, out);
  }
}

/** Whether a comparison or sum already names this variable on either side. */
function mentions(expr: Expr, name: string): boolean {
  if (expr.kind === 'ref') {
    return expr.name === name;
  }
  if (expr.kind === 'binary' || expr.kind === 'compare') {
    return mentions(expr.left, name) || mentions(expr.right, name);
  }
  return false;
}

/**
 * The same expression with one literal of `type` replaced by a reference to
 * `name`, or undefined if it has no literal to give up.
 */
function withRef(expr: Expr, type: ValueType, name: string): Expr | undefined {
  if (expr.kind === type) {
    return { kind: 'ref', name, type };
  }
  if (expr.kind === 'binary' || expr.kind === 'compare') {
    if (!mentions(expr, name)) {
      const left = withRef(expr.left, type, name);
      if (left !== undefined) {
        return { ...expr, left };
      }
      // Never the right of a `%`: the generator refuses `% 1` for the same
      // reason it would refuse `% n`, which may be a division by nothing.
      if (expr.kind === 'binary' && expr.op === '%') {
        return undefined;
      }
      const right = withRef(expr.right, type, name);
      if (right !== undefined) {
        return { ...expr, right };
      }
    }
  }
  return undefined;
}

/**
 * Makes one statement read `variable`, by handing it a literal's place — or,
 * for a `print`, by printing it instead of what it printed before. The
 * statement is rewritten, never added or removed, so the program still
 * renders to exactly the line count it was fitted to.
 *
 * `reads` is how many times each name is read in the program as it stands. A
 * print is only retargeted when what it prints is read somewhere else too,
 * since trading one unread variable for another repairs nothing.
 */
function readIn(stmt: Stmt, variable: Variable, reads: ReadonlyMap<string, number>): boolean {
  // A statement never reads the variable it is writing: the generator refuses
  // `mode = mode` everywhere else and this may not sneak one in.
  const target =
    stmt.kind === 'assign' || stmt.kind === 'compound' || stmt.kind === 'declare'
      ? stmt.name
      : undefined;
  if (target === variable.name) {
    return false;
  }

  switch (stmt.kind) {
    case 'declare': {
      const init = withRef(stmt.init, variable.type, variable.name);
      if (init === undefined) return false;
      stmt.init = init;
      return true;
    }
    case 'assign':
    case 'compound': {
      const value = withRef(stmt.value, variable.type, variable.name);
      if (value === undefined) return false;
      stmt.value = value;
      return true;
    }
    case 'print': {
      const value = withRef(stmt.value, variable.type, variable.name);
      if (value !== undefined) {
        stmt.value = value;
        return true;
      }
      // A print of a plain reference: print the unread variable instead, as
      // long as the one it prints today is not left unread by the swap.
      if (stmt.value.kind !== 'ref' || (reads.get(stmt.value.name) ?? 0) <= 1) {
        return false;
      }
      stmt.value = { kind: 'ref', name: variable.name, type: variable.type };
      return true;
    }
    case 'if':
    case 'while':
    case 'doWhile': {
      const condition = withRef(stmt.condition, variable.type, variable.name);
      if (condition === undefined) return false;
      stmt.condition = condition;
      return true;
    }
    case 'for': {
      const limit = withRef(stmt.limit, variable.type, variable.name);
      if (limit === undefined) return false;
      stmt.limit = limit;
      return true;
    }
  }
}

/**
 * Gives never-read variables something to be read by.
 *
 * Half of every snippet used to be variables nothing ever looked at, which is
 * not what code does. This runs after the line count is settled and only ever
 * swaps a literal for a reference, so it cannot change how many lines the
 * program renders to — the fitting loop is never re-entered.
 *
 * It repairs what it can and leaves the rest. A snippet with no dead store at
 * all would be its own kind of unreal.
 */
function useTheUnread(ctx: Ctx, program: Program): void {
  const declared = declarations(program);
  // Bounded by the number of declarations: each pass must repair at least one
  // or it stops, so this cannot spin.
  for (let pass = 0; pass < declared.length; pass += 1) {
    const reads = readNames(program);
    const unread = declared.filter((variable) => !reads.has(variable.name));
    if (unread.length === 0) {
      return;
    }

    let repaired = false;
    for (const variable of unread) {
      const sites: Stmt[] = [];
      sitesFor(program, variable.name, false, sites);
      // Tried on a copy first: the filter must not leave half the program
      // rewritten by statements that were only being considered.
      const usable = sites.filter((stmt) => readIn({ ...stmt }, variable, reads));
      if (usable.length === 0) {
        continue;
      }
      if (readIn(ctx.rng.pick(usable), variable, reads)) {
        repaired = true;
      }
    }
    if (!repaired) {
      return;
    }
  }
}

function genStatement(ctx: Ctx, depth: number, recent: readonly Stmt[], allowBlock = true): Stmt {
  const before = new Set(ctx.reads);
  let stmt = genStatementOnce(ctx, depth, allowBlock);
  for (let attempt = 0; attempt < 2 && repeatsShape(recent, stmt); attempt += 1) {
    ctx.reads = new Set(before);
    stmt = genStatementOnce(ctx, depth, allowBlock);
  }
  // Still repeating means the scope has nothing else to talk about. Declaring
  // introduces a fresh name, which is both a new subject and more material.
  if (repeatsShape(recent, stmt)) {
    ctx.reads = before;
    return genDeclaration(ctx);
  }
  return stmt;
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
  // Repeats are the weighting. Filtering is what a missing capability does, so
  // a language that has every kind draws from the identical list and its output
  // does not move.
  const kinds = BLOCK_KINDS.filter((candidate) => candidate !== 'doWhile' || ctx.caps.doWhile);
  const kind = ctx.rng.pick(kinds);

  if (kind === 'for') {
    const variable = loopVariable(ctx);
    const ints = ctx.table.visibleOfType('int');
    const limit: Expr =
      ints.length > 0 && ctx.rng.chance(0.3)
        ? ref(ctx, ctx.rng.pick(ints).name, 'int')
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
  // The cap: nothing new is declared while something already in scope is
  // waiting to be read. Per type this does nothing — refusing an int just
  // declares a double instead, and the snippet gains the dead variable anyway
  // — so it is the scope as a whole or it is theatre.
  //
  // Below three variables it does not apply. Uncapped, a 35-line snippet could
  // come out with two variables and thirty reassignments between them, which
  // trades one kind of unreal code for another.
  //
  // Something unread means the scope is not empty, so `print` always remains
  // and the candidate list is never empty.
  const declareWeight =
    unread(ctx).length > 0 && assignable.length >= 3 ? 0 : Math.max(1, 7 - visible.length * 2);
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
      return { kind: 'print', value: ref(ctx, target.name, target.type) };
    }
    default:
      return genDeclaration(ctx);
  }
}

function genDeclaration(ctx: Ctx): Stmt {
  const type = pickDeclarationType(ctx);
  const name = freshName(ctx, type);
  // Depth 1 disables arithmetic: declarations read `int n = 27;`, and the
  // operators live in the assignments and compounds instead.
  const init = genExpr(ctx, type, 1);
  // A name comes back around: `freshName` only avoids what is visible, so an
  // `n` read inside a closed block would otherwise vouch for the next `n`.
  // This declaration is a new variable and starts unread.
  ctx.reads.delete(name);
  ctx.table.declare(name, type);
  return { kind: 'declare', name, type, init };
}

/**
 * Variables in scope that nothing has read yet.
 *
 * Half of every snippet used to be variables nobody looked at, and the reason
 * is here rather than in any single statement — generation declared a fourth
 * variable while the third was still untouched, because the only thing
 * weighing against a declaration was how full the scope was. Repairing that
 * afterwards reaches only the ones that happen to have a later statement with
 * a spare literal in it; not creating them has no such gap.
 *
 * Loop counters are exempt. A `for (int i = 0; ...)` whose body never names
 * `i` is ordinary code, and it would otherwise hold up every declaration for
 * the rest of the block.
 */
function unread(ctx: Ctx): Variable[] {
  return writable(ctx, ctx.table.visible()).filter((variable) => !ctx.reads.has(variable.name));
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
    // `7 % i` divides by zero on the loop's first pass. Any variable might
    // hold zero, but a counter always does to start with, so only counters
    // are kept off the right of a modulus.
    const rightExclude = op === '%' ? [...exclude, ...ctx.loopVariables] : exclude;
    const generated = genExpr(ctx, type, depth + 1, rightExclude);
    // `i - i` and `48 % 48` are noise, and `x % x` is a division by nothing.
    const right = sameOperand(left, generated) ? otherThan(ctx, type, generated) : generated;
    // `1 * 12` and `% 1` are arithmetic that does nothing.
    const leftOperand = degenerate ? atLeastTwo(ctx, left) : left;
    const rightOperand = degenerate ? atLeastTwo(ctx, right) : right;

    // `limit = 12 - 7;` is a constant with extra steps — a compiler folds it
    // and a reader does too. At least one side has to be a variable, so the
    // arithmetic is about something.
    if (leftOperand.kind !== 'ref' && rightOperand.kind !== 'ref') {
      const inScope = available(ctx.table.visibleOfType(type), exclude);
      if (inScope.length === 0) {
        // Nothing to name yet — the first declaration in a snippet has an
        // empty scope. A plain literal beats a folded sum.
        return genLiteral(ctx, type, depth > 0);
      }
      return {
        kind: 'binary',
        op,
        left: ref(ctx, ctx.rng.pick(inScope).name, type),
        right: rightOperand,
      };
    }

    return { kind: 'binary', op, left: leftOperand, right: rightOperand };
  }

  const inScope = available(ctx.table.visibleOfType(type), exclude);
  if (inScope.length > 0 && ctx.rng.chance(ctx.config.reuseRate)) {
    return ref(ctx, ctx.rng.pick(inScope).name, type);
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
    return fractional(ctx, 2, OPERAND_MAX - 1);
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
    // Stepping over a whole number: 5.9 becomes 6.1, never 6.0.
    const tenths = replacement.tenths + 1;
    return { kind: 'double', tenths: tenths % 10 === 0 ? tenths + 1 : tenths };
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
    return ref(ctx, ctx.rng.pick(booleans).name, 'boolean');
  }

  return { kind: 'boolean', value: ctx.rng.chance(0.5) };
}

/**
 * Ordering comparisons, which every type may use. Doubles get these and
 * nothing else: `if (ratio == 4.9)` is a bug in real code — the literal is
 * not the value the arithmetic lands on — and every linter worth the name
 * says so. Nothing here executes, but a snippet that teaches the eye a
 * mistake is still the wrong text to practise on.
 */
const ORDERING_OPS = ['<', '<=', '>', '>='] as const satisfies readonly CompareOp[];
const EQUALITY_OPS = ['==', '!='] as const satisfies readonly CompareOp[];

function comparison(ctx: Ctx, left: Variable, exclude: readonly string[] = []): Expr {
  const op = ctx.rng.pick(
    left.type === 'double' ? ORDERING_OPS : [...ORDERING_OPS, ...EQUALITY_OPS],
  );
  return {
    kind: 'compare',
    op,
    left: ref(ctx, left.name, left.type),
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
      op: ctx.rng.pick(EQUALITY_OPS),
      left: ref(ctx, target.name, 'string'),
      right: genLiteral(ctx, 'string'),
    };
  }

  const booleans = ctx.table.visibleOfType('boolean');
  if (booleans.length > 0) {
    const target = ctx.rng.pick(booleans);
    return ref(ctx, target.name, 'boolean');
  }

  // Unreachable in practice: blocks are only generated once a number exists.
  return { kind: 'boolean', value: true };
}

/**
 * A double with a nonzero tenths digit. A whole-numbered one has no honest
 * TypeScript spelling — `5.0` is decoration there and `5` reads as an int —
 * so none are generated, and a double looks like one in every language.
 */
function fractional(ctx: Ctx, minWhole: number, maxWhole: number): Expr {
  return { kind: 'double', tenths: ctx.rng.int(minWhole, maxWhole) * 10 + ctx.rng.int(1, 9) };
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
      return fractional(
        ctx,
        0,
        small ? OPERAND_MAX - 1 : Math.floor(ctx.config.doubleTenthsMax / 10),
      );
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

/**
 * A reference, recorded. Every read in a generated program goes through here,
 * so the declaration cap can ask what has been used without walking the tree
 * it is still in the middle of building.
 */
function ref(ctx: Ctx, name: string, type: ValueType): Expr {
  ctx.reads.add(name);
  return { kind: 'ref', name, type };
}

/**
 * A name for a variable of `type`, drawn from that type's pool — so a boolean
 * is never called `size`. The type is settled before the name is asked for,
 * which is what makes this possible at all.
 */
function freshName(ctx: Ctx, type: ValueType): string {
  const pool = ctx.config.identifiers[type];
  const unused = pool.filter((name) => !ctx.table.isVisible(name));
  if (unused.length > 0) {
    return ctx.rng.pick(unused);
  }
  // Pool exhausted: suffix until it's free, so a declaration never shadows.
  // Measured across 3600 snippets — three languages, all three line presets,
  // 400 seeds each — this path never fired: the worst case held 5 ints of 10
  // and 4 doubles of 6 at once. It is a guarantee, not a hot path.
  const base = ctx.rng.pick(pool);
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
