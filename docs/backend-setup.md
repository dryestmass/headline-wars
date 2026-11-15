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

## Draft questions from a news source

Run `npm run --silent questions:draft` on the dev checkout to generate a JSON review batch from recent Federal Register proposed rules. The command reads the public source and writes drafts to stdout. No credentials are required.

Each draft ties the original notice to one agency docket and includes a filtered search for rule publications in that docket after the vote closes. The suggested horizon is 90 calendar days. The source currently covers federal rulemaking. Use the source article to check that a draft is suitable for players and confirm the official publication dates and criteria.

Drafts in a batch propose the same daily voting window. Pick at most one for that window, adjust the prompt or timing if needed, and use the existing trusted publication write above. If timing changes, update the date range in both the criteria and evidence search. Leave the question pending if the source is incomplete. The draft command does not write to D1 or resolve questions.

## Scheduled editorial review

The dev Worker refreshes Federal Register drafts at 13:00 UTC daily and checks for due evidence at 30 minutes past each hour. The first job initializes the `question_drafts` table in the dev D1 database. Subsequent discovery runs preserve existing drafts by document ID. Reviewers can use the D1 console to inspect candidates and see which IDs have been published.

```sql
SELECT d.id, d.discovered_at, d.draft_json, q.status AS published_status,
       d.evidence_checked_at, d.evidence_json
FROM question_drafts d LEFT JOIN questions q ON q.id = d.id
ORDER BY d.discovered_at DESC, d.id;
```

To approve an unexpired draft with unchanged criteria, supply its ID as the parameter. This copies one reviewed draft into the live publication schedule. Check the voting window first because the database rejects overlapping open windows.

```sql
INSERT INTO questions (id, prompt, criteria, opens_at, closes_at)
SELECT id, json_extract(draft_json, '$.prompt'), json_extract(draft_json, '$.criteria'),
       json_extract(draft_json, '$.opensAt'), json_extract(draft_json, '$.closesAt')
FROM question_drafts
WHERE id = ?1 AND json_extract(draft_json, '$.opensAt') >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
ON CONFLICT(id) DO NOTHING;
```

For edits, use the trusted publication statement and retain the draft ID. Update the corresponding evidence search and deadline if the criteria change. Evidence checks cover published questions with a matching draft once voting and the outcome window have closed. Results are review candidates only. A zero-result search does not verify a NO outcome. Keep using the trusted verification statement to record a decision and its source. Questions published before this queue was introduced can still be reviewed manually.

## Autonomous Senate questions

At 30 minutes past each hour, the dev Worker checks the Senate Periodical Press Gallery floor schedule for a forthcoming confirmation roll call. It publishes at most one autonomous question per UTC date and waits whenever another question is open. Voting closes after at most 24 hours and at least 15 minutes before the scheduled vote. Only upcoming votes with a usable published time are eligible.

The same scheduled job checks due pending questions against the official Senate roll call index and individual roll call record. It matches the nominee and confirmation vote type, then uses the recorded confirmed or rejected result. An absent, delayed, ambiguous or pre-close result does not award a point. The official roll-call URL is stored with each resolved outcome. The first scheduled run initializes the autonomous question registry in dev D1.

### House floor votes

The congressional source also checks the House's weekly Bills This Week XML from Sunday through Wednesday, Eastern time. Senate confirmations are offered first, then House bills scheduled under a rule, then House suspension bills. The two chambers share the same voting slot and daily publication limit.

House questions use the first matching final-passage roll call between ballot close and Friday night Eastern. The resolver checks the official roll call XML for the bill, Congress, vote type, timestamp and result. Bills that have already received a recorded final-passage vote are skipped during discovery. Procedural votes are excluded, and an absent or inconclusive record stays pending.
