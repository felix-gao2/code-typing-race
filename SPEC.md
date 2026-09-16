# Code Typing Race — Project Spec

## What this is

A typing test for code. You type generated, syntactically-valid code snippets
instead of prose. Solo by default, with optional racing against other people.

The two reference products, and the only ones to draw from:

- **Monkeytype** (https://monkeytype.com) — the standard for feel. Minimal, no
  chrome, you land and you're already typing. Copy this instinct above all else.
- **TypeRacer** (https://play.typeracer.com) — the reference for the multiplayer
  structure only (public matchmaking + private rooms). Do not copy its UI or its
  waiting-room experience.

The one-line pitch: *a typing trainer for developers, where the code you type is
procedurally generated so you never run out and never memorize it.*

---

## Product decisions (settled — do not relitigate)

### Solo is the default

The landing page **is** the solo game. No mode picker, no splash screen, no
modal. Page loads, snippet is on screen, cursor is ready. Typing the first
character starts the run.

Racing is discoverable but not shouted. A small, quiet top bar (Monkeytype-style
— muted text, no boxes, no color) is sufficient. The strongest entry point into
racing is the **results screen**, not the landing page: someone who just finished
a run and has a number in front of them is at peak intent for "race this."

### Three modes

1. **Solo** — instant start, instant restart, zero waiting. The default and the
   most-used mode.
2. **Public race** — one click, dropped into an available race. You don't choose
   the snippet. Results count toward leaderboards.
3. **Private room** — you create it, get a shareable link, invite people. You
   control language/difficulty. Waiting is expected here because you're waiting
   for specific people.

A race record **must** store which kind it was, from day one. Retrofitting that
distinction later means dirty leaderboard data. Private-room results never
appear on either leaderboard.

Public matchmaking will be thin at launch — with low traffic it's mostly empty.
This is known and accepted. Build private rooms first; they work perfectly with
two real people and are demoable by sending a link.

What happens to someone sitting alone in a public race is **undecided** — start
anyway after a short wait, or keep waiting. See `PROGRESS.md`.

### Ghosts — last run only

No ghost pool, no stored runs from other users, no moderation surface.

Store **one ghost per snippet per user**: your most recent (or best) run on that
snippet, overwritten each time you run it. After a solo run, offer "race your
last run." That's the whole feature.

Consequence: ghosts do **not** fill empty multiplayer slots. Public races with
nobody in them are just empty.

### No accounts at launch

Last-run ghosts work in localStorage with zero backend. Real auth is deferred
and may never be needed.

Identity is an **anonymous UUID in localStorage**; the display name is a label
attached to it, with length and character limits. Names on a public board are a
moderation surface whether or not one is wanted, so keep them constrained.
Clearing browser storage means becoming a new player, which is acceptable.

### Cheating is deferred

Block paste (ctrl/cmd-V, middle-click, drag-drop).

Beyond that, one rule that isn't really anti-cheat: **the server never trusts a
client-reported WPM or accuracy.** A run submits its keystream — the events,
with timestamps — and the server replays it through the shared typing engine to
compute the numbers itself. This costs almost nothing, because the engine is
shared already, and a public board with no accounts cannot be allowed to accept
`{wpm: 400}` off a socket.

A **ghost is the same keystream**, so one data format serves recording, replay
and validation.

Timing-anomaly detection and plausibility analysis stay deferred. Revisit only
if leaderboards attract actual abuse.

---

## The snippet generator

This is the distinctive part of the project. Treat it as the centerpiece, not a
content-loading detail.

### Approach: procedural generation

Not scraped from repos, not hand-written, not LLM-generated. A recursive random
generator with a symbol table.

Rationale: infinite output, unmemorizable, zero licensing concerns, and
difficulty becomes a dial you set rather than a property you measure.

### Target output

This is the style target. Generated Java, medium difficulty:

```java
int n = 27;
String tag = "ab9";
double rate = 4.5;

for (int i = 0; i < 6; i++) {
    n += i * 2;
    rate = n - 13;
    System.out.println(tag);
}

if (n != 84) {
    boolean ok = rate < n;
    tag = "z4";
}
```

Note what this is and isn't. The logic goes nowhere. Nothing computes anything
meaningful. That's fine and intended — Monkeytype's prose is equally
meaningless (`the and for you with have` is not a sentence). The user is not
reading it, they're typing it. The motor skill is what's being tested.

### Rules

**Syntactic validity only.** Brackets balanced, statements well-formed, parses
cleanly. It does **not** need to compile or type-check. `String tag = "ab9";`
followed later by `tag = n + 1;` is acceptable — it parses, it just wouldn't
compile. Nobody is compiling these.

**No frequency quotas or imposed ratios.** There is no rule that a snippet must
contain a print, or a loop, or an `if`. If a seed produces three flat
declarations and nothing else, that's a valid snippet. If another produces three
nested loops, also valid. The randomness is the point. Do not add "at least one
X" constraints beyond structural necessity.

**Structural necessity only.** A block statement must have at least one statement
in its body — an `if` with an empty body is malformed-looking and pointless. That
is a structural rule, not a frequency quota.

**Reasonable literal bounds.** Ints shouldn't be 8 digits long. Strings shouldn't
be paragraphs. Exact bounds go in a config table and are tuned by reading output,
not decided upfront.

### Architecture

A function that emits a **statement**. It rolls for a kind — declaration,
assignment, compound assignment, print, `if`, `for`, `while`, `do-while` — and:

- simple statement → emit one line, return
- block statement → emit header, push scope, recurse 1–3 times to fill the body,
  pop scope, emit closing brace

The recursion is what produces real structural variety. A `for` containing an
`if` containing two assignments emerges naturally; you never enumerate
combinations by hand. Two different seeds give genuinely different structure, not
a permuted template.

### Emit a tree, then print it

The statement function builds a **typed AST node**. A per-language **printer**
renders the finished tree to text. It does not emit strings directly.

The extra layer is small and buys two things. Structural rules (non-empty block
bodies, nesting depth caps) become assertions on a tree instead of string
inspection. And a new language becomes a printer plus a type map, rather than a
second generator — Python's significant indentation stops being a special case,
it's just a printer that indents instead of bracing. Statement kinds a language
lacks (Go has no do-while) are switched off through a per-language capability
set.

### Symbol table

A stack of scopes, each a map of name → type.

- Declaring pushes into the current scope
- Generating an expression asks the table for a visible variable of a given type;
  if one exists, use it, otherwise emit a literal
- Entering a block pushes a scope, leaving pops it

This is what makes variables reappear across a snippet instead of every line
being an island — and typing a name you typed three lines ago is a real part of
what coding feels like. Declared-but-unused variables are fine and realistic.

Variable **reuse rate** is a good difficulty axis: low reuse means mostly fresh
declarations, high reuse means more reference to existing names.

**No shadowing.** A declaration never reuses a name visible in an enclosing
scope. The symbol table makes this trivial to enforce, and redeclaration looks
wrong to any developer reading the snippet.

### Sizing and naming

**Length.** Each tier carries a character budget — roughly 200–350 characters,
about a one-minute run at code-typing speeds (the Java sample above is ~220).
Top-level statement generation stops once the budget is exceeded.

**Identifiers.** Drawn from a curated word list (`count`, `total`, `idx`,
`buf`, `tag`, `rate`), not random letters. Loop variables nest `i`, `j`, `k`.
Identifier length is already a difficulty axis.

### Determinism — non-negotiable

`(seed, language, config) → snippet text` must be pure and reproducible. Same
inputs always produce byte-identical output.

- Seeded RNG threaded through the whole generator
- No calls to global `Math.random` / `random`
- No reliance on map/dict iteration order, timestamps, or environment

This matters because a **snippet is stored as its seed**, not its text. That
gives stable snippet IDs for ghosts, tiny storage, and the ability to
pre-generate a pool *and* generate fresh on demand.

Easy to guarantee upfront. Miserable to retrofit.

### Snippet identity includes a generator version

A seed alone is not an identity. The generator gets tuned constantly — that is
build step 1 — and every tune silently changes the text behind every existing
seed. A ghost recorded last week would then replay against text that no longer
exists, with nothing to detect it.

- identity is **`(generatorVersion, language, tier, seed)`**
- `tier` is a **named preset** (`easy`, `medium`, `hard`), never a freeform
  config object — otherwise identity fragments across arbitrary configs
- `generatorVersion` is a manually bumped integer exported by the generator
- **snapshot tests over fixed seeds**: any change in output fails CI, which
  forces a deliberate version bump instead of a silent one
- race snippets travel over the wire **as text**, because `apps/web` and
  `apps/server` deploy independently and can be running different versions

### Difficulty

Derived from config, not measured: nesting depth cap, symbol density, operator
frequency, identifier length, variable reuse rate. Expose as coarse tiers to the
user.

### Leaderboards

Two boards, **solo** and **multiplayer**, never mixed. Solo gets practised far
more, so the numbers aren't comparable and merging them would bury every race
result.

Each board is split by **language + difficulty tier**, so an easy snippet never
competes against a symbol-heavy one. Within a board:

- ranked by **WPM**, with **accuracy as the tiebreaker**
- **≥90% accuracy to qualify** — without a floor, the top of the board is
  people spamming keys at 60% accuracy
- **one entry per player** (their best), so a board isn't one person's runs
- **daily and all-time** variants

This is the Monkeytype model: everyone types different randomly generated text
and still shares one board. Per-snippet boards were the earlier plan and are
dropped — with infinite generated snippets, nearly every per-snippet board
would hold exactly one entry.

Ghosts and rematches stay per-snippet regardless. They don't need a board.

### Build it standalone first

A CLI: takes a seed and a language, prints a snippet to stdout. No server, no
database, no frontend. Run it 50 times, read the output, tune until it
consistently resembles the Java sample above.

Validate it by generating thousands of seeds in tests and parsing the output
with a **real Java parser, as a devDependency only** — the generator's runtime
stays dependency-free.

Do not build this inside the web app. You'll be restarting a server to look at
text and you'll tune it badly.

### Languages

Start with one. Java or Go is easiest — braces, semicolons, and explicit types
make the grammar most rigid and therefore simplest to get right. Python's
significant indentation is trickier to generate cleanly. Add languages after the
first one is good.

TypeScript is the preferred implementation language for the generator (same
language as the rest of the stack, runs on server or client, one less runtime to
deploy). The generator has no dependencies, so this is reversible.

---

## Typing behaviour

### Auto-indent: yes

**Leading whitespace is never typed.** After Enter, the caret lands on the
first non-whitespace character of the next line, whatever its indentation.
Blank lines are skipped the same way.

Stating this as "the line after `{` gets indented" is wrong — it doesn't handle
the dedent onto a closing `}`. Reading indentation from the target text handles
both, and covers Python's significant indentation without a special case.

Pure quality-of-life, removes a boring keystroke, advantages nobody. It also
settles the blank-line question below: skipped characters are never counted.

### Autocomplete and auto-close: no

**Do not replicate VS Code's editing behaviour.** No snippet expansion (typing
`for` + tab producing a skeleton), no auto-closing brackets, no auto-inserted
quotes.

Reasoning: if the editor types four characters for every one the user presses,
it's no longer a typing test — it's a test of who knows the shortcuts, and WPM
becomes incomparable between users. Auto-closing brackets also cause the user's
input and the target text to diverge, which makes character comparison
significantly harder for no benefit.

Every character in the target (except leading indentation) is typed by the user.

### Backspace / error handling: undecided, deliberately

The two candidates:

- **Permissive** (Monkeytype) — mistyped characters are marked wrong, you can
  continue or backspace to fix
- **Blocking** (TypeRacer) — you cannot advance until the character is correct

This is a feel decision that can't be reasoned out. It has to be played.

**Therefore:** implement both behind a single flag inside one comparison
function. Do not scatter this logic through the input handler. Switching modes
must be a config change, not a rewrite.

Open sub-question, same treatment: do corrected errors still cost accuracy
permanently?

Permissive mode also needs multi-line rules this spec doesn't settle: what
Enter does mid-line, and what happens when you type past the end of a line.
Monkeytype's "space skips to the next word" does not translate to code. Decide
it inside the engine, not in the UI.

### Other typing details

- **Timer starts on first keystroke** in solo. Races use a synced countdown.
- **Input capture**: a focused hidden textarea using `beforeinput` / `input`,
  not `keydown`. Dead keys on US-International layouts affect `"`, `'`,
  `` ` ``, `^` and `~` — all high-frequency in code — and IME composition
  breaks naive keydown handling. It also sidesteps Firefox's quick-find, which
  fires on `'` and `/` when focus isn't in a text field.
- **WPM metric**: standard WPM is characters ÷ 5. Code has much higher symbol
  density, so raw numbers will read low compared to Monkeytype and may feel
  discouraging. Decide whether to use standard WPM anyway (comparable, honest) or
  a code-adjusted metric (flattering, non-comparable). Leaning standard.
- **Mobile**: a typing test on a phone is nonsense, but people will open the
  link on one. Show a clear "desktop required" state rather than letting them
  flail.

---

## Architecture

The core principle: **three pure modules, framework-free, connected last.**

These three are the parts that are actually hard and the parts worth pointing at
in an interview. If they're built inside React components, all of that is lost
and the project becomes indistinguishable from any other CRUD app.

### 1. Generator (pure)

`(seed, language, config) → snippet text`

No dependencies, no I/O. CLI-first. Deterministic.

### 2. Typing engine (pure)

`(target text, input events) → per-character state, progress, WPM, accuracy, error count`

No DOM, no React, no network. The backspace/blocking flag lives here.

Used by three different consumers — the solo UI, the race UI, and (later)
server-side validation — so it must not know about any of them.

Unit test with synthetic keystreams, including a physically-impossible one, so
that adding server-side validation later is trivial.

### 3. Race state machine (pure)

`waiting → countdown → racing → finished`

Events: join, leave, disconnect, reconnect, finish, timeout. No sockets. Testable
in isolation.

**Disconnect-mid-race is the case that rots projects like this.** Handle it
explicitly and test it.

### Time is an input, never read

None of the three modules reads the clock. Keystroke events carry timestamps,
and the race machine takes a `tick(now)` event and **returns deadlines for the
server to schedule** rather than setting timers itself.

Without this, the "physically impossible keystream" test can't be written and
the state machine isn't testable in isolation.

### Every run records how it was produced

A run stores its `engineMode` (permissive or blocking) and the
`generatorVersion` it was typed against — the same reasoning that makes a race
record store its kind. If the backspace flag ever becomes a user-facing
setting, runs made under different modes aren't comparable, and after the fact
there'd be no way to tell them apart.

### Layers on top

- **Typing surface** — React component wrapping the typing engine. Renders
  characters, caret, cursor. No game logic.
- **Server** — Express + Socket.io wrapping the race state machine, plus the
  generator for snippets.
- **Storage** — Postgres via Drizzle: snippet seeds, run records (with
  public/private flag), leaderboards. **Ghosts live in localStorage** — with no
  accounts there's no cross-device story for a ghosts table to serve.

### Stack

**Language:** TypeScript everywhere, strict mode from the first commit.
Not JavaScript — the generator is a recursive tree walker with a typed symbol
table (discriminated unions do real work there), the typing engine is shared
between client and server and needs one type contract, and determinism bugs in
the generator fail silently rather than throwing.

**Pure core** (`packages/`) — no framework, no dependencies: `generator`,
`typing-engine`, and later `shared-types`. Tested with Vitest.

`shared-types` is created at step 5, when there's actually a wire protocol to
describe, and holds plain TypeScript types. Zod schemas stay in `apps/server`,
since the pure packages are dependency-free.

The determinism and boundary rules are enforced by **ESLint**, not by memory:
`Math.random` and `Date.now` are banned inside `packages/**`, as are imports of
React, Express, Socket.io and any database client. A determinism bug fails
silently, so it should fail the build instead.

**Frontend** (`apps/web`):

- React 19 + Vite
- Tailwind CSS driven by a tokens file — six named colours, a type scale, a
  spacing scale. Components reference variables only, never raw hex or arbitrary
  values. Tailwind v4's `@theme` resets the default palette
  (`--color-*: initial`) so `text-blue-500` stops existing: the rule is
  enforced by the build rather than by discipline.
- No component library. The app is ~six components and the typing surface is
  hand-built regardless.
- No state manager. `useState` plus one context is sufficient.
- React Router only if more than a couple of views are needed.
- `socket.io-client` for race mode.
- Deployed on **Vercel**, with **Vercel Web Analytics** from step 3 — without
  it there's no way to tell whether shipping worked.
- **Open Graph tags and a real page title** from step 2.5. Room links get
  pasted into Discord and group chats, and a link with no preview looks broken.

**Backend** (`apps/server`):

- Node 24 + Express 5. Node 24 is active LTS; 22 is in maintenance with an
  April 2027 end of life, which this project should outlive.
- **Socket.io** — chosen over raw `ws` for automatic reconnection and built-in
  room primitives. Reconnection is the case that matters most here.
- **Zod** for validating anything arriving off the wire.
- **Rate limiting on run submission**, added at step 7 when the boards go live.
  A public board with no accounts needs it.
- Deployed on **Fly.io**. A persistent process is required for WebSockets, so
  serverless is not an option for the server half. Fly no longer has a free
  tier for new organisations — a small always-on machine costs a few dollars a
  month; confirm before step 5. Vercel ↔ Fly is cross-origin, so Socket.io
  needs CORS configured.

**Database:**

- **Postgres** on **Neon**
- **Drizzle ORM** — SQL-shaped, so leaderboard queries stay readable as real
  SQL instead of fighting an abstraction. "Best run per player, ranked by WPM
  within a language and tier" is a window function, and it should look like
  one.
- Tables: `snippets` (generator version, language, tier, seed), `runs`,
  `races`. No `ghosts` table — ghosts are localStorage.
- Not MongoDB. This data is relational — runs reference snippets and players,
  and a board is a ranked aggregation over runs. The original reason for Mongo
  was filling a MERN gap on a resume; that gap is already covered by another
  project, so the reason no longer applies.

**Redis:** not at launch. It goes in when a second server instance is deployed
and rooms break across them — at that point it earns both its place in the repo
and its answer to "why Redis?"

Room state is ephemeral and lives in memory until then.

**Tooling:**

- **pnpm** workspaces
- **Vitest**
- **Prettier + ESLint** configured before the first real commit, to avoid a
  formatting mega-diff later
- **GitHub Actions**: typecheck, lint, test on push
- Node version pinned in `.nvmrc`

**Deliberately omitted:** Docker, Turborepo, ts-rest, tRPC, monorepo build
orchestration. These solve team-scale problems this project does not have.

### Repo structure

pnpm workspaces. Not Turborepo, not ts-rest, not a full monorepo toolchain —
Monkeytype's setup exists because a large team needed it, and copying it means
spending the first two weeks on build config.

```
packages/generator
packages/typing-engine
packages/shared-types
apps/web
apps/server
```

The typing engine is shared between client and server, which is the main reason
for workspaces at all.

**Infrastructure arrives when it's needed, not on day one.** Steps 1–3 need no
server and no database — ghosts are localStorage and solo runs are local. The
initial scaffold is `packages/generator` alone. `apps/server` appears at step
4/5; Neon and Drizzle at step 7, when leaderboards need them.

---

## Build order

1. **Generator CLI** — tune by reading output
2. **Typing engine + deliberately ugly solo page** — a text box and some numbers
2.5. **Design pass** — its own session: tokens file, typeface, the three
   character states, the caret. The typing surface only, nothing else on the
   site. It happens before shipping so the first public link already looks
   intentional.
3. **Ship it.** Solo-only, deployed, working. This is a complete product.
4. Race state machine
5. Sockets + private rooms
6. Public matchmaking
7. Polish, results screen, leaderboards

Play the ugly version before styling anything. The backspace decision and most
feel questions resolve themselves in ten minutes of actually typing.

---

## Explicit non-goals

- Not a Monkeytype clone. Monkeytype is solo prose. The generated code and the
  racing are the reason this exists.
- Not Monkeytype's architecture. That repo is ~13.5k commits over five years with
  hundreds of contributors.
- No copying of Monkeytype source. It's GPL-3.0; reading it to learn is fine,
  copying code obligates this project to GPL and looks bad under a diff.
- No user accounts, no OAuth, no email at launch.
- No code execution, compilation, or syntax highlighting of user input.
- No custom snippet upload.
- No mobile typing support.