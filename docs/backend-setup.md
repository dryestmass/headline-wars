# Backend setup

The frontend remains static until a D1 database is provisioned. Do not enable the Worker entrypoint without the database binding and secret.

1. Create separate D1 databases for development and production.
2. Apply migrations to each database using Wrangler.
3. Configure the Worker binding `DB` with the corresponding database ID.
4. Set `VOTER_HASH_SECRET` independently for each environment as a secret (at least 32 characters). Never commit it.
5. Enable the Worker entrypoint `src/server/api.ts` in the environment-specific Wrangler configuration.
6. Deploy and verify `GET /api/game` before enabling voting in the frontend.

The public API accepts a browser-generated UUID and stores only its HMAC digest. This limits accidental duplicate votes from the same browser, but does not prevent determined users from creating new identifiers. Add Turnstile, rate limits, and operational monitoring before public launch.

Question publication and resolution are intentionally not exposed as public endpoints. Editorial automation and verifiable result handling require a separate implementation.

The scoreboard query currently inspects the most recent 50 questions and is not suitable as an all-time score. Replace it with a persistent result ledger before production launch.
