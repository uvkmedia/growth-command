# Growth Command — CGA Marketing + Sales Dashboard

A live dashboard reading marketing (Meta) and sales (GHL/Sheets) data
through an n8n feed. Built with Vite + React + Recharts.

## Deploy (GitHub -> Vercel)

1. Push this folder to a new GitHub repository.
2. In Vercel: **New Project -> Import** the repo.
3. Vercel auto-detects Vite. Leave defaults:
   - Build command: `npm run build`
   - Output dir: `dist`
4. **Deploy.** You get a permanent URL.

## The data feed

The dashboard fetches from the n8n endpoint set in `src/App.jsx`:

    const FEED = "https://uvk.app.n8n.cloud/webhook/dashboard-data";

For the browser to read it, the n8n **Webhook** node must allow CORS
(Options -> Allowed Origins (CORS) -> `*`), and the **Respond to Webhook**
node should send header `Access-Control-Allow-Origin: *`.

## Local dev

    npm install
    npm run dev
