// client/src/lib/db.ts
import mongoose from 'mongoose';

// Declare global cache for serverless environments (e.g. Next.js App Router / Vercel)
declare global {
  // eslint-disable-next-line no-var
  var mongooseConnection: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  } | undefined;
}

let cached = global.mongooseConnection;

if (!cached) {
  cached = global.mongooseConnection = { conn: null, promise: null };
}

export async function connectToDatabase(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI || '';

  if (!uri) {
    throw new Error('Database connection failed: MONGODB_URI environment variable is not defined');
  }

  // Safety invariant: Only allow academy_dev or academy_parity unless explicitly overridden in production
  const isAllowedDb = uri.includes('/academy_dev') || uri.includes('/academy_parity');
  const isProdOverride = process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_DB === 'true';

  if (!isAllowedDb && !isProdOverride) {
    const maskedUri = uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
    throw new Error(
      `Database connection refused: MONGODB_URI must target academy_dev or academy_parity (got: ${maskedUri})`
    );
  }

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
