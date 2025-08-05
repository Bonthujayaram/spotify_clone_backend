import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Use the same JWT secret as auth.js
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    console.log('Auth header:', authHeader); // Debug log

    const token = authHeader && authHeader.split(' ')[1];
    console.log('Extracted token:', token); // Debug log

    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Decoded token:', decoded); // Debug log

    const user = await User.findById(decoded.userId);
    console.log('Found user:', user ? user._id : null); // Debug log

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name
    };

    next();
  } catch (error) {
    console.error('Auth error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    }); // Detailed error log
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    console.error('Auth middleware error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}; 