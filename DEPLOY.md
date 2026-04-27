# Deploying to Render (Free Tier)

Render's free Postgres doesn't include pgvector, so the free stack is:

| Service | Provider | Why |
|---|---|---|
| App | Render (free web service) | Hosts the Docker container |
| Database | Supabase (free) | Postgres 15 + pgvector built in |
| Redis | Upstash (free) | 10MB free Redis, no credit card |

---

## Step 1 — Supabase (Database)

1. Go to [supabase.com](https://supabase.com) → New project
2. Once provisioned, go to **Project Settings → Database**
3. Copy the **Connection string** (URI format) — looks like:
   `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres`
4. pgvector is already enabled — nothing extra needed

---

## Step 2 — Upstash (Redis)

1. Go to [upstash.com](https://upstash.com) → Create Database → Redis
2. Region: pick closest to your Render region
3. Copy the **Redis URL** — looks like:
   `redis://default:[password]@[host].upstash.io:6379`

---

## Step 3 — Generate secrets

Run these locally to generate the required secrets:

```bash
# JWT_SECRET (any random string, min 32 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# MASTER_ENCRYPTION_KEY (must be exactly 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Step 4 — Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New → **Blueprint**
3. Connect your GitHub repo — Render will find `render.yaml` automatically
4. Set the following env vars in the Render dashboard:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Your Supabase connection string |
| `REDIS_URL` | Your Upstash Redis URL |
| `MASTER_ENCRYPTION_KEY` | 64-char hex string (generated above) |
| `OAUTH_CALLBACK_BASE_URL` | `https://judica.onrender.com` (your Render URL) |
| `FRONTEND_URL` | `https://judica.onrender.com` |
| `OPENAI_API_KEY` | At least one AI key is required |

5. Click **Apply** — Render builds the Docker image and deploys

---

## Step 5 — Run database migrations

After the first deploy completes, open **Render → Shell** for your service and run:

```bash
npx drizzle-kit push
```

This creates all tables and enables pgvector indexes.

---

## Step 6 — Set up Google OAuth (for sign-in)

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → **APIs & Services → Credentials → Create OAuth client**
3. Application type: **Web application**
4. Authorised redirect URIs: `https://judica.onrender.com/api/auth/google/callback`
5. Copy **Client ID** and **Client Secret** → set as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in Render

---

## Step 7 — Set up GitHub OAuth (for sign-in)

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → New OAuth App
2. Homepage URL: `https://judica.onrender.com`
3. Callback URL: `https://judica.onrender.com/api/auth/github/callback`
4. Copy **Client ID** and generate a **Client Secret** → set as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` in Render

---

## Notes on the free tier

- The web service **sleeps after 15 minutes of inactivity** and takes ~30s to wake up on the first request
- Supabase free tier has a 500MB database limit and also pauses after 1 week of inactivity (resume from dashboard)
- Upstash free tier: 10MB storage, 10k commands/day — enough for development and light use
- To avoid sleep, upgrade Render web service to **Starter ($7/mo)** — keeps it always-on
