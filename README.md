# WebAuthn TODO

A zero-knowledge encrypted TODO app secured by passkeys. The server never sees your TODO content.

**Live:** https://todo.0g0.xyz

## How it works

Authentication uses WebAuthn passkeys with the **PRF extension** to derive an AES-GCM-256 encryption key entirely on the client. Every TODO is encrypted before leaving your device — the server stores only ciphertext.

```
Passkey auth + PRF salt
  → PRF output (32 bytes)
  → HKDF (SHA-256, info = "webauthn-todo-encryption-v1")
  → AES-GCM-256 key  ← lives in memory only, lost on page reload
  → encrypt/decrypt TODOs in the browser
```

## Features

- **Passkey auth** — fingerprint, Face ID, or hardware key (PRF extension required)
- **Zero-knowledge** — server cannot decrypt your TODOs
- **Rich TODO management** — priorities, due dates, drag-and-drop reorder, sort by date/priority
- **Kanban view** — three-column board (Todo / Doing / Done)
- **Lexical rich-text memos** — per-TODO notes with bold, italic, lists, quotes
- **Google Calendar** — one-click event creation from due-date TODOs
- **Search & filter** — client-side search over decrypted cache, no server round-trips
- **PWA** — installable, offline-capable

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono (TypeScript) |
| Database | Turso (libSQL / SQLite) |
| Auth | @simplewebauthn/server v13 |
| Crypto | WebAuthn PRF → HKDF → AES-GCM-256 |
| Rich text | Lexical |
| Frontend | TypeScript + Vite |
| Toolchain | vite-plus (Oxlint + Oxfmt) |
| Deploy | Cloudflare Workers Builds (GitHub push) |

## Development

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- A [Turso](https://turso.tech) database

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Generate Cloudflare Workers type definitions
npm run cf-typegen

# 3. Apply database schema
npm run migrate

# 4. Set secrets
npx wrangler secret put JWT_SECRET
npx wrangler secret put TURSO_AUTH_TOKEN
```

### Local development

```bash
# Backend (Workers) on :8787  — uses production Turso DB
npm run dev

# Frontend only (Vite HMR) on :5173  — proxies /api to :8787
npm run dev:frontend
```

### Commands

```bash
npm run type-check      # TypeScript type check
npm run check           # Oxlint + Oxfmt (lint + format)
npm run check -- --fix  # Auto-fix formatting issues
npm run test            # Vitest unit tests
npm run test:e2e        # Playwright E2E tests (against live URL)
npm run build           # migrate + vite build → public/
npm run deploy          # build + wrangler deploy
```

## Deployment

Push to `master` triggers an automatic build via **Cloudflare Workers Builds** (no GitHub Actions needed).

Build command: `npm ci && npm run build`

### First-time setup

1. Create a Turso database and note the URL + auth token
2. Set `RP_ID` and `RP_ORIGIN` in `wrangler.jsonc` to your domain
3. Configure secrets:
   ```bash
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put TURSO_AUTH_TOKEN
   ```
4. Connect your GitHub repo in the Cloudflare dashboard → Workers & Pages → Create → Import a Repository

## Project structure

```
├── frontend/
│   ├── main.ts          # All UI, crypto, and state management
│   ├── releases.ts      # Release notes data
│   ├── style.css
│   └── index.html
├── src/
│   ├── index.ts         # Hono entry point + Bindings type
│   ├── routes/
│   │   ├── auth.ts      # WebAuthn registration & authentication
│   │   └── todos.ts     # TODO CRUD API
│   ├── middleware/
│   │   └── auth.ts      # JWT session verification
│   └── db/
│       ├── adapter.ts   # DbAdapter interface
│       ├── turso.ts     # Turso implementation
│       ├── d1.ts        # D1 implementation (switchable)
│       └── types.ts     # Shared DB types
├── migrations/
│   └── 0001_initial.sql # Schema definition
├── scripts/
│   └── migrate.mjs      # Schema migration runner
├── e2e/                 # Playwright E2E tests
└── src/__tests__/       # Vitest unit tests
```

## Security notes

- PRF output is **never sent to the server**
- Encryption key exists **in memory only** — lost on page reload (re-auth required)
- All SQL queries use **parameterized binding** (no injection risk)
- Session cookies: `httpOnly`, `sameSite: Strict`, `secure` on HTTPS
- Challenges are **single-use** and expire after 5 minutes
- Multiple passkeys: adding a second key triggers full re-encryption of all TODOs

## Passkey (PRF) compatibility

| Authenticator | PRF support |
|---|---|
| 1Password | ✅ |
| iCloud Keychain (iOS 18+) | ✅ |
| Google Password Manager | ✅ |
| YubiKey (FW 5.7+) | ✅ |
| Windows Hello | Partial |
| Older FIDO2 devices | ❌ |

PRF is **required** — non-PRF authenticators cannot register or log in.
