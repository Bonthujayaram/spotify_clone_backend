# EchoVibe — backend

Express 4 + Mongoose 7 API for the EchoVibe music app. Runs on port **5000**.

Frontend lives in a separate repo:
[spotifyclone_frontend](https://github.com/Bonthujayaram/spotifyclone_frontend).

This service stores users, liked songs, playlists, recently-played, follows and
creator uploads. It does **not** store the music catalog — the frontend fetches
search results and audio straight from the public JioSaavn API. The one
catalog-ish thing here is `/api/lyrics`, which proxies lrclib with a fallback to
lyrics.ovh.

---

## Setup

Node 20+ and a MongoDB.

```bash
npm install
cp .env.example .env
```

Generate a JWT secret and paste it into `JWT_SECRET=`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then point `MONGODB_URI` at a database. Easiest is the bundled one:

```bash
docker compose up -d mongo      # mongodb://localhost:27017/echovibe
```

## Run

```bash
npm run dev      # nodemon, port 5000
npm start        # production
npm test         # node --test
```

Or run the API and its database together:

```bash
docker compose up --build
```

Health check: `curl http://localhost:5000/health` → `{"status":"ok"}`

On Windows, `restart-backend.ps1` (in the parent folder, if you have it) frees
port 5000 and restarts the server.

---

## Configuration

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Server exits at boot if missing |
| `JWT_SECRET` | yes | Min 32 chars. Server **throws at boot** if missing or short — there is deliberately no default |
| `JWT_EXPIRES_IN` | no | Default `7d` |
| `CORS_ORIGIN` | no | Comma-separated origins. Default `http://localhost:5173`. Must include your deployed frontend URL |
| `PORT` | no | Default `5000` |
| `GOOGLE_CLIENT_ID` | no | If set, Google ID tokens must match this audience |

> **Never commit `.env`.** It is gitignored. If a secret ever reaches a commit,
> rotate it — scrubbing history is not enough once it has been pushed.

---

## API

All routes are mounted under `/api` in [src/index.js](src/index.js).

Public (no token):

| Route | Purpose |
|---|---|
| `POST /api/auth/signup`, `/login`, `/google` | Get a token. Rate limited to 20 per 15 min |
| `GET /api/lyrics?title=&artist=` | Lyrics lookup |
| `GET /api/creator/public-tracks` | Browse public creator uploads |
| `GET /api/creator/tracks/:id/stream` | Stream a **public** creator track (supports HTTP range) |
| `GET /health` | Liveness |

Everything else needs `Authorization: Bearer <token>`: the rest of
`/api/auth`, plus `/api/playlists`, `/api/recently-played`, `/api/follow`, and
the authoring half of `/api/creator`.

A blanket 600-requests-per-15-min limit applies across `/api`.

---

## Known limits

- **Creator audio is stored in MongoDB** as a `Buffer` on `CreatorTrackAsset`,
  capped at 12 MB per track to stay under the 16 MB BSON document limit. Uploads
  arrive as base64 data URLs through a 25 MB JSON body, and the whole file is
  held in memory per range request. Move to object storage (S3/R2) before this
  carries real traffic.
- **Private creator tracks are not streamable.** `<audio src>` cannot send an
  `Authorization` header, so the stream route gates on `isPublic` only. Signed
  URLs are the upgrade path.
- **The `User` document is doing the job of several collections.** Liked songs,
  playlists, creator tracks and recently-played are all embedded arrays. Liked
  songs are unbounded and get sorted in application code on every read.
