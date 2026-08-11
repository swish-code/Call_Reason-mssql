<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/9c53cf2d-7720-41d5-94ca-e09946ee7b98

## Data storage

The app persists all data (users, interactions, brands, categories, audit logs)
in **PostgreSQL**. The database schema is created automatically on startup and
seeded with demo data on first run.

## Run Locally

**Prerequisites:**  Node.js, a PostgreSQL database

1. Install dependencies:
   `npm install`
2. Configure environment variables in `.env.local`:
   - `DATABASE_URL` – PostgreSQL connection string (required)
   - `JWT_SECRET` – secret used to sign auth tokens (recommended)
   - `PGSSL=require` – set when connecting over SSL (e.g. a public proxy URL)
3. Run the app:
   `npm run dev`

## Deploy on Railway

The app reads `process.env.PORT` and connects to the linked Postgres service.
Set the following variables on the app service:

- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
- `NODE_ENV` = `production`
- `JWT_SECRET` = a long random string
