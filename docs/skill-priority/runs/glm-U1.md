## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
Read the skill first? The skill content is given inline. It says skill directory; I could check for scripts but the instructions are complete. Read PLAN.md.
```

- tool `read` PLAN.md

### Model reasoning

```text
Let me check repo context quickly — read src/server.ts to ground questions.
```

- tool `read` .

- tool `read` src/server.ts

### Model reasoning

```text
Server facts: Bun, header-based auth only (no token validation), 401 without header. Get requests also keyed. IP not currently read. Redis cluster for sessions by another service — reuse concern.

Now build the design tree and ask the whole frontier in round 1. Frontier questions whose prerequisites are settled:

1. Scope: limit only POST /orders, or all endpoints? (POST is the expensive call; PLAN mentions POST/GET.)
2. Keying: x-customer-id, IP, or both. Note: server requires x-customer-id, so IP is per-instance-of-NAT scripting; recommend customerId primarily. But header is client-asserted — no auth. Fact: header is unauthenticated. Ask about correctness/trust.
3. Algorithm: fixed window, sliding window, token bucket.
4. Counter store: Redis vs local memory. Facts: 3 instances, LB round-robin → local memory gives 3× effective limit. Recommend Redis.
5. Redis sharing: reuse the session Redis cluster or separate? Could fold into Q4 or separate decision — separate question (blast radius, key namespace, timeouts).
6. Fail-open vs fail-closed when Redis unreachable.
7. Rejected response shape: 429 + Retry-After + body? Headers?
8. Limits/numbers: what rate limits for normal/enterprise; who owns the numbers.
9. Enterprise higher limits mechanism: config file, DB, Redis config, per-customer table.
10. Rollout: shadow mode (count-only log), gradual %, hard cut, whitelist during rollout.
11. Also burst: token bucket burst size vs sustained rate — part of algorithm numbers.
12. Timeout for Redis calls (latency budget on hot path).

Dependencies: numbers of limits depend on mechanism (9 depends on 8?), but asking mechanism and ownership can be first-round. Response shape partly depends on algorithm (Retry-After computable with fixed window). Rollout options partly depend on... can ask independently (shadow mode possible with any algorithm).

Per round format: number questions, recommended answer, word so "yes" accepts recommendation. Use the ask tool — MUST put every question through ask per system prompt. The skill says format rounds in chat with ❓/**Q1**... but the runtime instructions say: instructions assume no dialog; with `ask` available, calling it is how you follow them. Keep content, order, recommendations, carry over. So build the ask call with all frontier questions.

Max 5 options per question, questions array no stated max — "Put the independent questions of a round in one call". 10 questions in one call may be heavy but allowed. Let me trim to the genuinely independent frontier:

1. Endpoint scope (all vs POST only)
2. Limit key (customer ID, IP, both) — header trust issue fact
3. Counters: Redis (shared with sessions) vs Redis (separate) vs in-memory — maybe split store and shared-cluster. Combine into one question with 3-4 options? Options: local memory; existing session Redis; new separate Redis. That's one decision.
4. Fail-open vs fail-closed
5. Algorithm (fixed window / sliding window / token bucket)
6. Limit numbers & ownership — this is two things; ask ownership (who owns numbers: user's team, per-customer defaults) and initial numbers. Could ask "do you know current legitimate burst profile" — a fact only the user knows. That's a user fact question, fine.
7. Enterprise override mechanism
8. Rejected client response (429 shape, headers)
9. Rollout strategy (shadow mode first vs hard on with whitelist)

That's 9 questions. Redis timeout/latency budget — depends on store choice (Q3), so push to later round. Header trust (x-customer-id unauthenticated) fits in Q2 brief.

Also fact: does GET need rate limiting — part of Q1 scope.

Let me also consider: rolling deployment coordination for in-memory vs Redis is moot if Redis chosen. Fine.

Write the ask call with briefs including evidence from server.ts lines.
```

### Model reply

PLAN.md read; `src/server.ts` confirms the mechanics: Bun.serve, auth is just a client-asserted `x-customer-id` header (line 7–8, no token check), and both `POST /orders` and `GET /orders` sit behind the same fetch handler. That grounds the first round. The frontier below is every decision with settled prerequisites — nothing downstream of your answers is in it yet.

Round 1:

### ask call

```json
{"questions":"[{\"id\": \"scope\", \"options\": [{\"description\": \"POST is the expensive call; GET stays unthrottled\", \"label\": \"POST /orders only\", \"tradeoff\": \"Protects the Postgres hot spot, zero risk to cheap reads, but queries can still hammer the DB\"}, {\"description\": \"POST limits tight, GET limits loose (e.g. 10× higher)\", \"label\": \"Both endpoints\", \"tradeoff\": \"Full protection, but doubles the limits to define and explain to integrators\"}, {\"description\": \"One global bucket per customer\", \"label\": \"Everything uniformly\", \"tradeoff\": \"Simplest to reason about, but a GET script can starve POST quota\"}], \"brief\": {\"what\": \"Endpoints in scope: POST /orders only, GET /orders too, or everything on the server\", \"where\": \"PLAN.md line 9: POST is the expensive call, GET is cheap. src/server.ts has exactly two routes.\", \"how\": \"Decides how many limit buckets and rate configs you maintain. Cheap calls can still amplify under loops, so protection breadth is a real choice.\"}, \"recommended\": 1}, \"header\": \"Scope\"}, {\"id\": \"key\", \"options\": [{\"description\": \"Current behavior already uses it; IP/spec appeals get manually reviewed\", \"label\": \"Yes, customer ID, plus spec-fallback review\", \"tradeoff\": \"Simple and matches who you can actually bill/talk to; occasional false positives on malformed headers\"}, {\"description\": \"Counters keyed x-customer-id + client IP\", \"label\": \"Customer ID, downgraded to IP when header is missing/invalid\", \"tradeoff\": \"Handles the 401 flood path, but shared NAT IPs can collide into one bucket\"}, {\"description\": \"Two independent limits, both must pass\", \"label\": \"Both always (AND)\", \"tradeoff\": \"Strictest, but multiplies tooling: customers behind office NATs hit the IP limit as a shared pool\"}], \"brief\": {\"what\": \"Key: x-customer-id, client IP, or both\", \"where\": \"PLAN.md lists this as undecided. Fact from src/server.ts:7-8: x-customer-id is a plain client-asserted header with no token check, and requests without it already get 401. So the 40k-order script authenticated itself; IP is only a fallback for header-less junk.\", \"how\": \"Decides the counter key and whether the 401 flood path is rate-limited at all. If you want the IP fallback you also inherit NAT collisions (many customers behind one office IP).\"}, \"recommended\": 0}, \"header\": \"Limit key\"}, {\"id\": \"store\", \"options\": [{\"description\": \"Same cluster, keys prefixed rl: and timeouts enforced\", \"label\": \"Yes, existing Redis, namespaced keys\", \"tradeoff\": \"No new infra this week, but a rate-limit latency spike or hot key shares fate with the other service\"}, {\"description\": \"Dedicated instance/namespace for rate limiting\", \"label\": \"Yes, but a separate Redis\", \"tradeoff\": \"Blast-radius isolation, but provisioning a new Redis this week is the long pole\"}, {\"description\": \"Each of 3 instances counts independently; effective limit becomes 3× what you set under round-robin LB\", \"label\": \"No — in-memory per instance\", \"tradeoff\": \"Zero network latency and no Redis dependency, but the limit isn't actually a limit: 3 instances round-robin means a script gets N×k requests\"}], \"brief\": {\"what\": \"Do we reuse the Redis 7 cluster that sessions already use, run a separate one, or keep counters in instance memory\", \"where\": \"PLAN.md: 3 instances behind round-robin LB, Redis cluster already exists for sessions by another service.\", \"how\": \"In-memory under round-robin means each customer effectively gets 3× the configured limit and per-instance drift; Redis is the only shared truth on 3 instances. Reusing the session cluster couples the rate limiter's fail mode to another service's cache.\"}, \"recommended\": 0}, \"header\": \"Counter store\"}, {\"id\": \"fail_mode\", \"options\": [{\"description\": \"On Redis timeout/error, count locally as approximation or just allow\", \"label\": \"Fail-open\", \"tradeoff\": \"Availability preserved; a Redis outage re-opens the 40k-order flood exactly when you're firefighting it\"}, {\"description\": \"Reject with 503 when the counter is unreachable\", \"label\": \"Fail-closed\", \"tradeoff\": \"Protection intact, but Redis blips now 5xx every order endpoint — worse blast radius than the problem being solved\"}, {\"description\": \"Fail open, but log >N req/min per customer during degraded mode\", \"label\": \"Fail-open + alert loudly on degradation\", \"tradeoff\": \"Keeps orders flowing and still detects abuse during outages, but needs a log/alert sink\"}], \"brief\": {\"what\": \"When the counter store is unreachable, allow the request or reject it\", \"where\": \"PLAN.md lists this undecided. If you picked in-memory in the previous step this is almost moot (answer anyway; it also covers Postgres being slow mid-request).\", \"how\": \"Sets the failure coupling between Redis health and order availability. Shapes ops: either way you need an alert on degraded mode.\"}, \"recommended\": 2}, \"header\": \"Fail mode\"}, {\"id\": \"algorithm\", \"options\": [{\"description\": \"Redis INCR + EXPIRE, ~2 commands, well-understood\", \"label\": \"Yes — fixed window\", \"tradeoff\": \"Cheapest and easiest to reason about/retry against; boundary burst can admit roughly 2× limit at window edges\"}, {\"description\": \"Accurate average, no edge burst\", \"label\": \"Sliding window (approximate, two timestamps)\", \"tradeoff\": \"Smooths the boundary problem, ~2× the Redis work and harder to explain Retry-After\"}, {\"description\": \"Limits sustained rate AND burst; keeps the 'legit burst' behavior\", \"label\": \"No — token bucket\", \"tradeoff\": \"Best fit for scripted bursts, but needs Lua/atomic refill, more tuning knobs, and Retry-After is approximate\"}], \"brief\": {\"what\": \"Fixed window, sliding window, or token bucket\", \"where\": \"PLAN.md undecided. Fact: ~20 enterprise customers legitimately burst, which is the whole reason this is delicate.\", \"how\": \"Bursty-but-legit traffic is exactly where fixed window's boundary effect (up to ~2× limit at window edges) and token bucket's burst credit differ. Choice also determines what Retry-After you can compute.\"}, \"recommended\": 2}, \"header\": \"Algorithm\"}, {\"id\": \"limits\", \"options\": [{\"description\": \"You or the team on-call owns the current numbers; revisit after a month of data\", \"label\": \"Yes — you set them from today's data, team owns them\", \"tradeoff\": \"Fast, but none of the 20 enterprises were consulted before their scripts suddenly 429\"}, {\"description\": \"Buckets become a contract; account management owns exceptions entirely\", \"label\": \"Yes — but published as a documented contract\", \"tradeoff\": \"Predictable for integrators and frees you from ad-hoc approvals; changes become a process, not a deploy\"}, {\"description\": \"Enterprise numbers set per-customer through account management\", \"label\": \"No — engineering owns infrastructure defaults, accounts owns per-customer overrides\", \"tradeoff\": \"Right incentive split, but you need an escalation path defined before launch\"}], \"brief\": {\"what\": \"Who owns the limit numbers — engineering defaults, or per-customer contracts — and do we know the current legitimate burst profile\", \"where\": \"PLAN.md: 'who owns those numbers' is explicitly undecided; ~20 enterprise customers with scripted bursts.\", \"how\": \"Ownership decides whether raising a limit is a deploy, a config change, or an email to another team. Numbers decide who breaks on launch day.\"}, \"recommended\": 2}, \"header\": \"Limit ownership\"}, {\"id\": \"elevation\", \"options\": [{\"description\": \"File or Postgres table per customer; re-read on change\", \"label\": \"Yes — per-customer config (DB table or config file)\", \"tradeoff\": \"No code deploys to raise a limit; adds one lookup per request (cacheable)\"}, {\"description\": \"Serve limits from Redis keys; support sets them\", \"tradeoff\": \"Instant take-effect with zero deploys, but now the config channel is the same store you fail over on\"}, {\"description\": \"Shipped as code constants; PR to change\", \"label\": \"No — two hardcoded tiers, PR to change\", \"tradeoff\": \"Zero extra machinery this week, but every enterprise exception is a deploy and a review\"}], \"brief\": {\"what\": \"Mechanism for higher enterprise limits: hardcoded tiers, config file, DB rows, or Redis keys\", \"where\": \"PLAN.md: 'How enterprise customers get higher limits' undecided; default tier(s) will be decided in the next round once this mechanism exists.\", \"how\": \"Decides who can change a limit at what speed and whether support/engineering need each other.\"}, \"recommended\": 0}, \"header\": \"Enterprise elevation\"}, {\"id\": \"response\", \"options\": [{\"description\": \"Industry-standard; scripted integrators already handle it\", \"label\": \"429 + Retry-After header + machine-readable body\", \"tradeoff\": \"A few lines of extra code; old naive scripts may just retry immediately in a tight loop, which need exponential backoff guidance in docs\"}, {\"description\": \"Body only; simplest\", \"label\": \"429 with body, no headers\", \"tradeoff\": \"Minimal, but scripts can't back off intelligently and will poll\"}, {\"description\": \"Match reads like a bug report\", \"label\": \"503 instead of 429\", \"tradeoff\": \"Some frameworks auto-retry 503; misleading semantics\"}], \"brief\": {\"what\": \"What a rejected client sees: status code, headers, body shape\", \"where\": \"PLAN.md undecided. src/server.ts currently returns plain-text responses for 401/404, so there is no existing error-body convention to preserve.\", \"how\": \"429 + Retry-After is the standard scripts and HTTP libraries already honor; 503 gets conflated with server outage by retry logic.\"}, \"recommended\": 0}, \"header\": \"Rejection shape\"}, {\"id\": \"rollout\", \"options\": [{\"description\": \"Ship counting first, review the log for violators, then flip enforcement\", \"label\": \"Yes — shadow mode (log-only) for a week, then enforce\", \"tradeoff\": \"No integrator breaks; delays enforcement by a week (you said ship this week — counting ships, blocking waits)\"}, {\"description\": \"Mispredicted burst profiles cause 429s in production scripts with minutes of warning\", \"label\": \"No — enforce immediately, but with per-customer block芽exceptions for the top talkers\", \"tradeoff\": \"Fastest to real protection; any limit you guessed wrong breaks that customer's script today\"}, {\"description\": \"Sample of traffic pays the cost of your tuning\", \"label\": \"No — enforce, but only on ~5% of requests for the first days\", \"tradeoff\": \"Limits ValidationError risk, but sampling itself breaks per-customer burst expectations and is confusing to debug\"}], \"brief\": {\"what\": \"Rollout strategy: shadow (log-only) first, gradual enforcement, or hard enable with whitelist\", \"where\": \"PLAN.md lists rollout as undecided, and the plan ships this week. 20 enterprise integrators were not consulted (they learn about it when they hit a 429).\", \"how\": \"Shadow mode turns wrong limit guesses into log lines instead of broken customer scripts; the cost is a week of delay.\"}, \"recommended\": 0}, \"header\": \"Rollout\"}]"}
```

### ask result

```text
Validation failed for tool "ask":
  - questions: questions must be independent decisions, one tab each; a decision that depends on another answer goes in a later call (was a string)

Received arguments:
{
  "questions": "[{\"id\": \"scope\", \"options\": [{\"description\": \"POST is the expensive call; GET stays unthrottled\", \"label\": \"POST /orders only\", \"tradeoff\": \"Protects the Postgres hot spot, zero risk to cheap reads, but queries can still hammer the DB\"}, {\"description\": \"P… [truncated 10506 chars]"
}
```

### Model reasoning

```text
The questions parameter was passed as a string; must be actual array. Also I noticed a typo "block芽exceptions" — fix that. Retry with real JSON array.
```

### ask call

```json
{"questions":[{"brief":{"how":"Decides how many limit buckets and rate configs you maintain. Cheap calls can still amplify under loops, so protection breadth is a real choice.","what":"Endpoints in scope: POST /orders only, GET /orders too, or everything on the server","where":"PLAN.md line 9: POST is the expensive call, GET is cheap. src/server.ts has exactly two routes."},"header":"Scope","id":"scope","options":[{"description":"POST is the expensive call; GET stays unthrottled","label":"POST /orders only","tradeoff":"Protects the Postgres hot spot, zero risk to cheap reads, but runaway queries can still hammer the DB"},{"description":"POST limits tight, GET limits loose (e.g. 10x higher)","label":"Both endpoints","tradeoff":"Full protection, but doubles the limits to define and explain to integrators"},{"description":"One global bucket per customer","label":"Everything uniformly","tradeoff":"Simplest to reason about, but a GET script can starve POST quota"}],"recommended":1},{"brief":{"how":"Decides the counter key and whether the 401 flood path is rate-limited at all. If you want the IP fallback you also inherit NAT collisions (many customers behind one office IP).","what":"Key: x-customer-id, client IP, or both","where":"PLAN.md lists this as undecided. Fact from src/server.ts:7-8: x-customer-id is a plain client-asserted header with no token check, and requests without it already get 401. So the 40k-order script authenticated itself; IP is only a fallback for header-less junk."},"header":"Limit key","id":"key","options":[{"description":"Current behavior already uses it; IP/spec appeals get manually reviewed","label":"Yes, customer ID, plus spec-fallback review","tradeoff":"Simple and matches who you can actually bill/talk to; occasional false positives on malformed headers"},{"description":"Counters keyed x-customer-id + client IP","label":"Customer ID, downgraded to IP when header is missing/invalid","tradeoff":"Handles the 401 flood path, but shared NAT IPs can collide into one bucket"},{"description":"Two independent limits, both must pass","label":"Both always (AND)","tradeoff":"Strictest, but multiplies tooling: customers behind office NATs hit the IP limit as a shared pool"}],"recommended":0},{"brief":{"how":"In-memory under round-robin means each customer effectively gets 3x the configured limit and per-instance drift; Redis is the only shared truth on 3 instances. Reusing the session cluster couples the rate limiter's fail mode to another service's cache.","what":"Do we reuse the Redis 7 cluster that sessions already use, run a separate one, or keep counters in instance memory","where":"PLAN.md: 3 instances behind round-robin LB, Redis cluster already exists for sessions by another service."},"header":"Counter store","id":"store","options":[{"description":"Same cluster, keys prefixed rl: and timeouts enforced","label":"Yes, existing Redis, namespaced keys","tradeoff":"No new infra this week, but a rate-limit latency spike or hot key shares fate with the other service"},{"description":"Dedicated instance/namespace for rate limiting","label":"Yes, but a separate Redis","tradeoff":"Blast-radius isolation, but provisioning a new Redis this week is the long pole"},{"description":"Each of 3 instances counts independently; effective limit becomes 3x what you set under round-robin LB","label":"No - in-memory per instance","tradeoff":"Zero network latency and no Redis dependency, but the limit isn't actually a limit: under round-robin a script gets N x 3 requests"}],"recommended":0},{"brief":{"how":"Sets the failure coupling between Redis health and order availability. Shapes ops: either way you need an alert on degraded mode.","what":"When the counter store is unreachable, allow the request or reject it","where":"PLAN.md lists this undecided. If you picked in-memory in the previous step this is almost moot (answer anyway; it also covers Postgres being slow mid-request)."},"header":"Fail mode","id":"fail_mode","options":[{"description":"On Redis timeout/error, count locally as approximation or just allow","label":"Fail-open","tradeoff":"Availability preserved; a Redis outage re-opens the 40k-order flood exactly when you're firefighting it"},{"description":"Reject with 503 when the counter is unreachable","label":"Fail-closed","tradeoff":"Protection intact, but Redis blips now 5xx every order endpoint - worse blast radius than the problem being solved"},{"description":"Fail open, but log >N req/min per customer during degraded mode","label":"Fail-open + alert loudly on degradation","tradeoff":"Keeps orders flowing and still detects abuse during outages, but needs a log/alert sink"}],"recommended":2},{"brief":{"how":"Bursty-but-legit traffic is exactly where fixed window's boundary effect (up to ~2x limit at window edges) and token bucket's burst credit differ. Choice also determines what Retry-After you can compute.","what":"Fixed window, sliding window, or token bucket","where":"PLAN.md undecided. Fact: ~20 enterprise customers legitimately burst, which is the whole reason this is delicate."},"header":"Algorithm","id":"algorithm","options":[{"description":"Redis INCR + EXPIRE, ~2 commands, well-understood","label":"Yes - fixed window","tradeoff":"Cheapest and easiest to reason about/retry against; boundary burst can admit roughly 2x limit at window edges"},{"description":"Accurate average, no edge burst","label":"Sliding window (approximate, two timestamps)","tradeoff":"Smooths the boundary problem, ~2x the Redis work and harder to explain Retry-After"},{"description":"Limits sustained rate AND burst; keeps the 'legit burst' behavior","label":"No - token bucket","tradeoff":"Best fit for scripted bursts, but needs Lua/atomic refill, more tuning knobs, and Retry-After is approximate"}],"recommended":2},{"brief":{"how":"Ownership decides whether raising a limit is a deploy, a config change, or an email to another team. Numbers decide who breaks on launch day.","what":"Who owns the limit numbers - engineering defaults, or per-customer contracts","where":"PLAN.md: 'who owns those numbers' is explicitly undecided; ~20 enterprise customers with scripted bursts."},"header":"Limit ownership","id":"limits","options":[{"description":"You or the team on-call owns the current numbers; revisit after a month of data","label":"Yes - you set them from today's data, team owns them","tradeoff":"Fast, but none of the 20 enterprises were consulted before their scripts suddenly 429"},{"description":"Buckets become a contract; account management owns exceptions entirely","label":"Yes - but published as a documented contract","tradeoff":"Predictable for integrators and frees you from ad-hoc approvals; changes become a process, not a deploy"},{"description":"Enterprise numbers set per-customer through account management","label":"No - engineering owns infrastructure defaults, accounts owns per-customer overrides","tradeoff":"Right incentive split, but you need an escalation path defined before launch"}],"recommended":2},{"brief":{"how":"Decides who can change a limit at what speed and whether support/engineering need each other.","what":"Mechanism for higher enterprise limits: hardcoded tiers, config file, DB rows, or Redis keys","where":"PLAN.md: 'How enterprise customers get higher limits' undecided; default tier(s) will be decided in the next round once this mechanism exists."},"header":"Enterprise elevation","id":"elevation","options":[{"description":"File or Postgres table per customer; re-read on change","label":"Yes - per-customer config (DB table or config file)","tradeoff":"No code deploys to raise a limit; adds one lookup per request (cacheable)"},{"description":"Serve limits from Redis keys; support sets them","label":"Serve limits from Redis keys","tradeoff":"Instant take-effect with zero deploys, but now the config channel is the same store you fail over on"},{"description":"Shipped as code constants; PR to change","label":"No - two hardcoded tiers, PR to change","tradeoff":"Zero extra machinery this week, but every enterprise exception is a deploy and a review"}],"recommended":0},{"brief":{"how":"429 + Retry-After is the standard scripts and HTTP libraries already honor; 503 gets conflated with server outage by retry logic.","what":"What a rejected client sees: status code, headers, body shape","where":"PLAN.md undecided. src/server.ts currently returns plain-text responses for 401/404, so there is no existing error-body convention to preserve."},"header":"Rejection shape","id":"response","options":[{"description":"Industry-standard; scripted integrators already handle it","label":"429 + Retry-After header + machine-readable body","tradeoff":"A few lines of extra code; old naive scripts may just retry immediately in a tight loop - they need exponential backoff guidance in docs"},{"description":"Body only; simplest","label":"429 with body, no headers","tradeoff":"Minimal, but scripts can't back off intelligently and will poll"},{"description":"Match reads like a bug report","label":"503 instead of 429","tradeoff":"Some frameworks auto-retry 503; misleading semantics"}],"recommended":0},{"brief":{"how":"Shadow mode turns wrong limit guesses into log lines instead of broken customer scripts; the cost is a week of delay.","what":"Rollout strategy: shadow (log-only) first, gradual enforcement, or hard enable with exceptions","where":"PLAN.md lists rollout as undecided, and the plan ships this week. 20 enterprise integrators were not consulted (they learn about it when they hit a 429)."},"header":"Rollout","id":"rollout","options":[{"description":"Ship counting first, review the log for violators, then flip enforcement","label":"Yes - shadow mode (log-only) for a week, then enforce","tradeoff":"No integrator breaks; delays enforcement by a week (you said ship this week - counting ships, blocking waits)"},{"description":"Mispredicted burst profiles cause 429s in production scripts with minutes of warning","label":"No - enforce immediately with per-customer exceptions for top talkers","tradeoff":"Fastest to real protection; any limit you guessed wrong breaks that customer's script today"},{"description":"Sample of traffic pays the cost of your tuning","label":"No - enforce on ~5% of requests for the first days","tradeoff":"Limits breakage risk, but sampling itself breaks per-customer burst expectations and is confusing to debug"}],"recommended":0}]}
```

### ask result

```text
Validation failed for tool "ask":
  - questions/0/question: questions[0].question must be one or two sentences; the brief carries the context (was missing)
  - questions/1/question: questions[1].question must be one or two sentences; the brief carries the context (was missing)
  - questions/2/question: questions[2].question must be one or two sentences; the brief carries the context (was missing)
  - questions/3/question: questions[3].question must be one or two sentences; the brief carries the context (was missing)
  - questions/4/question: questions[4].question must be one or two sentences; the brief carries the context (was missing)
  - questions/5/question: questions[5].question must be one or two sentences; the brief carries the context (was missing)
  - questions/6/question: questions[6].question must be one or two sentences; the brief carries the context (was missing)
  - questions/7/question: questions[7].question must be one or two sentences; the brief carries the context (was missing)
  - questions/8/question: questions[8].question must be one or two sentences; the brief carries the context (was missing)

Received arguments:
{
  "questions": [
    {
      "brief": {
        "how": "Decides how many limit buckets and rate configs you maintain. Cheap calls can still amplify under loops, so protection breadth is a real choice.",
        "what": "Endpoints in scope: POST /orders only, GET /orders too, or everything on the server",
        "where": "PLAN.md line 9: POST is the expensive call, GET is cheap. src/server.ts has exactly two routes."
      },
      "header": "Scope",
      "id": "scope",
      "options": [
        {
          "description": "POST is the expensive call; GET stays unthrottled",
          "label": "POST /orders only",
          "tradeoff": "Protects the Postgres hot spot, zero risk to cheap reads, but runaway queries can still hammer the DB"
        },
        {
          "description": "POST limits tight, GET limits loose (e.g. 10x higher)",
          "label": "Both endpoints",
          "tradeoff": "Full protection, but doubles the limits to define and explain to integrators"
        },
        {
          "description": "One global bucket per customer",
          "label": "Everything uniformly",
          "tradeoff": "Simplest to reason about, but a GET script can starve POST quota"
        }
      ],
      "recommended": 1
    },
    {
      "brief": {
        "how": "Decides the counter key and whether the 401 flood path is rate-limited at all. If you want the IP fallback you also inherit NAT collisions (many customers behind one office IP).",
        "what": "Key: x-customer-id, client IP, or both",
        "where": "PLAN.md lists this as undecided. Fact from src/server.ts:7-8: x-customer-id is a plain client-asserted header with no token check, and requests without it already get 401. So the 40k-order script authenticated itself; IP is only a fallback for header-less … [truncated 5 chars]"
      },
      "header": "Limit key",
      "id": "key",
      "options": [
        {
          "description": "Current behavior already uses it; IP/spec appeals get manually reviewed",
          "label": "Yes, customer ID, plus spec-fallback review",
          "tradeoff": "Simple and matches who you can actually bill/talk to; occasional false positives on malformed headers"
        },
        {
          "description": "Counters keyed x-customer-id + client IP",
          "label": "Customer ID, downgraded to IP when header is missing/invalid",
          "tradeoff": "Handles the 401 flood path, but shared NAT IPs can collide into one bucket"
        },
        {
          "description": "Two independent limits, both must pass",
          "label": "Both always (AND)",
          "tradeoff": "Strictest, but multiplies tooling: customers behind office NATs hit the IP limit as a shared pool"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "how": "In-memory under round-robin means each customer effectively gets 3x the configured limit and per-instance drift; Redis is the only shared truth on 3 instances. Reusing the session cluster couples the rate limiter's fail mode to another service's cache.",
        "what": "Do we reuse the Redis 7 cluster that sessions already use, run a separate one, or keep counters in instance memory",
        "where": "PLAN.md: 3 instances behind round-robin LB, Redis cluster already exists for sessions by another service."
      },
      "header": "Counter store",
      "id": "store",
      "options": [
        {
          "description": "Same cluster, keys prefixed rl: and timeouts enforced",
          "label": "Yes, existing Redis, namespaced keys",
          "tradeoff": "No new infra this week, but a rate-limit latency spike or hot key shares fate with the other service"
        },
        {
          "description": "Dedicated instance/namespace for rate limiting",
          "label": "Yes, but a separate Redis",
          "tradeoff": "Blast-radius isolation, but provisioning a new Redis this week is the long pole"
        },
        {
          "description": "Each of 3 instances counts independently; effective limit becomes 3x what you set under round-robin LB",
          "label": "No - in-memory per instance",
          "tradeoff": "Zero network latency and no Redis dependency, but the limit isn't actually a limit: under round-robin a script gets N x 3 requests"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "how": "Sets the failure coupling between Redis health and order availability. Shapes ops: either way you need an alert on degraded mode.",
        "what": "When the counter store is unreachable, allow the request or reject it",
        "where": "PLAN.md lists this undecided. If you picked in-memory in the previous step this is almost moot (answer anyway; it also covers Postgres being slow mid-request)."
      },
      "header": "Fail mode",
      "id": "fail_mode",
      "options": [
        {
          "description": "On Redis timeout/error, count locally as approximation or just allow",
          "label": "Fail-open",
          "tradeoff": "Availability preserved; a Redis outage re-opens the 40k-order flood exactly when you're firefighting it"
        },
        {
          "description": "Reject with 503 when the counter is unreachable",
          "label": "Fail-closed",
          "tradeoff": "Protection intact, but Redis blips now 5xx every order endpoint - worse blast radius than the problem being solved"
        },
        {
          "description": "Fail open, but log >N req/min per customer during degraded mode",
          "label": "Fail-open + alert loudly on degradation",
          "tradeoff": "Keeps orders flowing and still detects abuse during outages, but needs a log/alert sink"
        }
      ],
      "recommended": 2
    },
    {
      "brief": {
        "how": "Bursty-but-legit traffic is exactly where fixed window's boundary effect (up to ~2x limit at window edges) and token bucket's burst credit differ. Choice also determines what Retry-After you can compute.",
        "what": "Fixed window, sliding window, or token bucket",
        "where": "PLAN.md undecided. Fact: ~20 enterprise customers legitimately burst, which is the whole reason this is delicate."
      },
      "header": "Algorithm",
      "id": "algorithm",
      "options": [
        {
          "description": "Redis INCR + EXPIRE, ~2 commands, well-understood",
          "label": "Yes - fixed window",
          "tradeoff": "Cheapest and easiest to reason about/retry against; boundary burst can admit roughly 2x limit at window edges"
        },
        {
          "description": "Accurate average, no edge burst",
          "label": "Sliding window (approximate, two timestamps)",
          "tradeoff": "Smooths the boundary problem, ~2x the Redis work and harder to explain Retry-After"
        },
        {
          "description": "Limits sustained rate AND burst; keeps the 'legit burst' behavior",
          "label": "No - token bucket",
          "tradeoff": "Best fit for scripted bursts, but needs Lua/atomic refill, more tuning knobs, and Retry-After is approximate"
        }
      ],
      "recommended": 2
    },
    {
      "brief": {
        "how": "Ownership decides whether raising a limit is a deploy, a config change, or an email to another team. Numbers decide who breaks on launch day.",
        "what": "Who owns the limit numbers - engineering defaults, or per-customer contracts",
        "where": "PLAN.md: 'who owns those numbers' is explicitly undecided; ~20 enterprise customers with scripted bursts."
      },
      "header": "Limit ownership",
      "id": "limits",
      "options": [
        {
          "description": "You or the team on-call owns the current numbers; revisit after a month of data",
          "label": "Yes - you set them from today's data, team owns them",
          "tradeoff": "Fast, but none of the 20 enterprises were consulted before their scripts suddenly 429"
        },
        {
          "description": "Buckets become a contract; account management owns exceptions entirely",
          "label": "Yes - but published as a documented contract",
          "tradeoff": "Predictable for integrators and frees you from ad-hoc approvals; changes become a process, not a deploy"
        },
        {
          "description": "Enterprise numbers set per-customer through account management",
          "label": "No - engineering owns infrastructure defaults, accounts owns per-customer overrides",
          "tradeoff": "Right incentive split, but you need an escalation path defined before launch"
        }
      ],
      "recommended": 2
    },
    {
      "brief": {
        "how": "Decides who can change a limit at what speed and whether support/engineering need each other.",
        "what": "Mechanism for higher enterprise limits: hardcoded tiers, config file, DB rows, or Redis keys",
        "where": "PLAN.md: 'How enterprise customers get higher limits' undecided; default tier(s) will be decided in the next round once this mechanism exists."
      },
      "header": "Enterprise elevation",
      "id": "elevation",
      "options": [
        {
          "description": "File or Postgres table per customer; re-read on change",
          "label": "Yes - per-customer config (DB table or config file)",
          "tradeoff": "No code deploys to raise a limit; adds one lookup per request (cacheable)"
        },
        {
          "description": "Serve limits from Redis keys; support sets them",
          "label": "Serve limits from Redis keys",
          "tradeoff": "Instant take-effect with zero deploys, but now the config channel is the same store you fail over on"
        },
        {
          "description": "Shipped as code constants; PR to change",
          "label": "No - two hardcoded tiers, PR to change",
          "tradeoff": "Zero extra machinery this week, but every enterprise exception is a deploy and a review"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "how": "429 + Retry-After is the standard scripts and HTTP libraries already honor; 503 gets conflated with server outage by retry logic.",
        "what": "What a rejected client sees: status code, headers, body shape",
        "where": "PLAN.md undecided. src/server.ts currently returns plain-text responses for 401/404, so there is no existing error-body convention to preserve."
      },
      "header": "Rejection shape",
      "id": "response",
      "options": [
        {
          "description": "Industry-standard; scripted integrators already handle it",
          "label": "429 + Retry-After header + machine-readable body",
          "tradeoff": "A few lines of extra code; old naive scripts may just retry immediately in a tight loop - they need exponential backoff guidance in docs"
        },
        {
          "description": "Body only; simplest",
          "label": "429 with body, no headers",
          "tradeoff": "Minimal, but scripts can't back off intelligently and will poll"
        },
        {
          "description": "Match reads like a bug report",
          "label": "503 instead of 429",
          "tradeoff": "Some frameworks auto-retry 503; misleading semantics"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "how": "Shadow mode turns wrong limit guesses into log lines instead of broken customer scripts; the cost is a week of delay.",
        "what": "Rollout strategy: shadow (log-only) first, gradual enforcement, or hard enable with exceptions",
        "where": "PLAN.md lists rollout as undecided, and the plan ships this week. 20 enterprise integrators were not consulted (they learn about it when they hit a 429)."
      },
      "header": "Rollout",
      "id": "rollout",
      "options": [
        {
          "description": "Ship counting first, review the log for violators, then flip enforcement",
          "label": "Yes - shadow mode (log-only) for a week, then enforce",
          "tradeoff": "No integrator breaks; delays enforcement by a week (you said ship this week - counting ships, blocking waits)"
        },
        {
          "description": "Mispredicted burst profiles cause 429s in production scripts with minutes of warning",
          "label": "No - enforce immediately with per-customer exceptions for top talkers",
          "tradeoff": "Fastest to real protection; any limit you guessed wrong breaks that customer's script today"
        },
        {
          "description": "Sample of traffic pays the cost of your tuning",
          "label": "No - enforce on ~5% of requests for the first days",
          "tradeoff": "Limits breakage risk, but sampling itself breaks per-customer burst expectations and is confusing to debug"
        }
      ],
      "recommended": 0
    }
  ]
}
```

### Model reasoning

```text
I forgot the `question` field on each. Add one-sentence questions, phrased so "yes" accepts recommendation.
```

### ask call

```json
{"questions":"[{\"brief\": {\"how\": \"Decides how many limit buckets and rate configs you maintain. Cheap calls can still amplify under loops, so protection breadth is a real choice.\", \"what\": \"Endpoints in scope: POST /orders only, GET /orders too, or everything on the server\", \"where\": \"PLAN.md line 9: POST is the expensive call, GET is cheap. src/server.ts has exactly two routes.\"}, \"header\": \"Scope\", \"id\": \"scope\", \"options\": [{\"description\": \"POST is the expensive call; GET stays unthrottled\", \"label\": \"POST /orders only\", \"tradeoff\": \"Protects the Postgres hot spot, zero risk to cheap reads, but runaway queries can still hammer the DB\"}, {\"description\": \"POST limits tight, GET limits loose (e.g. 10x higher)\", \"label\": \"Both endpoints\", \"tradeoff\": \"Full protection, but doubles the limits to define and explain to integrators\"}, {\"description\": \"One global bucket per customer\", \"label\": \"Everything uniformly\", \"tradeoff\": \"Simplest to reason about, but a GET script can starve POST quota\"}], \"question\": \"Should the limit apply to both POST and GET /orders, with GET allowed a much higher rate than POST?\"}, \"recommended\": 1, {\"brief\": {\"how\": \"Decides the counter key and whether the 401 flood path is rate-limited at all. If you want the IP fallback you also inherit NAT collisions (many customers behind one office IP).\", \"what\": \"Key: x-customer-id, client IP, or both\", \"where\": \"PLAN.md lists this as undecided. Fact from src/server.ts:7-8: x-customer-id is a plain client-asserted header with no token check, and requests without it already get 401. So the 40k-order script authenticated itself; IP is only a fallback for header-less junk.\"}, \"header\": \"Limit key\", \"id\": \"key\", \"options\": [{\"description\": \"Current behavior already uses it; IP/spec appeals get manually reviewed\", \"label\": \"Yes, customer ID only\", \"tradeoff\": \"Simple and matches who you can actually bill/talk to; the header-less flood path stays unthrottled\"}, {\"description\": \"Counters keyed x-customer-id + client IP\", \"label\": \"Customer ID, downgraded to IP when header is missing/invalid\", \"tradeoff\": \"Handles the 401 flood path too, but shared NAT IPs can collide into one bucket\"}, {\"description\": \"Two independent limits, both must pass\", \"label\": \"Both always (AND)\", \"tradeoff\": \"Strictest, but multiplies tooling: customers behind office NATs hit the IP limit as a shared pool\"}], \"question\": \"Should the limit key on x-customer-id only (the header the server already requires)?\", \"recommended\": 0}, {\"brief\": {\"how\": \"In-memory under round-robin means each customer effectively gets 3x the configured limit and per-instance drift; Redis is the only shared truth on 3 instances. Reusing the session cluster couples the rate limiter's fail mode to another service's cache.\", \"what\": \"Do we reuse the Redis 7 cluster that sessions already use, run a separate one, or keep counters in instance memory\", \"where\": \"PLAN.md: 3 instances behind round-robin LB, Redis cluster already exists for sessions by another service.\"}, \"header\": \"Counter store\", \"id\": \"store\", \"options\": [{\"description\": \"Same cluster, keys prefixed rl: and timeouts enforced\", \"label\": \"Yes, existing Redis, namespaced keys\", \"tradeoff\": \"No new infra this week, but a rate-limit latency spike or hot key shares fate with the other service\"}, {\"description\": \"Dedicated instance/namespace for rate limiting\", \"label\": \"Yes, but a separate Redis\", \"tradeoff\": \"Blast-radius isolation, but provisioning a new Redis this week is the long pole\"}, {\"description\": \"Each of 3 instances counts independently; effective limit becomes 3x what you set under round-robin LB\", \"label\": \"No - in-memory per instance\", \"tradeoff\": \"Zero network latency and no Redis dependency, but the limit isn't actually a limit: under round-robin a script gets N x 3 requests\"}], \"question\": \"Do counters live in the existing Redis cluster (namespaced keys, no new infrastructure)?\", \"recommended\": 0}, {\"brief\": {\"how\": \"Sets the failure coupling between Redis health and order availability. Shapes ops: either way you need an alert on degraded mode.\", \"what\": \"When the counter store is unreachable, allow the request or reject it\", \"where\": \"PLAN.md lists this undecided. If you picked in-memory in the previous step this is almost moot (answer anyway; it also covers Postgres being slow mid-request).\"}, \"header\": \"Fail mode\", \"id\": \"fail_mode\", \"options\": [{\"description\": \"On Redis timeout/error, count locally as approximation or just allow\", \"label\": \"Fail-open\", \"tradeoff\": \"Availability preserved; a Redis outage re-opens the 40k-order flood exactly when you're firefighting it\"}, {\"description\": \"Reject with 503 when the counter is unreachable\", \"label\": \"Fail-closed\", \"tradeoff\": \"Protection intact, but Redis blips now 5xx every order endpoint - worse blast radius than the problem being solved\"}, {\"description\": \"Fail open, but log >N req/min per customer during degraded mode\", \"label\": \"Fail-open + alert loudly on degradation\", \"tradeoff\": \"Keeps orders flowing and still detects abuse during outages, but needs a log/alert sink\"}], \"question\": \"If Redis is unreachable, should requests pass through unfettered while an alert fires?\"}, \"recommended\": 2, {\"brief\": {\"how\": \"Bursty-but-legit traffic is exactly where fixed window's boundary effect (up to ~2x limit at window edges) and token bucket's burst credit differ. Choice also determines what Retry-After you can compute.\", \"what\": \"Fixed window, sliding window, or token bucket\", \"where\": \"PLAN.md undecided. Fact: ~20 enterprise customers legitimately burst, which is the whole reason this is delicate.\"}, \"header\": \"Algorithm\", \"id\": \"algorithm\", \"options\": [{\"description\": \"Redis INCR + EXPIRE, ~2 commands, well-understood\", \"label\": \"Yes - fixed window\", \"tradeoff\": \"Cheapest and easiest to reason about/retry against; boundary burst can admit roughly 2x limit at window edges\"}, {\"description\": \"Accurate average, no edge burst\", \"label\": \"Sliding window (approximate, two timestamps)\", \"tradeoff\": \"Smooths the boundary problem, ~2x the Redis work and harder to explain Retry-After\"}, {\"description\": \"Limits sustained rate AND burst; keeps the 'legit burst' behavior\", \"label\": \"No - token bucket\", \"tradeoff\": \"Best fit for scripted bursts, but needs Lua/atomic refill, more tuning knobs, and Retry-After is approximate\"}], \"question\": \"Do you reject fixed window and use a token bucket, to honor bursty-but-legit enterprise traffic while capping sustained rate?\", \"recommended\": 2}, {\"brief\": {\"how\": \"Ownership decides whether raising a limit is a deploy, a config change, or an email to another team. Numbers decide who breaks on launch day.\", \"what\": \"Who owns the limit numbers - engineering defaults, or per-customer contracts\", \"where\": \"PLAN.md: 'who owns those numbers' is explicitly undecided; ~20 enterprise customers with scripted bursts.\"}, \"header\": \"Limit ownership\", \"id\": \"limits\", \"options\": [{\"description\": \"You or the team on-call owns the current numbers; revisit after a month of data\", \"label\": \"Yes - you set them from today's data, team owns them\", \"tradeoff\": \"Fast, but none of the 20 enterprises were consulted before their scripts suddenly 429\"}, {\"description\": \"Buckets become a contract; account management owns exceptions entirely\", \"label\": \"Yes - but published as a documented contract\", \"tradeoff\": \"Predictable for integrators and frees you from ad-hoc approvals; changes become a process, not a deploy\"}, {\"description\": \"Enterprise numbers set per-customer through account management\", \"label\": \"No - engineering owns infrastructure defaults, accounts owns per-customer overrides\", \"tradeoff\": \"Right incentive split, but you need an escalation path defined before launch\"}], \"question\": \"Should engineering own the default limits while account management owns per-customer enterprise overrides?\"}, \"recommended\": 2, {\"brief\": {\"how\": \"Decides who can change a limit at what speed and whether support/engineering need each other.\", \"what\": \"Mechanism for higher enterprise limits: hardcoded tiers, config file, DB rows, or Redis keys\", \"where\": \"PLAN.md: 'How enterprise customers get higher limits' undecided; default tier(s) will be decided in the next round once this mechanism exists.\"}, \"header\": \"Enterprise elevation\", \"id\": \"elevation\", \"options\": [{\"description\": \"File or Postgres table per customer; re-read on change\", \"label\": \"Yes - per-customer config (DB table or config file)\", \"tradeoff\": \"No code deploys to raise a limit; adds one lookup per request (cacheable)\"}, {\"description\": \"Serve limits from Redis keys; support sets them\", \"label\": \"Serve limits from Redis keys\", \"tradeoff\": \"Instant take-effect with zero deploys, but now the config channel is the same store you fail over on\"}, {\"description\": \"Shipped as code constants; PR to change\", \"label\": \"No - two hardcoded tiers, PR to change\", \"tradeoff\": \"Zero extra machinery this week, but every enterprise exception is a deploy and a review\"}], \"question\": \"Should per-customer limits be runtime configuration (Postgres row or config file), so raising one is not a code deploy?\"}, \"recommended\": 0}, {\"brief\": {\"how\": \"429 + Retry-After is the standard scripts and HTTP libraries already honor; 503 gets conflated with server outage by retry logic.\", \"what\": \"What a rejected client sees: status code, headers, body shape\", \"where\": \"PLAN.md undecided. src/server.ts currently returns plain-text responses for 401/404, so there is no existing error-body convention to preserve.\"}, \"header\": \"Rejection shape\", \"id\": \"response\", \"options\": [{\"description\": \"Industry-standard; scripted integrators already handle it\", \"label\": \"429 + Retry-After header + machine-readable body\", \"tradeoff\": \"A few lines of extra code; old naive scripts may just retry immediately in a tight loop - they need exponential backoff guidance in docs\"}, {\"description\": \"Body only; simplest\", \"label\": \"429 with body, no headers\", \"tradeoff\": \"Minimal, but scripts can't back off intelligently and will poll\"}, {\"description\": \"Match reads like a bug report\", \"label\": \"503 instead of 429\", \"tradeoff\": \"Some frameworks auto-retry 503; misleading semantics\"}], \"question\": \"Should a rejected request return 429 with a Retry-After header and a machine-readable body?\"}, \"recommended\": 0}, {\"brief\": {\"how\": \"Shadow mode turns wrong limit guesses into log lines instead of broken customer scripts; the cost is a week of delay.\", \"what\": \"Rollout strategy: shadow (log-only) first, gradual enforcement, or hard enable with exceptions\", \"where\": \"PLAN.md lists rollout as undecided, and the plan ships this week. 20 enterprise integrators were not consulted (they learn about it when they hit a 429).\"}, \"header\": \"Rollout\", \"id\": \"rollout\", \"options\": [{\"description\": \"Ship counting first, review the log for violators, then flip enforcement\", \"label\": \"Yes - shadow mode (log-only) for a week, then enforce\", \"tradeoff\": \"No integrator breaks; delays enforcement by a week (you said ship this week - counting ships, blocking waits)\"}, {\"description\": \"Mispredicted burst profiles cause 429s in production scripts with minutes of warning\", \"label\": \"No - enforce immediately with per-customer exceptions for top talkers\", \"tradeoff\": \"Fastest to real protection; any limit you guessed wrong breaks that customer's script today\"}, {\"description\": \"Sample of traffic pays the cost of your tuning\", \"label\": \"No - enforce on ~5% of requests for the first days\", \"tradeoff\": \"Limits breakage risk, but sampling itself breaks per-customer burst expectations and is confusing to debug\"}], \"question\": \"Should we ship in shadow mode first (count and log only), then flip enforcement after the log confirms who exceeds the limits?\"}, \"recommended\": 0}]"}
```

### ask result

```text
Validation failed for tool "ask":
  - questions: questions must be independent decisions, one tab each; a decision that depends on another answer goes in a later call (was a string)

Received arguments:
{
  "questions": "[{\"brief\": {\"how\": \"Decides how many limit buckets and rate configs you maintain. Cheap calls can still amplify under loops, so protection breadth is a real choice.\", \"what\": \"Endpoints in scope: POST /orders only, GET /orders too, or everything on the ser… [truncated 11501 chars]"
}
```

### Model reasoning

```text
The questions got serialized as a string again — likely because I put `question` after `recommended` inside array structure messily with malformed ordering (`}, "recommended": 1, {`). Actually looking at my JSON: I wrote `"question": "..."}, "recommended": 1, {"brief"...` — I put recommended outside the object. That broke it into a string somehow? Actually first attempt it also said string. The harness may serialize incorrectly when malformed. Let me retry carefully with clean structure: each question object with id, question, options, brief, header, recommended inside the object.
```

### ask call

```json
{"questions":[{"brief":{"how":"Decides how many limit buckets and rate configs you maintain. Cheap calls can still amplify under loops, so protection breadth is a real choice.","what":"Endpoints in scope: POST /orders only, GET /orders too, or everything on the server","where":"PLAN.md line 9: POST is the expensive call, GET is cheap. src/server.ts has exactly two routes."},"header":"Scope","id":"scope","options":[{"description":"POST is the expensive call; GET stays unthrottled","label":"POST /orders only","tradeoff":"Protects the Postgres hot spot, zero risk to cheap reads, but runaway queries can still hammer the DB"},{"description":"POST limits tight, GET limits loose (e.g. 10x higher)","label":"Both endpoints","tradeoff":"Full protection, but doubles the limits to define and explain to integrators"},{"description":"One global bucket per customer","label":"Everything uniformly","tradeoff":"Simplest to reason about, but a GET script can starve POST quota"}],"question":"Should the limit apply to both POST and GET /orders, with GET allowed a much higher rate than POST?","recommended":1},{"brief":{"how":"Decides the counter key and whether the 401 flood path is rate-limited at all. If you want the IP fallback you also inherit NAT collisions (many customers behind one office IP).","what":"Key: x-customer-id, client IP, or both","where":"PLAN.md lists this as undecided. Fact from src/server.ts:7-8: x-customer-id is a plain client-asserted header with no token check, and requests without it already get 401. So the 40k-order script authenticated itself; IP is only a fallback for header-less junk."},"header":"Limit key","id":"key","options":[{"description":"Current behavior already uses it; IP/spec appeals get manually reviewed","label":"Yes, customer ID only","tradeoff":"Simple and matches who you can actually bill/talk to; the header-less flood path stays unthrottled"},{"description":"Counters keyed x-customer-id + client IP","label":"Customer ID, downgraded to IP when header is missing/invalid","tradeoff":"Handles the 401 flood path too, but shared NAT IPs can collide into one bucket"},{"description":"Two independent limits, both must pass","label":"Both always (AND)","tradeoff":"Strictest, but multiplies tooling: customers behind office NATs hit the IP limit as a shared pool"}],"question":"Should the limit key on x-customer-id only (the header the server already requires)?","recommended":0},{"brief":{"how":"In-memory under round-robin means each customer effectively gets 3x the configured limit and per-instance drift; Redis is the only shared truth on 3 instances. Reusing the session cluster couples the rate limiter's fail mode to another service's cache.","what":"Do we reuse the Redis 7 cluster that sessions already use, run a separate one, or keep counters in instance memory","where":"PLAN.md: 3 instances behind round-robin LB, Redis cluster already exists for sessions by another service."},"header":"Counter store","id":"store","options":[{"description":"Same cluster, keys prefixed rl: and timeouts enforced","label":"Yes, existing Redis, namespaced keys","tradeoff":"No new infra this week, but a rate-limit latency spike or hot key shares fate with the other service"},{"description":"Dedicated instance/namespace for rate limiting","label":"Yes, but a separate Redis","tradeoff":"Blast-radius isolation, but provisioning a new Redis this week is the long pole"},{"description":"Each of 3 instances counts independently; effective limit becomes 3x what you set under round-robin LB","label":"No - in-memory per instance","tradeoff":"Zero network latency and no Redis dependency, but the limit isn't actually a limit: under round-robin a script gets N x 3 requests"}],"question":"Do counters live in the existing Redis cluster (namespaced keys, no new infrastructure)?","recommended":0},{"brief":{"how":"Sets the failure coupling between Redis health and order availability. Shapes ops: either way you need an alert on degraded mode.","what":"When the counter store is unreachable, allow the request or reject it","where":"PLAN.md lists this undecided. If you picked in-memory in the previous step this is almost moot (answer anyway; it also covers Postgres being slow mid-request)."},"header":"Fail mode","id":"fail_mode","options":[{"description":"On Redis timeout/error, count locally as approximation or just allow","label":"Fail-open","tradeoff":"Availability preserved; a Redis outage re-opens the 40k-order flood exactly when you're firefighting it"},{"description":"Reject with 503 when the counter is unreachable","label":"Fail-closed","tradeoff":"Protection intact, but Redis blips now 5xx every order endpoint - worse blast radius than the problem being solved"},{"description":"Fail open, but log >N req/min per customer during degraded mode","label":"Fail-open + alert loudly on degradation","tradeoff":"Keeps orders flowing and still detects abuse during outages, but needs a log/alert sink"}],"question":"If Redis is unreachable, should requests pass through unfettered while an alert fires?","recommended":2},{"brief":{"how":"Bursty-but-legit traffic is exactly where fixed window's boundary effect (up to ~2x limit at window edges) and token bucket's burst credit differ. Choice also determines what Retry-After you can compute.","what":"Fixed window, sliding window, or token bucket","where":"PLAN.md undecided. Fact: ~20 enterprise customers legitimately burst, which is the whole reason this is delicate."},"header":"Algorithm","id":"algorithm","options":[{"description":"Redis INCR + EXPIRE, ~2 commands, well-understood","label":"Yes - fixed window","tradeoff":"Cheapest and easiest to reason about/retry against; boundary burst can admit roughly 2x limit at window edges"},{"description":"Accurate average, no edge burst","label":"Sliding window (approximate, two timestamps)","tradeoff":"Smooths the boundary problem, ~2x the Redis work and harder to explain Retry-After"},{"description":"Limits sustained rate AND burst; keeps the 'legit burst' behavior","label":"No - token bucket","tradeoff":"Best fit for scripted bursts, but needs Lua/atomic refill, more tuning knobs, and Retry-After is approximate"}],"question":"Do you reject fixed window and use a token bucket, to honor bursty-but-legit enterprise traffic while capping sustained rate?","recommended":2},{"brief":{"how":"Ownership decides whether raising a limit is a deploy, a config change, or an email to another team. Numbers decide who breaks on launch day.","what":"Who owns the limit numbers - engineering defaults, or per-customer contracts","where":"PLAN.md: 'who owns those numbers' is explicitly undecided; ~20 enterprise customers with scripted bursts."},"header":"Limit ownership","id":"limits","options":[{"description":"You or the team on-call owns the current numbers; revisit after a month of data","label":"Yes - you set them from today's data, team owns them","tradeoff":"Fast, but none of the 20 enterprises were consulted before their scripts suddenly 429"},{"description":"Buckets become a contract; account management owns exceptions entirely","label":"Yes - but published as a documented contract","tradeoff":"Predictable for integrators and frees you from ad-hoc approvals; changes become a process, not a deploy"},{"description":"Enterprise numbers set per-customer through account management","label":"No - engineering owns infrastructure defaults, accounts owns per-customer overrides","tradeoff":"Right incentive split, but you need an escalation path defined before launch"}],"question":"Should engineering own the default limits while account management owns per-customer enterprise overrides?","recommended":2},{"brief":{"how":"Decides who can change a limit at what speed and whether support/engineering need each other.","what":"Mechanism for higher enterprise limits: hardcoded tiers, config file, DB rows, or Redis keys","where":"PLAN.md: 'How enterprise customers get higher limits' undecided; default tier(s) will be decided in the next round once this mechanism exists."},"header":"Enterprise elevation","id":"elevation","options":[{"description":"Per-customer limits from a Postgres table or config file, cached in-process","label":"Runtime config (DB row or config file)","tradeoff":"No code deploys to raise a limit; adds one lookup per request (cacheable)"},{"description":"Serve limits from Redis keys; support sets them","label":"Limits in Redis keys","tradeoff":"Instant take-effect with zero deploys, but now the config channel is the same store you fail over on"},{"description":"Shipped as code constants; PR to change","label":"Hardcoded tiers, PR to change","tradeoff":"Zero extra machinery this week, but every enterprise exception is a deploy and a review"}],"question":"Should per-customer limits be runtime configuration (Postgres row or config file), so raising one is not a code deploy?","recommended":0},{"brief":{"how":"429 + Retry-After is the standard scripts and HTTP libraries already honor; 503 gets conflated with server outage by retry logic.","what":"What a rejected client sees: status code, headers, body shape","where":"PLAN.md undecided. src/server.ts currently returns plain-text responses for 401/404, so there is no existing error-body convention to preserve."},"header":"Rejection shape","id":"response","options":[{"description":"Industry-standard; scripted integrators already handle it","label":"429 + Retry-After header + machine-readable body","tradeoff":"A few lines of extra code; old naive scripts may just retry immediately in a tight loop - they need exponential backoff guidance in docs"},{"description":"Body only; simplest","label":"429 with body, no headers","tradeoff":"Minimal, but scripts can't back off intelligently and will poll"},{"description":"Match reads like a bug report","label":"503 instead of 429","tradeoff":"Some frameworks auto-retry 503; misleading semantics"}],"question":"Should a rejected request return 429 with a Retry-After header and a machine-readable body?","recommended":0},{"brief":{"how":"Shadow mode turns wrong limit guesses into log lines instead of broken customer scripts; the cost is a week of delay.","what":"Rollout strategy: shadow (log-only) first, gradual enforcement, or hard enable with exceptions","where":"PLAN.md lists rollout as undecided, and the plan ships this week. 20 enterprise integrators were not consulted (they learn about it when they hit a 429)."},"header":"Rollout","id":"rollout","options":[{"description":"Ship counting first, review the log for violators, then flip enforcement","label":"Yes - shadow mode (log-only) for a week, then enforce","tradeoff":"No integrator breaks; delays enforcement by a week (you said ship this week - counting ships, blocking waits)"},{"description":"Mispredicted burst profiles cause 429s in production scripts with minutes of warning","label":"No - enforce immediately with per-customer exceptions for top talkers","tradeoff":"Fastest to real protection; any limit you guessed wrong breaks that customer's script today"},{"description":"Sample of traffic pays the cost of your tuning","label":"No - enforce on ~5% of requests for the first days","tradeoff":"Limits breakage risk, but sampling itself breaks per-customer burst expectations and is confusing to debug"}],"question":"Should we ship in shadow mode first (count and log only), then flip enforcement after the log confirms who exceeds the limits?","recommended":0}]}
```

### ask result

```text
User answers:
scope: (cancelled)
key: (cancelled)
store: (cancelled)
fail_mode: (cancelled)
algorithm: (cancelled)
limits: (cancelled)
elevation: (cancelled)
response: (cancelled)
rollout: (cancelled)
```

