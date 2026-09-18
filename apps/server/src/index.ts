import { createServer } from 'node:http';
import { LANGUAGES, type Language } from '@ctr/generator';
import type { RaceConfig } from '@ctr/race-machine';
import express from 'express';
import { Server } from 'socket.io';
import { db } from './db/index.ts';
import { recordRun } from './db/store.ts';
import { attach, runRecordOf, viewOf } from './io.ts';
import { RateLimit } from './limit.ts';
import { Matchmaker } from './matchmaker.ts';
import { Rooms } from './rooms.ts';
import { parseSolo, verifySolo } from './runs.ts';
import { Scheduler } from './schedule.ts';

/**
 * The race server: Express for opening a room, Socket.io for racing in one.
 *
 * All the interesting behaviour lives in the pure race machine; this file is
 * transport and configuration. Nothing here decides anything about a race.
 */

const PORT = Number(process.env.PORT ?? 3001);

/** Where the web app is served from in development. */
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

/**
 * Private-room defaults. Two people is a race; `waitTimeoutMs` is deliberately
 * absent, because a private room waits for the person you sent the link to for
 * as long as it takes.
 */
const PRIVATE_DEFAULTS: RaceConfig = {
  minRacers: 2,
  maxRacers: 8,
  countdownMs: 5000,
  raceTimeoutMs: 5 * 60_000,
};

/**
 * Public matchmaking defaults. `waitTimeoutMs` is the answer to the question
 * that was left open since the machine was written: someone alone in a public
 * race starts after ten seconds rather than waiting for company that a quiet
 * site may never send. The result of a race that started with one person is
 * playable but never ranked — see `ranked` in `io.ts`.
 */
const PUBLIC_DEFAULTS: RaceConfig = {
  minRacers: 2,
  maxRacers: 5,
  countdownMs: 5000,
  raceTimeoutMs: 5 * 60_000,
  waitTimeoutMs: 10_000,
};

/**
 * Run submission is rate limited per address, not per player: a player id is
 * minted by the browser, so anyone flooding the table can mint a fresh one per
 * request. Generous enough that retrying a run every few seconds never hits
 * it. Behind Fly's proxy this needs `trust proxy` to see the real address —
 * without it every request counts against one key, which fails closed rather
 * than open and is the safer way round to get it wrong.
 */
const SUBMIT_PER_MINUTE = 30;
const SUBMIT_WINDOW_MS = 60_000;

/** How long an unopened room link survives before it is swept up. */
const ROOM_GRACE_MS = 30 * 60_000;
const REAP_INTERVAL_MS = 60_000;

const rooms = new Rooms();
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: ORIGIN } });
const scheduler = new Scheduler(rooms, (room) => io.to(room.id).emit('race', viewOf(room)));
const matchmaker = new Matchmaker(rooms, PUBLIC_DEFAULTS);
const submissions = new RateLimit(SUBMIT_PER_MINUTE, SUBMIT_WINDOW_MS);

app.use(express.json());

/**
 * CORS for the HTTP routes. The `cors` option on the Socket.io server covers
 * the socket handshake and nothing else, so without this the browser blocks
 * `POST /rooms` before Express ever sees it — and a Node client does not,
 * which is exactly how it passed a smoke test and failed in a browser.
 *
 * Eight lines rather than a dependency, per the rule about both.
 */
app.use((request, response, next) => {
  response.setHeader('Access-Control-Allow-Origin', ORIGIN);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Caches must not serve one origin's response to another.
  response.setHeader('Vary', 'Origin');
  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_request, response) => {
  response.json({ ok: true, rooms: rooms.size });
});

/**
 * Opens a private room and hands back its code. The snippet is generated here
 * rather than sent by the client, so nobody chooses the text they race on.
 */
app.post('/rooms', (request, response) => {
  const body: unknown = request.body;
  const { language, lines } = body as { language?: unknown; lines?: unknown };

  if (typeof language !== 'string' || !LANGUAGES.includes(language as Language)) {
    response.status(400).json({ error: `language must be one of ${LANGUAGES.join(', ')}` });
    return;
  }
  if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 1 || lines > 200) {
    response.status(400).json({ error: 'lines must be an integer between 1 and 200' });
    return;
  }

  const room = rooms.open(
    { language: language as Language, lines, config: PRIVATE_DEFAULTS },
    Date.now(),
  );
  response.status(201).json({ id: room.id, language: room.language, lines: room.lines });
});

/**
 * A finished solo run. The body names the snippet by its identity and carries
 * the keystream; the server regenerates the text and recomputes the result, so
 * a client that reports its own WPM is simply not asked for one.
 */
app.post('/runs', (request, response) => {
  if (!submissions.allow(request.ip ?? 'unknown', Date.now())) {
    response.status(429).json({ error: 'too many runs submitted; wait a minute' });
    return;
  }

  let result;
  let player;
  try {
    const submission = parseSolo(request.body);
    player = submission.player;
    result = verifySolo(submission);
  } catch (error) {
    // A submission that cannot be parsed or does not replay is not a run.
    // The message names the field, because the only person who sees it is
    // someone whose run just vanished.
    response.status(400).json({ error: error instanceof Error ? error.message : 'invalid run' });
    return;
  }

  const database = db();
  if (database !== undefined) {
    // Not awaited: the run is already computed and the player should not wait
    // on a write to see it. The failure is logged rather than swallowed.
    void recordRun(database, runRecordOf(result, player, Date.now())).catch((error: unknown) => {
      console.error('failed to store solo run', error);
    });
  }
  response.status(201).json(result);
});

attach(io, { rooms, scheduler, matchmaker });

// Abandoned links and finished races would otherwise accumulate for the life
// of the process.
const reaper = setInterval(() => {
  const at = Date.now();
  rooms.reap(at, ROOM_GRACE_MS);
  submissions.sweep(at);
}, REAP_INTERVAL_MS);
reaper.unref();

http.listen(PORT, () => {
  console.log(`race server listening on ${PORT}, accepting ${ORIGIN}`);
});
