# Melody Masterpiece Backend

This is the backend service for Melody Masterpiece, built with Node.js and Express, integrating with the Audius REST API.

## Features

- Proxy server for Audius API
- Rate limiting and security middleware
- Endpoints for:
  - Search (tracks, users, playlists)
  - Track streaming
  - User profiles and tracks
  - Trending tracks
  - Playlists

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root directory:
   ```
   PORT=5000
   NODE_ENV=development
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Search
- `GET /api/audius/search?query=<search_term>&type=tracks&limit=10`
  - type can be: tracks, users, playlists
  - limit is optional (default: 10)

### Tracks
- `GET /api/audius/tracks/:trackId` - Get track details
- `GET /api/audiu/tracks/:trackId/stream` - Get track streaming URL

### Users
- `GET /api/audius/users/:userId` - Get user profile
- `GET /api/audius/users/:userId/tracks` - Get user's tracks

### Trending
- `GET /api/audius/trending?genre=<genre>&limit=10`
  - genre is optional
  - limit is optional (default: 10)

### Playlists
- `GET /api/audius/playlists/:playlistId` - Get playlist details

## Development

The server uses nodemon for development, which automatically restarts when files change.

## Production

For production deployment:
1. Set NODE_ENV=production in .env
2. Run `npm start`

## Error Handling

The API returns errors in the following format:
```json
{
  "error": "Error message"
}
``` 