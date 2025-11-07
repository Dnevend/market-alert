# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a blockchain market alert service built with Cloudflare Workers and Hono. It monitors cryptocurrency price fluctuations from Binance, stores data in Cloudflare D1, and sends webhook notifications when price changes exceed thresholds. The service includes JWT-based authentication with Ethereum wallet integration and a comprehensive admin API.

## Common Development Commands

### Development
```bash
# Start local development server with hot reload
pnpm dev

# Install dependencies
pnpm install

# Generate Cloudflare types after env/binding changes
pnpm cf-typegen
```

### Database Operations
```bash
# Apply complete schema to local D1
wrangler d1 execute market-alert --local --file=./schema.sql

# Apply migrations to local D1
wrangler d1 migrations apply market-alert

# Apply migrations to production D1
wrangler d1 migrations apply market-alert --remote
```

### Testing
```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

### Deployment
```bash
# Deploy to production
pnpm deploy

# Dry run deployment validation
wrangler deploy --dry-run
```

### Secrets Management
Production secrets must be set via Wrangler:
```bash
wrangler secret put WEBHOOK_HMAC_SECRET
wrangler secret put ADMIN_BEARER_TOKEN
wrangler secret put JWT_SECRET
```

## Architecture Overview

### Core Components

**Entry Point** (`src/index.ts`):
- Hono app with CORS configuration
- Middleware stack: env loading, request logging, authentication bypass for dev/test
- Route registration and error handling
- Scheduled event handler for cron jobs

**Authentication System**:
- Ethereum wallet-based JWT authentication (`src/middleware/auth.ts`, `src/routes/auth.ts`)
- Development mode bypass with `x-debug-mode: dev` or `x-test-mode: binance-test` headers
- User management with roles (admin/user/guest) in `src/db/users.ts`

**Database Layer** (`src/db/`):
- D1 repository pattern in `repo.ts`
- User management in `users.ts`
- Schema defined in `schema.sql` with tables: symbols, settings, alerts, users, user_roles

**Monitoring Core** (`src/lib/monitor.ts`):
- Orchestrates the monitoring workflow
- Fetches price data, calculates changes, triggers alerts
- Manages cooldown periods and idempotency

**Exchange Integration**:
- Binance API client (`src/lib/binance.ts`)
- Alternative adapters: CCXT, CoinGecko
- Price calculation utilities (`src/lib/compute.ts`, `src/lib/compute-enhanced.ts`)

**Alert System** (`src/lib/webhook.ts`):
- HMAC-signed webhook delivery
- Configurable retry logic with exponential backoff
- Alert status tracking (SENT/FAILED/SKIPPED)

### Route Structure

**Public Routes**:
- `/` - Service info
- `/healthz` - Health check
- `/docs/*` - OpenAPI documentation
- `/auth/*` - Ethereum wallet authentication

**Protected Routes** (require Bearer token or Ethereum auth):
- `/trigger` - Manual monitoring trigger
- `/admin/*` - Symbol and settings management
- `/admin/symbols` - CRUD operations for monitored symbols
- `/admin/settings` - Global configuration
- `/admin/alerts` - Alert history
- `/users/*` - User profile management

### Configuration

**Environment Variables** (`src/config/env.ts`):
- `WEBHOOK_HMAC_SECRET` - Webhook signing secret
- `ADMIN_BEARER_TOKEN` - Admin API access token
- `JWT_SECRET` - JWT signing for Ethereum auth
- `BINANCE_BASE_URL` - Binance API endpoint
- `HTTP_TIMEOUT_MS`, `MAX_RETRIES`, `RETRY_BACKOFF_BASE_MS` - HTTP client settings

**Database Settings** (`settings` table):
- `default_threshold_percent` - Default price change threshold (2%)
- `window_minutes` - Price monitoring window (5 minutes)
- `default_cooldown_minutes` - Alert cooldown period (10 minutes)

### Cron Scheduling

- Configured in `wrangler.jsonc` with `*/1 * * * *` (every minute)
- Development: trigger manually via `POST /trigger`
- Production: automatic execution via Cloudflare Workers scheduled events

### Testing

Vitest unit tests cover:
- Price change calculations (`src/__tests__/compute.test.ts`)
- Webhook signing (`src/__tests__/webhook.test.ts`)
- Test files should follow the pattern `src/__tests__/*.test.ts`

## Development Notes

- Local development runs on `http://127.0.0.1:8787`
- Authentication is bypassed locally or with debug headers
- Database changes require both schema.sql updates and potential migration scripts
- The service supports both Bearer token and Ethereum wallet authentication
- All external HTTP requests include retry logic with configurable backoff