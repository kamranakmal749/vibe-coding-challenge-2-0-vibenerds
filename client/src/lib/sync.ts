// client/src/lib/sync.ts
import mongoose, { Document, Model, Schema } from 'mongoose';
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
    version: { type: Number, default: 0, required: true },
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
 */
export async function getVersion(): Promise<{ version: number; clientsCount: number }> {
  await connectToDatabase();
  const doc = await SyncState.findById('global').lean();
  return {
    version: doc?.version ?? 0,
    clientsCount: 0,
  };
}

/**
 * Atomically increments the global sync version in MongoDB and records the triggering event.
 */
export async function bumpSync(event: string = 'mutation'): Promise<number> {
  await connectToDatabase();
  const updated = await SyncState.findOneAndUpdate(
    { _id: 'global' },
    {
      $inc: { version: 1 },
      $set: { lastEvent: event, updatedAt: new Date() },
    },
    { upsert: true, returnDocument: 'after' }
  );
  return updated ? updated.version : 1;
}
