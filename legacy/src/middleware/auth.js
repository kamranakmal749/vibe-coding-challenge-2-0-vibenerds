// src/middleware/auth.js
// Verify JWT and attach req.user; also export role-guard helpers.
const jwt = require('jsonwebtoken');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    req.user = payload; // { id, role, name, username, playerId }
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Revoke access immediately if player account or profile was permanently deleted, or if password change is pending
  if (req.user && req.user.role === 'player') {
    try {
      const User = require('../models/User');
      const userDoc = await User.findById(req.user.id);
      if (!userDoc) {
        return res.status(401).json({ error: 'Account has been removed' });
      }

      // Check authoritative database value for mandatory password change
      if (userDoc.mustChangePassword) {
        const urlPath = req.originalUrl || req.url;
        const isExempt = urlPath.startsWith('/api/auth/change-password') || urlPath.startsWith('/api/auth/me');
        if (!isExempt) {
          return res.status(403).json({
            error: 'Password change required before accessing portal features',
            mustChangePassword: true
          });
        }
      }

      if (req.user.playerId) {
        const Player = require('../models/Player');
        const playerDoc = await Player.findById(req.user.playerId);
        if (!playerDoc) {
          return res.status(401).json({ error: 'Player profile has been removed' });
        }
      }
    } catch (e) {
      // If error is account missing, reject
      if (e.message && e.message.includes('Cast to ObjectId')) {
        return res.status(401).json({ error: 'Invalid account' });
      }
    }
  }

  next();
}

// Allow only specific roles
function allow(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { authenticate, allow };

