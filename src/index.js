import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { router as audiusRouter } from './routes/audius.js';
import connectDB from './config/db.js';
import { router as authRouter } from './routes/auth.js';
import playlistsRouter from './routes/playlists.js';
import recentlyPlayedRouter from './routes/recentlyPlayed.js';
import followRouter from './routes/follow.js';

// Load environment variables
dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: allowedOrigin }));
app.use(helmet());
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/audius', audiusRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/recently-played', recentlyPlayedRouter);
app.use('/api/follow', followRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 