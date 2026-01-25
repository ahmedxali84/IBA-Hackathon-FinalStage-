# Neighbourly – FinalStage 3 (Supabase + Realtime Chat + H3 Radius Discovery)

This is a static frontend (HTML/CSS/JS) that connects to Supabase for:
- Users (Seeker / Provider)
- Services
- Bookings
- **Realtime Chat (Provider ↔ Seeker)**
- **Location-based discovery using Uber H3 (services within 5/10/25 km etc.)**

## 1) Run locally
Use VS Code Live Server (recommended):
1. Open `Stage2/` folder
2. Right click `index.html` → **Open with Live Server**

## 2) Configure Supabase
Open `main.js` and set:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## 3) Required Supabase tables
> If your DB already has `users`, `services`, `bookings`, keep them.

### A) Chat table (NO conversations table needed)
Run this in Supabase SQL editor:

```sql
create table if not exists public.chat_messages (
  id bigserial primary key,
  conversation_id text not null,            -- format: seekerId:providerId
  seeker_id uuid not null references public.users(id) on delete cascade,
  provider_id uuid not null references public.users(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  sender_name text,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_conversation_idx on public.chat_messages (conversation_id);
create index if not exists chat_messages_seeker_idx on public.chat_messages (seeker_id);
create index if not exists chat_messages_provider_idx on public.chat_messages (provider_id);
create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at);

-- Enable Realtime on chat_messages (Supabase UI):
-- Database → Replication → enable table "chat_messages"
```


### B) H3 location columns (services)
Your `services` table should have:
- `latitude` (double precision)
- `longitude` (double precision)
- `h3_index` (text)
- `h3_res` (int)

SQL:

```sql
alter table public.services add column if not exists latitude double precision;
alter table public.services add column if not exists longitude double precision;
alter table public.services add column if not exists h3_index text;
alter table public.services add column if not exists h3_res int;

create index if not exists idx_services_h3 on public.services(h3_index);
```

## 4) How chat works
- Seeker clicks **Chat** on a service card → conversation is created (if missing) → opens realtime chat.
- Provider clicks **Chat** on a booking card → opens realtime chat with that seeker.

## 5) How H3 radius discovery works
- Seeker clicks **Use My Location** (stores lat/lng locally)
- Select radius: 5/10/25/50 km
- App computes candidate H3 cells (Uber H3) and queries services using `h3_index IN (...)`.
- Then it applies a final exact radius check (Haversine) for precision.

---
If you face RLS issues, temporarily disable RLS while testing, then add policies.
