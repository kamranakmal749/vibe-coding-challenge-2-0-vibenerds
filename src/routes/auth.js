// src/routes/auth.js  –  POST /api/auth/login
const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const mongoose = require('mongoose');
const User   = require('../models/User');
const { authenticate, allow } = require('../middleware/auth');

router.post('/login', async (req, res) => {
  try {
    const { identifier, username, email, password } = req.body;
    const rawId = (identifier || email || username || '').trim().toLowerCase();
    if (!rawId || !password)
      return res.status(400).json({ error: 'Username or email and password required' });

    const user = await User.findOne({
      $or: [{ email: rawId }, { username: rawId }]
    });
    if (!user)
      return res.status(401).json({ error: 'Invalid credentials' });

    const match = await user.comparePassword(password);
    if (!match)
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { 
        id: user._id, 
        role: user.role, 
        name: user.name, 
        username: user.username, 
        email: user.email, 
        playerId: user.playerId,
        mustChangePassword: !!user.mustChangePassword 
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { 
        id: user._id, 
        name: user.name, 
        role: user.role, 
        username: user.username, 
        email: user.email, 
        playerId: user.playerId,
        mustChangePassword: !!user.mustChangePassword 
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/player-account – create user account for an existing player (Admin or Coach)
router.post('/player-account', authenticate, allow('admin', 'coach'), async (req, res) => {
  try {
    const { playerId, password, email } = req.body;
    if (!playerId) {
      return res.status(400).json({ error: 'playerId is required' });
    }

    const Player = require('../models/Player');
    const isObjectId = mongoose.Types.ObjectId.isValid(playerId);
    const player = await Player.findOne({
      $or: [
        ...(isObjectId ? [{ _id: playerId }] : []),
        { playerId: String(playerId).toLowerCase() },
        { username: String(playerId).toLowerCase() }
      ]
    });

    if (!player) {
      return res.status(404).json({ error: 'No matching Player found. Account creation rejected.' });
    }

    // Set User's username to this exact Player username at creation, never inferred later
    const playerUsername = player.playerId || player.username;
    const existingUser = await User.findOne({
      $or: [
        { playerId: player._id },
        { username: playerUsername }
      ]
    });
    if (existingUser) {
      return res.status(409).json({ error: 'User account already exists for this player' });
    }

    const user = await User.create({
      name: player.name,
      username: playerUsername,
      email: (email || `${playerUsername}@player.com`).trim().toLowerCase(),
      password: password || 'player123',
      role: 'player',
      playerId: player._id
    });

    res.status(201).json({
      message: 'Player account created',
      user: { id: user._id, name: user.name, username: user.username, email: user.email, playerId: user.playerId }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/auth/change-password  –  mandatory or voluntary password change
router.patch('/change-password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // If currentPassword is provided, verify it
    if (currentPassword) {
      const match = await user.comparePassword(currentPassword);
      if (!match) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
    }

    // Verify new password is not identical to current
    const isSame = await user.comparePassword(newPassword.trim());
    if (isSame) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    // Assign plain password; User.js pre-save hook will hash it with bcrypt!
    user.password = newPassword.trim();
    user.mustChangePassword = false;
    await user.save();

    const token = jwt.sign(
      {
        id: user._id,
        role: user.role,
        name: user.name,
        username: user.username,
        email: user.email,
        playerId: user.playerId,
        mustChangePassword: false
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Password successfully updated',
      token,
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        username: user.username,
        email: user.email,
        playerId: user.playerId,
        mustChangePassword: false
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me  –  return current user info from token
router.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  if (!user) return res.status(404).json({ error: 'User not found' });
  const userObj = user.toObject ? user.toObject() : user;
  if (userObj.role === 'player' && userObj.playerId) {
    const Player = require('../models/Player');
    const playerDoc = await Player.findById(userObj.playerId).lean();
    if (playerDoc && playerDoc.name) {
      userObj.name = playerDoc.name;
    }
  }
  res.json(userObj);
});

// GET /api/auth/coaches – admin coach picker for player registration
router.get('/coaches', authenticate, allow('admin'), async (_req, res) => {
  try {
    const coaches = await User.find({ role: 'coach' })
      .select('name username')
      .sort({ name: 1 });
    res.json(coaches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

