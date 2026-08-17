# Stream

A small movie and series discovery app backed by Cinemeta, Torrentio, and a
server-side Real-Debrid integration. The Real-Debrid token is never sent to the
browser.

## Requirements

- Node.js 20 or newer
- A Real-Debrid account and private API token
- A SubDL API key for Arabic and English captions

## Setup

1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Put your token in `REAL_DEBRID_TOKEN` inside `.env`.
4. Put your SubDL API key in `SUBDL_API_KEY`.
5. Run `npm run build`.
6. Run `npm start` and open `http://localhost:4173`.

Port 4173 is intentional: using a dedicated origin prevents unrelated service
workers previously installed on common localhost ports from intercepting this
app's API and media requests.

Do not commit `.env` or expose a private Real-Debrid token in frontend code.
For a public multi-user deployment, replace the private-token configuration
with Real-Debrid's OAuth flow and add persistent per-user sessions.

The SubDL key also remains server-side. Subtitle downloads are subject to the
account's SubDL quota and availability for each title.

## Commands

- `npm start` — start the production server
- `npm run dev` — restart the server when backend files change
- `npm run build` — compile the local Tailwind stylesheet
- `npm test` — run unit tests

The server intentionally leaves torrents in the Real-Debrid account so an
uncached torrent can continue downloading. Remove unwanted items from the
account separately.
