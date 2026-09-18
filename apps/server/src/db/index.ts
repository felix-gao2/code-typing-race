import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/**
 * The database connection, or nothing.
 *
 * Nothing is a supported state: without `DATABASE_URL` the server still opens
 * rooms and runs races, results simply are not stored and the boards read
 * empty. That keeps the two-terminal dev loop working with no setup, and keeps
 * a database outage from taking racing down with it — a race is in memory and
 * does not need Postgres to happen.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let connection: Db | undefined;
let announced = false;

export function db(): Db | undefined {
  if (connection !== undefined) {
    return connection;
  }
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    if (!announced) {
      announced = true;
      console.log('DATABASE_URL is not set: races still run, results are not stored');
    }
    return undefined;
  }
  // postgres.js over TCP rather than Neon's serverless driver: this is a
  // persistent Node process on Fly, not an edge function, so there is nothing
  // for an HTTP driver to buy and no reason to couple the code to one host.
  connection = drizzle(postgres(url), { schema });
  return connection;
}
