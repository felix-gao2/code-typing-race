import { createServer } from 'node:http';
import { LANGUAGES, type Language } from '@ctr/generator';
import type { RaceConfig } from '@ctr/race-machine';
import express from 'express';
import { Server } from 'socket.io';
import { attach, viewOf } from './io.ts';
import { Rooms } from './rooms.ts';
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

/** How long an unopened room link survives before it is swept up. */
const ROOM_GRACE_MS = 30 * 60_000;
const REAP_INTERVAL_MS = 60_000;

const rooms = new Rooms();
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: ORIGIN } });
const scheduler = new Scheduler(rooms, (room) => io.to(room.id).emit('race', viewOf(room)));

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

attach(io, { rooms, scheduler });

// Abandoned links and finished races would otherwise accumulate for the life
// of the process.
const reaper = setInterval(() => {
  rooms.reap(Date.now(), ROOM_GRACE_MS);
}, REAP_INTERVAL_MS);
reaper.unref();

http.listen(PORT, () => {
  console.log(`race server listening on ${PORT}, accepting ${ORIGIN}`);
});
