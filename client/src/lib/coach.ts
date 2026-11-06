// client/src/lib/coach.ts
import mongoose from 'mongoose';
const User = require('./models/User');

export async function resolveCoachId(req: any, explicitCoachId?: any) {
  const user = req?.user || req;
  if (user?.role === 'coach') return user.id || user._id;

  if (explicitCoachId && mongoose.Types.ObjectId.isValid(explicitCoachId)) {
    const explicitCoach = await User.findOne({ _id: explicitCoachId, role: 'coach' }).select('_id');
    if (explicitCoach) return explicitCoach._id;
  }

  // Admin-created records must still belong to a coach, otherwise the coach
  // portal can never see the player or include them in attendance sessions.
  const firstCoach = await User.findOne({ role: 'coach' }).sort({ createdAt: 1 }).select('_id');
  return firstCoach ? firstCoach._id : null;
}
