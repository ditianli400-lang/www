# WQJ Video Platform

A small self-hosted video website for a few dozen videos. Includes public video catalog, browser-language detection + manual language selector, admin login, upload form, cover images, HTML5 playback and downloads.

## Requirements

- Node.js 20 or newer
- A server with persistent disk storage for `uploads/` and `data/`
- HTTPS for public production use

> GitHub Pages only hosts static files. It cannot run this Express API or securely accept admin uploads. Deploy this full project to a Node.js host (for example, Render, Railway, a VPS, or another Node-capable service); use GitHub to store the code.

## Run locally

```bash
npm install
cp .env.example .env
```

Edit `.env` and set a strong unique `ADMIN_PASSWORD` and a long random `SESSION_SECRET`. Then run:

```bash
npm start
```

Open http://localhost:3000 and the admin area at http://localhost:3000/admin.html.

On Windows PowerShell, copy the example with:

```powershell
Copy-Item .env.example .env
```

Never commit `.env`, `uploads/`, or private credentials to GitHub.

## Storage and backups

- Uploaded video files: `uploads/videos/`
- Cover images: `uploads/covers/`
- Metadata: `data/videos.json`

Back up all three. On deployment, attach a persistent disk/volume and mount it at the app directory or adapt `UPLOAD_DIR`/`DATA_DIR` to your host's persistent paths. If the host has an ephemeral filesystem, uploaded files can disappear on redeploy/restart.

## API

Public:
- `GET /api/health`
- `GET /api/videos?category=movies|live|ai|shorts&q=keyword`
- `GET /api/videos/:id`
- `GET /api/videos/:id/download` (download attachment)

Admin session required:
- `POST /api/admin/login` JSON `{ "username": "...", "password": "..." }`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/videos`
- `POST /api/admin/videos` multipart fields: `title`, `description`, `category`, `tags`, `video` (required), `cover` (optional)
- `PATCH /api/admin/videos/:id` (edit title, description, category, published)
- `DELETE /api/admin/videos/:id`

Supported video extensions: MP4, WebM, MOV, M4V. Browser playback compatibility is best with H.264/AAC MP4 or WebM. Supported covers: JPG, PNG, WebP, AVIF.

## Language support

Language auto-detection uses the browser's language preferences, with manual selection persisted in localStorage. The UI includes 20 languages. Some strings are translated in the homepage dictionary; the watch/admin pages currently have partial English text. For a production site, complete every page's translations and have a fluent speaker review them. Video titles/descriptions are whatever you enter and are not automatically translated.

## Deployment outline

1. Push this repository to GitHub.
2. Create a Node.js web service with your chosen hosting provider and connect the GitHub repository.
3. Build command: `npm install`; start command: `npm start`.
4. Add environment variables `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `COOKIE_SECURE=true`.
5. Attach persistent storage for `uploads/` and `data/`. Configure `UPLOAD_DIR`/`DATA_DIR` in `server.js` if the host mounts a dedicated path.
6. Set `COOKIE_SECURE=true` only when HTTPS is enabled. Ensure your proxy forwards HTTPS correctly.
7. Open `/admin.html`, log in, upload a test MP4 and cover, then verify homepage, playback seeking, and download.
8. Set up scheduled backups of metadata and uploaded media.

## Production hardening before a public launch

- Use a managed session store (the default Express MemoryStore is for local/small demos only and is not suitable for multi-instance production).
- Add login rate limiting, CSRF protection, monitoring, backups, and disk-space alerts.
- For larger libraries or multiple instances, use object storage (S3-compatible) and a database such as PostgreSQL instead of local JSON files.
- The `live` category here is for uploaded recordings. True live streaming requires an encoder/ingest endpoint and HLS/DASH playback service.
- Only upload videos and images you have rights to distribute. This starter project does not implement DRM or user accounts.
