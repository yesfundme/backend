# FUNDme

A mobile-first crowdfunding/support platform for Kenya. Choose a category → register (no OTP) → create a campaign → share the link → receive M-Pesa support via Paystack → withdraw funds.

## Structure

```
fundme/
  backend/     Express API (Supabase + Paystack)
  frontend/    Static mobile-first site (deployable to GitHub Pages)
```

## Backend setup

1. `cd backend && npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — from your Supabase project settings
   - `PAYSTACK_SECRET_KEY` / `PAYSTACK_PUBLIC_KEY` — from your Paystack dashboard
   - `JWT_SECRET` — any long random string
3. In the Supabase SQL editor, run `backend/db/schema.sql` to create all tables and seed the default support items (Coffee, Popcorn, Chocolate, Flower, Smile, Bazuu/FUNDme Support).
4. `npm start` (or `npm run dev` with nodemon). Deploys cleanly to Render, matching your existing FXS Pay / KEA setup.
5. In your Paystack dashboard, add a webhook pointing to `https://<your-backend>/api/payments/webhook`. This is the **only** place a payment is ever marked successful — the frontend never marks itself as paid.
6. To make an admin: register a normal account, then in Supabase manually set that user's `role` column to `admin`.

## Frontend setup

1. Open `frontend/js/api.js` and set `API_BASE` (or set `window.FUNDME_API_BASE` before the script loads) to your deployed backend URL, e.g. `https://fundme-api.onrender.com/api`.
2. Push the `frontend/` folder to a GitHub Pages repo, same pattern as your other campaign/awards sites.
3. Campaign pages are reached as `campaign.html?slug=<public_slug>` — point your custom domain's rewrite rules at that if you want clean `/campaign/<slug>` URLs later.

## What's implemented end-to-end

- Registration/login with bcrypt + JWT, no OTP
- Campaign creation with a unique public slug
- Public campaign page: progress bar, supporter count, preset support items with quantities, custom amount, checkout with name/anonymous/message options
- Paystack M-Pesa charge initiation + **webhook-verified** payment confirmation (with signature check and duplicate-webhook protection)
- Configurable platform fee (percentage + flat), applied before the campaign balance is credited
- Owner dashboard: totals, available balance, withdrawal request (bank or M-Pesa), balance never allowed to go negative
- Admin dashboard: users (suspend/activate), campaigns (search, suspend/activate, delete), withdrawals (approve → mark paid/reject, matching the "never auto-paid" rule), platform fee settings, financial overview
- Campaign reporting (stored in `campaign_reports`, visible via `/api/admin/reports`)
- Mobile-first responsive layout; tables collapse to cards on small screens

## Still to wire up before this is fully production-ready

- **Forgot password** — the frontend page exists as a placeholder; add a real reset-token email flow (e.g. via Supabase Auth or a transactional email provider).
- **Transaction line-items on the owner dashboard** — the backend already returns full payment records per campaign; the dashboard currently just shows the supporter count, so add a `GET /api/campaigns/:id/transactions` (owner-only) call and render it as a table like the example in the spec.
- **Image uploads** — campaign images are currently a URL field; wire up Supabase Storage if you want direct upload instead of pasting a link.
- **Rate limiting** is in place on auth/payment routes at the app level; consider adding Supabase row-level security policies too, since the backend currently relies on the service-role key and its own authorization checks.
