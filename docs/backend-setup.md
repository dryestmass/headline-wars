# Development backend

The dev branch targets the `dev-headline-wars` Worker and `headline-wars-dev` D1 database. Use a Cloudflare login with access to that development Worker and database. The vote secret must be stable and unique to the development environment. Replacing it invalidates the browser identity for existing votes.

## Local development

```sh
npm ci
npm run test
npm run build
npx wrangler d1 migrations apply headline-wars-dev --local
npx wrangler dev
```

For local voting, set `VOTER_HASH_SECRET` in the ignored `.dev.vars` file to a local-only value of at least 32 characters. Use the Wrangler URL for full-stack development. The Vite-only server does not run the API.

## Remote development

From the dev checkout, confirm Wrangler is authenticated to the account that owns the development resources. Generate a random secret, for example with `openssl rand -hex 32`, and enter it at the Wrangler secret prompt.

```sh
npx wrangler d1 migrations apply headline-wars-dev --remote
npm run build
npx wrangler deploy
npx wrangler secret put VOTER_HASH_SECRET --name dev-headline-wars
curl --fail https://dev-headline-wars.dryestmass.workers.dev/api/game
```

An empty question list with both scores at zero is expected until an editor publishes an approved question. Check that `votingEnabled` is true after setting the secret.

## Publishing and verification

A trusted editor or scheduled process with D1 write access can publish and verify through parameterized statements. The public Worker exposes game reads and anonymous ballots only. The browser keeps a random voter UUID in local storage and the database stores its HMAC digest. Clearing or changing browser profiles can make a browser appear to be a new voter.

For publication, use an approved prompt, objective YES/NO criteria, a stable editorial ID, and a non-overlapping voting window. Store times in UTC with milliseconds, using `Date.toISOString()`. Future publications become visible when their windows open. The API marks expired questions pending automatically.

```sql
INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(id) DO NOTHING;
```

After the deadline, confirm the outcome against the published criteria and record the HTTPS evidence URL. Leave uncertain outcomes pending. A retry of the guarded update changes zero rows after resolution. Check affected row counts and compare the stored outcome and source on retries.

```sql
UPDATE questions
SET status = 'resolved', outcome = ?2, source_url = ?3,
    resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?1 AND status IN ('open', 'closed')
  AND closes_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
```

Set status to `void` to withdraw an unresolved question. Resolved and void records are final. Each verified winner contributes one point directly to the scoreboard from stored ballots, including results older than the 50 displayed in the archive.
