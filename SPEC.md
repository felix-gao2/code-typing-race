# Code Typing Race — Project Spec

A typing test for code. You type generated, syntactically-valid code snippets
instead of prose. Solo by default, racing optional.

*A typing trainer for developers, where the code you type is procedurally
generated so you never run out and never memorize it.*

**References:** Monkeytype for feel — minimal, no chrome, you land and you're
already typing; copy this instinct above all else. TypeRacer for multiplayer
structure only (public matchmaking + private rooms), not its UI or its waiting
room.

---

## Product decisions (settled — do not relitigate)

**Solo is the default.** The landing page *is* the solo game. No mode picker,
no splash, no modal. Page loads, snippet on screen, cursor ready; the first
character starts the run. Racing lives in a quiet Monkeytype-style top bar
(muted text, no boxes, no colour). The strongest entry point into racing is the
**results screen** — someone holding a number is at peak intent for "race
this."

**Three modes.** Solo (instant start, instant restart). Public race (one click,
dropped into an available race, snippet not chosen by you). Private room (you
create it, share a link, control language and difficulty; waiting is expected
because you're waiting for specific people).

A race record **must** store which kind it was, from day one — retrofitting
means dirty data. Private-room results never reach either leaderboard.

Public matchmaking will be thin at launch and that's accepted. Build private
rooms first: they work with two real people and demo by sending a link. What
happens to someone alone in a public race is **undecided** (see `PROGRESS.md`).

**Ghosts — last run only.** One ghost per snippet per user, in localStorage,
overwritten each run. After a solo run, offer "race your last run." No ghost
pool, no other users' runs, no moderation surface. Ghosts do **not** fill empty
race slots; empty public races are just empty.

**No accounts at launch.** Identity is an anonymous UUID in localStorage; the
display name is a label on it, with length and character limits (names on a
public board are a moderation surface whether or not one is wanted). Clearing
storage means becoming a new player. Real auth is deferred and may never be
needed.

**Cheating is deferred**, with one exception. Paste is blocked (ctrl/cmd-V,
middle-click, drag-drop). And the **server never trusts a client-reported WPM
or accuracy**: a run submits its keystream (events with timestamps) and the
server replays it through the shared typing engine. That costs almost nothing
because the engine is shared already, and a public board with no accounts can't
accept `{wpm: 400}` off a socket. **A ghost is the same keystream**, so one
format serves recording, replay and validation. Timing-anomaly detection stays
deferred.

---

## The snippet generator

The centerpiece, not a content-loading detail. Procedural generation — not
scraped, not hand-written, not LLM-generated. Infinite output, unmemorizable,
no licensing concerns, and difficulty becomes a dial you set rather than a
property you measure.

### Target output

Generated Java, medium difficulty:

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

The logic goes nowhere and nothing computes anything meaningful. That's
intended — Monkeytype's prose is equally meaningless. The user isn't reading
it, they're typing it.

### Rules

- **Syntactic validity only.** Balanced brackets, well-formed statements,
  parses cleanly. It does not need to compile or type-check.
- **No frequency quotas.** No "every snippet needs a loop." Three flat
  declarations is a valid snippet; three nested loops is too. The randomness is
  the point.
- **Structural necessity only.** A block body must hold at least one statement.
  That's structural, not a quota.
- **Reasonable literal bounds.** No 8-digit ints, no paragraph strings. Bounds
  live in a config table, tuned by reading output.
- **No shadowing.** A declaration never reuses a name visible in an enclosing
  scope — trivial with the symbol table, and redeclaration looks wrong to any
  developer reading it.

### Architecture

A function emits a **statement**: it rolls a kind (declaration, assignment,
compound assignment, print, `if`, `for`, `while`, `do-while`) and either
returns one node, or pushes a scope, recurses 1–3 times for the body, and pops.

Recursion is what produces structural variety — a `for` containing an `if`
containing two assignments emerges naturally, and two seeds give genuinely
different structure rather than a permuted template.

**Emit a tree, then print it.** The statement function builds a typed AST node;
a per-language **printer** renders the finished tree. It never emits strings
directly. This makes structural rules (non-empty bodies, depth caps) assertions
on a tree, and makes a new language a printer plus a type map rather than a
second generator — Python's indentation becomes a printer that indents instead
of bracing. Statement kinds a language lacks (Python has no do-while) are
switched off through a per-language capability set.

**Symbol table:** a stack of scopes, each a map of name → type. Declaring
pushes into the current scope; generating an expression asks for a visible
variable of a type and falls back to a literal; entering a block pushes,
leaving pops. This is what makes variables reappear across a snippet instead of
every line being an island. Declared-but-unused variables are fine.

**Sizing and naming.** Each tier carries a character budget (~200–350 chars,
about a one-minute run; the sample above is ~220); top-level generation stops
once it's exceeded. Identifiers come from a curated word list (`count`,
`total`, `idx`, `buf`, `tag`, `rate`), not random letters; loop variables nest
`i`, `j`, `k`.

**Difficulty** is derived from config, never measured: nesting depth cap,
symbol density, operator frequency, identifier length, variable reuse rate.
Exposed to the user as coarse tiers.

### Determinism — non-negotiable

`(seed, language, tier) → snippet text` is pure and reproducible: same inputs,
byte-identical output. Seeded RNG threaded throughout, no global `Math.random`,
no reliance on map iteration order, timestamps or environment.

This matters because **a snippet is stored as its seed**, not its text — stable
IDs for ghosts, tiny storage, and the ability to pre-generate a pool *and*
generate fresh on demand. Easy upfront, miserable to retrofit.

**Identity is `(generatorVersion, language, tier, seed)`.** A seed alone isn't
an identity: the generator gets tuned constantly, and every tune silently
changes the text behind every existing seed, so a week-old ghost would replay
against text that no longer exists.

- `tier` is a named preset (`easy`, `medium`, `hard`), never a freeform config
  object, or identity fragments across arbitrary configs
- `generatorVersion` is a manually bumped integer exported by the generator
- **snapshot tests over fixed seeds** — any output change fails CI, forcing a
  deliberate version bump instead of a silent one
- race snippets travel over the wire **as text**, since web and server deploy
  independently and can run different versions

### Languages

Several languages, sharing one tree generator and one printer per language.
Launch set: **Java, TypeScript, Python**, implemented in that order.

Java goes first because braces, semicolons and explicit types make its grammar
the most rigid, so it's the easiest to get right; the tree gets tuned against
Java before the other printers are written. Python is last because significant
indentation is the fiddliest printer. Tuning one language at a time is
deliberate — tuning four outputs at once means none of them get good.

**Go was dropped from the launch set.** Its rigid grammar made it a convenient
implementation target, which is the generator's interest rather than a
player's; Java already supplies that rigidity while being a language people
want to practise. Nothing is lost by deferring it.

**More languages can be added at any time, and later is no more expensive than
now.** Identity is `(generatorVersion, language, tier, seed)`, so a new
language only mints new tuples: existing snippets, runs and leaderboards are
untouched and `generatorVersion` does not move. TypeScript is the proof — it
was added after Java without changing a byte of Java output. A language costs a
printer, an entry in `LANGUAGES`, and its capability flags. What keeps that
true is that no language-specific logic may leak into the tree generator or
into the shared invariant tests; Java plus Python is the pair that proves it,
because one braces and the other indents. The C-family additions (C#, C++,
JavaScript) are close to free once Java exists — with the caveat that C++ has
the most ways to look wrong to someone who writes it, and a safe generated
subset will read as beginner C++.

TypeScript is the implementation language: same as the rest of the stack, runs
on server or client, one less runtime to deploy.

### Build it standalone first

A CLI taking a seed, language and tier, printing to stdout. No server, no
database, no frontend. Run it 50 times, read the output, tune until it
consistently resembles the sample above. Validate by generating thousands of
seeds in tests and parsing the output with a **real parser as a devDependency
only** — the runtime stays dependency-free.

Do not build this inside the web app; you'll be restarting a server to look at
text and you'll tune it badly.

---

## Typing behaviour

**Auto-indent: yes.** Leading whitespace is never typed. After Enter the caret
lands on the first non-whitespace character of the next line, whatever its
indentation; blank lines are skipped the same way. (Stating it as "the line
after `{` gets indented" is wrong — it misses the dedent onto a closing `}`.
Reading indentation from the target text handles both and covers Python without
a special case.) Skipped characters are never counted toward WPM.

**Autocomplete and auto-close: no.** No snippet expansion, no auto-closing
brackets, no auto-inserted quotes. If the editor types four characters per
keypress it's a test of who knows the shortcuts, and WPM stops being
comparable. Auto-closing also makes input diverge from the target, which makes
character comparison harder for no benefit. Every character except leading
indentation is typed by the user.

**Backspace / error handling: undecided, deliberately.** Permissive
(Monkeytype: wrong characters are marked, you may continue or fix) versus
blocking (TypeRacer: you cannot advance until it's right). This is a feel
decision that has to be played, so implement **both behind a single flag inside
one comparison function** — switching must be a config change, not a rewrite.
Same treatment for the sub-question of whether corrected errors permanently
cost accuracy. Permissive mode also needs multi-line rules this spec doesn't
settle (what Enter does mid-line, what happens past the end of a line);
Monkeytype's "space skips to the next word" does not translate to code. Decide
inside the engine, not the UI.

**Other details:**

- **Timer starts on the first keystroke** in solo; races use a synced
  countdown.
- **Input capture** is a focused hidden textarea using `beforeinput` / `input`,
  not `keydown`. Dead keys on US-International layouts affect `"`, `'`,
  `` ` ``, `^` and `~` — all high-frequency in code — and IME composition
  breaks naive keydown handling. It also sidesteps Firefox's quick-find, which
  fires on `'` and `/` outside a text field.
- **WPM**: standard is characters ÷ 5. Code's symbol density makes that read
  low against Monkeytype and may feel discouraging; standard (comparable,
  honest) versus code-adjusted (flattering, non-comparable) is open, leaning
  standard.
- **Mobile**: show a clear "desktop required" state rather than letting people
  flail.

---

## Architecture

**Three pure modules, framework-free, connected last.** These are the parts
that are actually hard and the parts worth pointing at in an interview; built
inside React components, all of that is lost.

1. **Generator** — `(seed, language, tier) → snippet text`. No dependencies, no
   I/O, CLI-first, deterministic.
2. **Typing engine** — `(target text, input events) → per-character state,
   progress, WPM, accuracy, error count`. No DOM, no React, no network. The
   backspace flag lives here. Three consumers (solo UI, race UI, server-side
   validation) so it knows about none of them. Unit-tested with synthetic
   keystreams including a physically-impossible one.
3. **Race state machine** — `waiting → countdown → racing → finished`. Events:
   join, leave, disconnect, reconnect, finish, timeout. No sockets.
   **Disconnect-mid-race is the case that rots projects like this** — handle it
   explicitly and test it.

**Time is an input, never read.** No module reads the clock. Keystroke events
carry timestamps; the race machine takes `tick(now)` and returns deadlines for
the server to schedule rather than setting timers. Without this the
physically-impossible-keystream test can't be written.

**Every run records how it was produced** — `engineMode` and
`generatorVersion`, for the same reason a race record stores its kind. If the
backspace flag ever becomes a user setting, runs under different modes aren't
comparable and nothing would distinguish them after the fact.

### Layers on top

- **Typing surface** — React component wrapping the engine. Characters, caret,
  cursor. No game logic.
- **Server** — Express + Socket.io wrapping the race machine, plus the
  generator.
- **Storage** — Postgres via Drizzle: snippet seeds, run records, leaderboards.
  Ghosts stay in localStorage; with no accounts there's no cross-device story
  for a ghosts table to serve.

### Leaderboards

Two boards, **solo** and **multiplayer**, never mixed — solo gets practised far
more, so merging would bury every race result. Each is split by **language +
difficulty tier** so an easy snippet never competes with a symbol-heavy one.
Within a board: ranked by **WPM**, accuracy as tiebreaker, **≥90% accuracy to
qualify** (without a floor the top is people spamming at 60%), **one entry per
player** (their best), in **daily and all-time** variants.

This is the Monkeytype model — everyone types different random text and still
shares a board. Per-snippet boards were the earlier plan and are dropped: with
infinite snippets, nearly every one would hold a single entry. Ghosts and
rematches stay per-snippet; they don't need a board.

### Stack

**TypeScript everywhere, strict from the first commit.** The generator is a
recursive tree walker with a typed symbol table (discriminated unions do real
work), the engine is shared between client and server and needs one type
contract, and determinism bugs fail silently rather than throwing.

**Pure core** (`packages/`) — no framework, no dependencies: `generator`,
`typing-engine`, and later `shared-types`. Vitest. `shared-types` is created at
step 6 when there's a wire protocol to describe, holding plain TypeScript
types; Zod schemas stay in `apps/server`.

Determinism and boundary rules are enforced by **ESLint**, not memory:
`Math.random` and `Date.now` banned inside `packages/**`, as are imports of
React, Express, Socket.io and database clients. A determinism bug fails
silently, so it should fail the build.

**Frontend** (`apps/web`) — React 19 + Vite. Tailwind driven by a tokens file:
six named colours, a type scale, a spacing scale, and components referencing
variables only. Tailwind v4's `@theme` resets the default palette
(`--color-*: initial`) so `text-blue-500` stops existing — enforced by the
build, not by discipline. No component library (~six components, and the typing
surface is hand-built regardless). No state manager; `useState` plus one
context. React Router only if more than a couple of views appear.
`socket.io-client` for races. Deployed on **Vercel**, with Web Analytics from
step 4 (otherwise there's no way to tell whether shipping worked) and Open
Graph tags from step 3 (room links get pasted into Discord, and a link with
no preview looks broken).

**Backend** (`apps/server`) — Node 24 + Express 5 (24 is active LTS; 22 is in
maintenance, EOL April 2027). **Socket.io** over raw `ws` for automatic
reconnection and room primitives — reconnection is the case that matters.
**Zod** for anything off the wire. Rate limiting on run submission from step 8.
Deployed on **Fly.io**: WebSockets need a persistent process, so serverless
isn't an option. Fly has no free tier for new organisations (a small always-on
machine is a few dollars a month — confirm before step 6), and Vercel ↔ Fly is
cross-origin, so Socket.io needs CORS.

**Database** — Postgres on **Neon** with **Drizzle**, which is SQL-shaped so
leaderboard queries stay readable: "best run per player, ranked by WPM within a
language and tier" is a window function and should look like one. Tables:
`snippets` (generator version, language, tier, seed), `runs`, `races`. Not
MongoDB — the data is relational, and the MERN-gap reason is already covered by
another project.

**Redis:** not at launch. It goes in when a second instance is deployed and
rooms break across them; then it earns both its place and its answer to "why
Redis?" Room state is ephemeral and in-memory until then.

**Tooling:** pnpm workspaces, Vitest, Prettier + ESLint configured before the
first real commit (to avoid a formatting mega-diff), GitHub Actions running
typecheck/lint/test, Node pinned in `.nvmrc`. **Deliberately omitted:** Docker,
Turborepo, ts-rest, tRPC, monorepo build orchestration — team-scale problems
this project doesn't have.

### Repo structure

```
packages/generator
packages/typing-engine
packages/shared-types
apps/web
apps/server
```

The typing engine being shared between client and server is the main reason for
workspaces at all.

**Infrastructure arrives when it's needed.** Steps 1–4 need no server and no
database — ghosts are localStorage and solo runs are local. The initial
scaffold is `packages/generator` alone; `apps/server` at step 5/6; Neon and
Drizzle at step 8.

---

## Build order

1. **Generator CLI** — tune by reading output
2. **Typing engine + deliberately ugly solo page** — a text box and some
   numbers
3. **Design pass** — its own session: tokens file, typeface, the three
   character states, the caret. The typing surface only. Before shipping, so
   the first public link already looks intentional.
4. **Ship it.** Solo-only, deployed, working — a complete product.
5. Race state machine
6. Sockets + private rooms
7. Public matchmaking
8. Polish, results screen, leaderboards

Play the ugly version before styling anything. The backspace decision and most
feel questions resolve themselves in ten minutes of actually typing.

---

## Explicit non-goals

- Not a Monkeytype clone — it's solo prose; generated code and racing are why
  this exists.
- Not Monkeytype's architecture (~13.5k commits, five years, hundreds of
  contributors).
- No copying Monkeytype source. GPL-3.0: reading to learn is fine, copying
  obligates this project to GPL and looks bad under a diff.
- No accounts, OAuth or email at launch.
- No code execution, compilation, or syntax highlighting of user input.
- No custom snippet upload.
- No mobile typing support.
