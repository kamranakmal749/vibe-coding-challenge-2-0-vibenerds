// client/src/lib/sync.ts
import mongoose, { Model, Schema } from 'mongoose';
import connectToDatabase from './db';

export interface ISyncState {
  _id: string;
  version: number;
  lastEvent?: string;
  updatedAt: Date;
}

const syncStateSchema = new Schema<ISyncState>(
  {
    _id: { type: String, default: 'global' },
    version: { type: Number, required: true },
    lastEvent: { type: String, default: '' },
  },
  {
    collection: 'syncstates',
    timestamps: true,
  }
);

export const SyncState: Model<ISyncState> =
  (mongoose.models.SyncState as Model<ISyncState>) ||
  mongoose.model<ISyncState>('SyncState', syncStateSchema);

/**
 * Returns current sync version from MongoDB syncstates collection and clientsCount = 0.
 * If no document exists yet, initializes the "global" doc with version = Date.now().
 */
export async function getVersion(): Promise<{ version: number; clientsCount: number }> {
  await connectToDatabase();
  let doc = await SyncState.findById('global').lean();
  if (!doc) {
    const initVersion = Date.now();
    doc = await SyncState.findOneAndUpdate(
      { _id: 'global' },
      {
        $setOnInsert: { version: initVersion, lastEvent: 'init' },
      },
      { upsert: true, returnDocument: 'after' }
    ).lean();
  }
  return {
    version: doc?.version ?? Date.now(),
    clientsCount: 0,
  };
}

/**
 * Atomically increments the global sync version in MongoDB and records the triggering event.
 * On first use, initializes the document with version = Date.now(). Afterwards, performs $inc: { version: 1 }.
 */
export async function bumpSync(event: string = 'mutation'): Promise<number> {
  await connectToDatabase();
  const existing = await SyncState.findById('global');
  if (!existing) {
    const initVersion = Date.now();
    const initDoc = await SyncState.findOneAndUpdate(
      { _id: 'global' },
      {
        $setOnInsert: { version: initVersion },
        $set: { lastEvent: event, updatedAt: new Date() },
      },
      { upsert: true, returnDocument: 'after' }
    );
    return initDoc.version;
  }

  const updated = await SyncState.findOneAndUpdate(
    { _id: 'global' },
    {
      $inc: { version: 1 },
      $set: { lastEvent: event, updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );
  return updated ? updated.version : Date.now();
}
