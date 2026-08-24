// MUST be first: ESM evaluates imports in order, and modules below read
// process.env at import time (middleware/auth.js throws on a missing
// JWT_SECRET). A plain `dotenv.config()` call in the body runs too late.
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import connectDB from './config/db.js';
import { router as authRouter } from './routes/auth.js';
import playlistsRouter from './routes/playlists.js';
import recentlyPlayedRouter from './routes/recentlyPlayed.js';
import followRouter from './routes/follow.js';
import creatorRouter from './routes/creator.js';
import lyricsRouter from './routes/lyrics.js';

await connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// Needed for express-rate-limit to see the real client IP behind a proxy.
app.set('trust proxy', 1);

// Comma-separated list of allowed origins.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (incomingOrigin, callback) => {
    // No Origin header = same-origin or a non-browser client (curl, mobile).
    if (!incomingOrigin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(incomingOrigin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(helmet({
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  // The frontend loads creator audio from this origin.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// 25mb: creator uploads arrive as base64 data URLs (12MB audio ≈ 16MB base64).
app.use(express.json({ limit: '25mb' }));

// Blanket ceiling. Credential endpoints add a much tighter one of their own.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/api/auth', authRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/recently-played', recentlyPlayedRouter);
app.use('/api/follow', followRouter);
app.use('/api/creator', creatorRouter);
app.use('/api/lyrics', lyricsRouter);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, req, res, next) => {
  // A rejected origin is a client error, not a server fault. Don't log a stack
  // for every drive-by probe.
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ message: 'Origin not allowed' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
