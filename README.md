# Puduvai Voice

A multilingual civic reporting pilot for Puducherry, India, supporting English, Tamil, and Hindi.

**Live pilot:** https://puduvaivoice.online

## Features

Resident issue reports, approximate public locations, private exact coordinates, power-cut start/end tracking, administrator moderation, department routing, private photo review, in-site updates, and AI-assisted administrator review.

## Stack

TypeScript, React, Next.js / Vinext, Tailwind CSS, Leaflet, and Supabase Auth, Postgres, Storage, and Edge Functions.

## Local development

Use Node.js 22.13 or newer. Run `npm run install:ci`, then `npm run dev`. Check types with `npx tsc --noEmit` and build with `npm run build`.

This is a cleaned source snapshot. Hosted databases, credentials, production bindings, backups, account records, and deployment history are excluded. Backend SQL and Edge Functions are included as reference source; do not apply every historical migration blindly. Configure your own backend and authentication redirects before using real accounts. The public client configuration in `lib/auth/config.ts` and scheduler verifier in `backend/worker-public-config.ts` are deployment-specific and must be replaced for your deployment. `admin@example.com` is a placeholder for the deployment administrator. `.openai/hosting.json` contains empty local binding defaults.

## Status

Deployed pilot, with readiness checks still open. No government departments are participating. This snapshot is not a production-readiness claim. Bundled third-party component notices remain in `vendor/` and `build/`.
