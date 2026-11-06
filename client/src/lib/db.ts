// client/src/lib/db.ts
import mongoose from 'mongoose';

// Declare global cache on globalThis for serverless environments (e.g. Next.js App Router / Vercel)
declare global {
  // eslint-disable-next-line no-var
  var mongooseConnection: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  } | undefined;
}

let cached = (globalThis as any).mongooseConnection;

if (!cached) {
  cached = (globalThis as any).mongooseConnection = { conn: null, promise: null };
}

/**
 * Validates the MongoDB URI against database name safety invariants.
 * Allows only academy_dev or academy_parity by default.
 * When ALLOW_PRODUCTION_DB=true is set, any database name is permitted.
 * Never logs the URI or hardcodes a specific production DB name.
 */
export function validateDatabaseUri(
  uri: string,
  allowProductionDb: boolean = process.env.ALLOW_PRODUCTION_DB === 'true'
): void {
  if (!uri) {
    throw new Error('Database connection failed: MONGODB_URI environment variable is not defined');
  }

  const isAllowedDb = uri.includes('/academy_dev') || uri.includes('/academy_parity');

  if (!isAllowedDb && !allowProductionDb) {
    throw new Error(
      'Database connection refused: MONGODB_URI must target academy_dev or academy_parity unless ALLOW_PRODUCTION_DB=true is set'
    );
  }
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI || '';

  validateDatabaseUri(uri);

  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts: mongoose.ConnectOptions = {
      bufferCommands: false,
    };

    cached.promise = mongoose.connect(uri, opts).then((m) => {
      return m;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectToDatabase;
