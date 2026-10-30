## Person: `/skill:grilling I want to ship PLAN.md this week. Poke holes in it.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
User wants me to grill them about their PLAN.md. I need to first read the skill directory and the PLAN.md file to understand what we're dealing with. Then ask frontier questions via the `ask` tool.

Let me start by reading the skill directory and PLAN.md.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I read the skill directory (just SKILL.md) and PLAN.md. Now I need to read SKILL.md to follow the grilling instructions precisely.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I have the plan and the skill instructions. I need to ask the first round of frontier questions via the `ask` tool. The skill says the format in chat should show questions with recommended answers, but since I must use the `ask` tool, I need to map that format to the tool's JSON schema.

The frontier questions should be independent of each other. From PLAN.md, the undecided items are:
1. What to key the limit on: x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, or token bucket
3. Where counters live: Redis, or in each instance's memory
4. What happens if counter store unreachable: let through or reject
5. How enterprise customers get higher limits, and who owns those numbers
6. What a rejected client sees
7. How to roll out without breaking enterprise integrations

But wait - some of these depend on others. For example, what happens if Redis is unreachable depends on whether Redis is chosen. Where counters live depends on whether we need cross-instance coordination (which we do, since there are 3 instances). So I should choose the independent ones for the first round.

Actually, looking at the plan: we have 3 instances behind a load balancer. So in-memory counters would mean each instance tracks independently, allowing 3x the intended rate. That seems like a strong reason to use Redis. But the user lists it as "not decided yet", so it's a frontier question.

Wait, is it truly independent? The question of "what happens if counter store is unreachable" depends on choosing Redis. So I should NOT ask that in round 1. I should ask it in round 2 after we know where counters live.

Similarly, "how enterprise customers get higher limits" is somewhat independent but might depend on the keying strategy. Actually it's mostly independent.

Let me identify the true frontier (independent):
- Q1: Key the limit on x-customer-id (recommended), vs IP, vs both
- Q2: Algorithm: token bucket (recommended) vs fixed window vs sliding window
- Q3: Counters live in Redis (recommended) vs in-memory
- Q4: Enterprise higher limits: per-customer config in Redis/dataset owned by support/accounting (recommended), vs uniform tier, vs code-level whitelist
- Q5: Rejected client sees 429 Too Many Requests with Retry-After header and JSON error body (recommended)
- Q6: Rollout: dark-launch/log-only mode, then enforce per-customer with enterprise pre-notification (recommended)

Actually, Q6 depends on Q4 (enterprise customers need higher limits defined first)? Not strictly - we can have a rollout plan that accommodates "enterprise customers need different limits" without knowing the exact mechanism.

But Q4 and Q5 are independent. Q1-Q3 are independent. Q6 is somewhat independent but might be better after Q1-Q5.

Let me think about the design tree:
- Root: Add rate limiting to POST /orders
  - Branch 1: Key selection (customer-id, IP, both)
  - Branch 2: Algorithm (fixed, sliding, token bucket)
  - Branch 3: Storage (Redis, in-memory)
    - Branch 3a: If Redis: failure mode (fail-open, fail-closed)
  - Branch 4: Enterprise limits (how and who owns)
  - Branch 5: Rejection response
  - Branch 6: Rollout strategy

The frontier in round 1: Q1, Q2, Q3, Q4, Q5. Q3a waits for Q3. Q6 could be asked now but it might depend on Q4.

Actually, I'll ask Q1-Q5 in round 1, and Q6 can be in round 1 too since rollout doesn't strictly depend on the mechanism. But let me think - rollout strategy might depend on whether we have a log-only mode, which depends on the implementation. The user probably needs to decide.

Wait, the plan already says "ship it this week" - that's a timeline constraint. I should ask about that too. Is this week realistic given the undecided items and testing? That's a good grilling question.

Also, the plan mentions 40,000 orders in 10 minutes by one customer. That's ~66 orders/second. With 3 instances and in-memory counters, that customer could still do 3x the intended limit. Good point.

Also, "slowed every other customer down" - is the goal to prevent all slowdowns or just extreme abuse? Rate limiting prevents overload but may not prevent legitimate high load.

Also, GET /orders is cheap - should it be limited at all? Maybe at a much higher limit or not at all.

Let me formulate the frontier questions. I need to use the `ask` tool. The format in my reply should be like the skill shows, but the skill says any question MUST go through the `ask` tool. So I'll use `ask` with the JSON, and I can also output the formatted questions in my text? Wait, the instruction says "NEVER write such questions in your reply". So I should just say "Here is round 1" and use ask. But the ask tool result will show the questions. Actually, I should probably not include the formatted questions in my reply text since the tool will display them.

Actually, looking at the skill format: it wants me to format the round like that. But the critical instruction says questions must go through ask tool. I think the intended workflow is: I call ask, and then after getting answers, I continue. I can include a brief intro like "Round 1:" and then the ask tool handles it.

Let me construct the ask JSON carefully. Each question needs:
- id
- question (the actual question text)
- header (short tab label)
- brief (where, what, how)
- options (2-5)
- recommended (index)

For Q1:
- header: "Rate-limit key"
- question: "Should we key the POST /orders rate limit on x-customer-id rather than client IP or both?"
- brief where: "PLAN.md line 14 lists three keying options; 20 enterprise customers script integrations and the incident was one customer id creating 40k orders."
- brief what: "Pick the identifier that identifies the paying customer and works behind the load balancer; IP is shared/NAT-prone and both adds complexity."
- brief how: "This decides middleware lookup logic and whether enterprise limits attach to customer id or IP ranges."
- options:
  1. label: "x-customer-id only", tradeoff: "Correctly attributes abuse and legitimate burst to the paying account; fails if a customer rotates keys or omits header."
  2. label: "client IP only", tradeoff: "Simple to implement; breaks behind NAT/shared egress and lets a customer bypass by adding IPs."
  3. label: "both, with separate limits", tradeoff: "Most precise; more state, harder to explain, and not needed if x-customer-id is always present."
- recommended: 0

For Q2:
- header: "Algorithm"
- question: "Should we use a token bucket instead of fixed or sliding window?"
- brief where: "PLAN.md line 15 lists three algorithms; enterprise scripts legitimately burst."
- brief what: "Token bucket allows bursts up to a bucket size while capping average rate; fixed window can spike at window boundaries; sliding window is more accurate but more Redis ops."
- brief how: "This determines counter update logic, Redis data structures, and how customers experience throttling."
- options:
  1. label: "Token bucket", tradeoff: "Bursts tolerated, steady rate capped, few Redis ops; slight burst at start of idle period."
  2. label: "Sliding window", tradeoff: "Smoothest enforcement; more Redis round-trips and code complexity."
  3. label: "Fixed window", tradeoff: "Simplest; allows 2x spike at window edges and punishes burst customers unfairly."
- recommended: 0

For Q3:
- header: "Counter storage"
- question: "Should counters live in Redis rather than per-instance memory?"
- brief where: "PLAN.md line 16; you have 3 instances behind round-robin LB and an existing Redis 7 cluster."
- brief what: "In-memory counters let each instance enforce its own limit, so a customer gets 3x the intended budget under round-robin; Redis gives consistent cluster-wide enforcement."
- brief how: "Storage choice determines failure-mode question next, plus whether middleware needs Redis client."
- options:
  1. label: "Redis cluster", tradeoff: "Consistent limits across instances; adds latency and a dependency with a failure mode to decide."
  2. label: "In-memory per instance", tradeoff: "No extra dependency; rate limit is effectively 3x and customers see different limits depending on which instance they hit."
- recommended: 0

For Q4:
- header: "Enterprise limits"
- question: "Should higher limits for enterprise customers be a per-customer config stored in Redis (or similar) and owned by account management?"
- brief where: "PLAN.md line 18; about 20 enterprise customers have scripted integrations that legitimately burst."
- brief what: "We need a way to give some customers higher limits without hard-coding them; who owns the numbers affects rollout and support."
- brief how: "This decides data model, UI/API for limits, and which team updates them."
- options:
  1. label: "Per-customer config owned by account management/support", tradeoff: "Flexible and auditable; requires a small admin UI or config file and an owner."
  2. label: "Tiered defaults in code (e.g., enterprise vs standard)", tradeoff: "Simple to ship; every customer in a tier gets the same limit, no self-service adjustment."
  3. label: "Hard-coded whitelist", tradeoff: "Fastest this week; becomes technical debt and needs a deploy to change."
- recommended: 0

For Q5:
- header: "Rejection response"
- question: "Should rejected clients get HTTP 429 Too Many Requests with a Retry-After header and a JSON error body?"
- brief where: "PLAN.md line 19; scripted integrations need to know how to back off."
- brief what: "429 + Retry-After is the standard; scripts can parse it and sleep. Other choices break existing clients or hide the reason."
- brief how: "This is the customer-facing contract; changing it later is an API change."
- options:
  1. label: "429 with Retry-After and JSON body", tradeoff: "Standard, machine-readable, easy to document; needs a small response helper."
  2. label: "429 with no Retry-After", tradeoff: "Tells client they're throttled but leaves backoff guesswork; common but unfriendly."
  3. label: "503 Service Unavailable", tradeoff: "Wrong semantics; clients may treat it as server outage rather than rate limit."
  4. label: "200 OK with throttled flag in body", tradeoff: "Does not break naive clients but violates HTTP and confuses monitoring."
- recommended: 0

For Q6 (rollout): This is a bit dependent on having answers to above. But I think I can ask it as a frontier question because the answer doesn't require knowing the specific algorithm. However, rollout plan might need to mention "start with enterprise customers configured with higher limits" which depends on Q4. So maybe I should defer Q6 to round 2. But actually, I can ask a high-level rollout question.

Also, I should add a question about timeline/feasibility given "this week". That's an important grilling point. Is the plan realistic?

Q7:
- header: "This-week deadline"
- question: "Is 'ship this week' realistic, or should we split it into a dark-launch/config milestone this week and enforcement next week?"
- brief where: "PLAN.md says 'ship it this week'; 7 decisions are still listed as not decided yet."
- brief what: "Shipping enforcement this week risks mis-throttling enterprise customers if limits and rollout are not validated; a two-step milestone reduces blast radius."
- brief how: "This decides schedule and what 'done' means for the week."
- options:
  1. label: "Dark-launch/config this week, enforce next week", tradeoff: "Safer; we validate counters and enterprise limits without rejecting real traffic."
  2. label: "Ship enforcement this week", tradeoff: "Meets stated deadline; requires all decisions + tests + enterprise communication in days."
- recommended: 0

Hmm, but is this a design-tree decision or just schedule? It's relevant to grilling. The user said "Poke holes in it" and "ship PLAN.md this week". The deadline is a hole if unrealistic. I'll include it.

What about GET /orders? The plan says it's cheap. Should it be rate limited too? Maybe not at the same strictness. But it's not listed as undecided. The user might want to limit scope. I could ask but it's not in the "Not decided yet" list. I'll save it for later if needed.

What about the exact rate limit values? That's a major hole. The plan never says what the default limit should be. We need a number. This is independent and should be in round 1.

Q8:
- header: "Default limit value"
- question: "Should the default per-customer limit be set to a concrete number, such as 100 POST /orders per minute, based on current peak legitimate traffic?"
- brief where: "PLAN.md never states a default limit; without a number the middleware cannot be configured."
- brief what: "The 40k-in-10-min incident is ~67 req/s; legitimate enterprise bursts need headroom. We need a default before enforcement."
- brief how: "This becomes the fallback config and the baseline for enterprise uplifts."
- options:
  1. label: "Set a data-driven default now (e.g., 100/min)", tradeoff: "Shippable; may need tuning after first week of metrics."
  2. label: "Derive from traffic analysis before deciding", tradeoff: "More accurate; may slip the one-week deadline."
  3. label: "Start with a very high default and lower it later", tradeoff: "Avoids false positives initially; may not stop the next abuse event."
- recommended: 0 (or 1?)

Actually, without data, recommending a specific number is risky. Better to recommend deriving from traffic analysis but note it might slip the deadline. Or recommend a conservative default. I think the question should be "Do you agree we need to pick a concrete default limit value before shipping?" with options. But the skill wants a recommended answer. I'll recommend deriving from data.

Wait, but "this week" is the constraint. If we need traffic analysis, we might not ship. So maybe the recommended answer is "set a conservative default now and tune later". That's pragmatic.

Actually, the question is about a decision the user must make. The recommended answer should be actionable. Let me phrase it as: "Should we define the default limit by measuring current peak customer traffic rather than guessing?"

Options:
1. Measure peak traffic and set limit at 2-5x peak (recommended) - most defensible
2. Set a conservative guess now (e.g., 120/min) and tune later - fast but risk of false positives/negatives
3. Leave it configurable with no default - not shippable

Recommended: 0

OK, so my round 1 frontier could be: Q1 key, Q2 algorithm, Q3 storage, Q4 enterprise limits, Q5 rejection response, Q7 timeline, Q8 default limit value. That's 7 questions. The ask tool can handle multiple questions in one call.

But wait, Q3's follow-up (failure mode if Redis unreachable) is a later-round question. Q6 rollout also might be later. Good.

Let me also consider: are any of these not truly independent? 
- Key (Q1) and enterprise limits (Q4): enterprise limits apply per customer, so if we key by IP, enterprise limits would need IP ranges. But the question about who owns the numbers is still independent.
- Algorithm (Q2) and storage (Q3): token bucket can be in memory or Redis. Independent.
- Default limit (Q8) and algorithm: the limit value is per-window or bucket fill rate. Independent.
- Timeline (Q7) and others: independent.

So 7 questions in round 1 is fine. Actually, that's a lot. The skill says "Ask the whole frontier in one round". So it's OK.

But I want to be careful not to overwhelm. The skill says "relentlessly" so it's fine.

Let me also check if there are environment facts I need. For example, I should look at src/server.ts to understand the codebase. The skill says finding facts is my job. So I should dispatch a sub-agent or read the file myself. Since src/server.ts is a static file, I can read it directly with read tool. But do I need it for round 1? The decisions in round 1 don't depend on code structure. However, the timeline question and rollout might. I should probably read src/server.ts in parallel. Actually, I already have the read tool. Let me read it. But the instructions say "When a frontier question needs a fact from the environment... dispatch a sub-agent... don't block on it". I can read it myself since it's a simple file read. The read tool is available. But the skill says "dispatch a sub-agent with a fresh context window" - maybe for more complex exploration. For a single file, read is fine. Actually, the skill instructions are within the skill file; they say "When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it". Hmm. But the tool policy says file reads should use read tool. I'll read src/server.ts directly since it's a prerequisite for later rounds, not a blocker for round 1.

Actually, I should read it now to inform my questions. Let me do that.
```

- tool `read` /tmp/askmore-grill/src/server.ts

### Model reasoning

```text
Good, I have context. The server uses Bun, already requires x-customer-id header. That makes keying by x-customer-id natural. Also, the server is simple; adding middleware is straightforward.

Now I need to formulate round 1 via the ask tool. I need to be careful to use the exact format and follow the skill. The ask tool schema requires:
- questions array
- each question has id, question, options, brief (with what, where, how), optional header, recommended

I will create 7 questions for round 1.

Wait, I should also check if there are other files that might matter, like package.json, existing tests, etc. But for round 1, the decisions are mostly product/infrastructure. I can explore more later if needed. The skill says don't block on facts. I'll proceed with round 1.

Actually, before asking, let me think if "who owns those numbers" is separate from "how enterprise customers get higher limits". The plan lumps them. I can ask as one question.

Also, I should consider: is the rate limit only for POST /orders or also GET? The plan says POST is expensive; GET is cheap. Not listed as undecided. I could ask but maybe it's scope creep. I'll leave it unless the user wants.

One more hole: the plan doesn't mention monitoring/alerting. How will we know if rate limiting is working or misfiring? That's a design decision but maybe not in scope. I can ask later.

Another hole: tests. How to test rate limiting without flakiness? Especially with Redis. Maybe later.

Another hole: the Redis cluster is used by another service. Do we need a separate connection? The plan says "we may use it". If we use the same cluster, we share fate. If we add a separate Redis, more infra. That's a frontier question. Actually, it depends on choosing Redis. So if Redis is chosen, we need to decide whether to reuse existing cluster or provision dedicated. I'll put that as a round 2 question.

Another hole: Lua scripts vs Redis commands for atomicity. Depends on algorithm and Redis. Round 2.

Another hole: customer communication. Rollout strategy. Round 2 or 3.

OK, round 1 will be the 7 questions I identified.

Wait, I want to ensure the recommended answers make sense as "yes" answers. The skill says "Word each question so 'yes' accepts your recommended answer." But in the ask tool, the options are multiple choice. I should phrase the question so the recommended option is the "yes" equivalent. For example: "Should we key the rate limit on x-customer-id?" with recommended "x-customer-id only". That works.

Actually, the ask tool returns `id: label` for choices. The user can pick one. So it's fine.

Let me construct the JSON. I'll use ids q1-q7.

I also need to include the brief.demo? Optional. I won't include demos unless helpful.

I should include evidence for some questions pointing to PLAN.md lines. The evidence field is an array of objects with path, start, end, note. Good.

Let me write the ask call.
```

### ask call

```json
{"questions":[{"id":"q1-key","question":"Should we key the POST /orders rate limit on `x-customer-id` only, rather than client IP or both?","options":[{"label":"x-customer-id only","tradeoff":"Correctly attributes both abuse and legitimate bursts to the paying account; assumes the header is always present (which src/server.ts already enforces).","description":"Use the existing required `x-customer-id` header as the rate-limit key."},{"label":"client IP only","tradeoff":"Simple to implement but breaks behind NAT/shared egress and lets a customer bypass by adding IPs.","description":"Rate-limit by `req.headers.get('x-forwarded-for')` or socket remoteAddress."},{"label":"both, with separate limits","tradeoff":"Most precise but more state, harder to explain, and unnecessary if every request already carries x-customer-id.","description":"Maintain two counters per customer and per IP."}],"brief":{"where":"PLAN.md line 14 lists three keying options. src/server.ts line 7 already requires `x-customer-id` and returns 401 if it is missing.","what":"The key determines which identity is throttled. The incident was one customer id creating 40,000 orders, and enterprise limits must attach to the account, not an IP.","how":"This decides middleware lookup logic and whether enterprise overrides are per-customer or per-IP-range.","evidence":[{"path":"PLAN.md","start":12,"end":14,"note":"Lists keying options but does not decide."},{"path":"src/server.ts","start":6,"end":8,"note":"Server already requires x-customer-id."}]},"header":"Rate-limit key","recommended":0},{"id":"q2-algorithm","question":"Should we use a token bucket algorithm instead of fixed or sliding window?","options":[{"label":"Token bucket","tradeoff":"Allows legitimate bursts up to a bucket size while capping average rate; fewer Redis operations than sliding window.","description":"Bucket per customer; each request removes a token, tokens refill at a fixed rate."},{"label":"Sliding window","tradeoff":"Smoothest enforcement but more Redis round-trips and more complex Lua/Redis logic.","description":"Track each request timestamp and count requests in the current window."},{"label":"Fixed window","tradeoff":"Simplest implementation but allows 2x spikes at window boundaries and can unfairly throttle legitimate bursts.","description":"Count requests in the current time bucket (e.g., current minute)."}],"brief":{"where":"PLAN.md line 15 lists three algorithms. About 20 enterprise customers legitimately burst.","what":"The algorithm determines how strictly the limit is enforced and how customers experience throttling.","how":"This decides the Redis data structure, the Lua script (if any), and the shape of the limit configuration.","evidence":[{"path":"PLAN.md","start":10,"end":15,"note":"Enterprise burst behavior makes algorithm choice important."}]},"header":"Algorithm","recommended":0},{"id":"q3-storage","question":"Should the rate-limit counters live in the Redis cluster rather than in each instance's memory?","options":[{"label":"Redis cluster","tradeoff":"Consistent cluster-wide enforcement across all three instances; adds latency and a dependency whose failure mode we must decide.","description":"Use the existing Redis 7 cluster for shared counters."},{"label":"In-memory per instance","tradeoff":"No extra dependency but the effective limit becomes 3x under round-robin and customers see different limits per instance.","description":"Each Bun instance keeps a local Map of counters."}],"brief":{"where":"PLAN.md lines 7 and 16: three instances behind a round-robin load balancer, counters may live in Redis or memory.","what":"Storage choice determines whether a customer can consume the full budget on every instance or is limited globally.","how":"If Redis is chosen, the next round must decide fail-open vs fail-closed and whether to reuse the session cluster.","evidence":[{"path":"PLAN.md","start":6,"end":8,"note":"Three instances behind round-robin LB."},{"path":"PLAN.md","start":15,"end":17,"note":"Counter storage undecided."}]},"header":"Counter storage","recommended":0},{"id":"q4-enterprise","question":"Should higher limits for enterprise customers be a per-customer config owned by account management or support?","options":[{"label":"Per-customer config owned by account management/support","tradeoff":"Flexible and auditable; requires a small admin surface (config file, DB table, or Redis key) and a clear owner.","description":"Each enterprise customer id maps to a custom limit value."},{"label":"Tiered defaults in code (e.g., enterprise vs standard)","tradeoff":"Simple to ship but every customer in a tier gets the same limit and changes need a deploy.","description":"Hard-code two or three tier constants."},{"label":"Hard-coded whitelist","tradeoff":"Fastest this week but becomes immediate technical debt and requires a deploy to change.","description":"Maintain a list of customer ids with elevated limits in source code."}],"brief":{"where":"PLAN.md line 18: how enterprise customers get higher limits and who owns those numbers is undecided.","what":"Twenty enterprise customers have scripted integrations that legitimately burst; they need higher limits, but the mechanism and owner are unclear.","how":"This decides the data model, who can change limits, and how rollout communicates with enterprise customers."},"header":"Enterprise limits","recommended":0},{"id":"q5-rejection","question":"Should rejected clients receive HTTP 429 Too Many Requests with a `Retry-After` header and a JSON error body?","options":[{"label":"429 with Retry-After and JSON body","tradeoff":"Standard, machine-readable, and easy to document; existing scripts can parse Retry-After and back off.","description":"Return `{ error: 'rate_limit_exceeded', retry_after: 42 }` with status 429."},{"label":"429 with no Retry-After","tradeoff":"Tells the client they are throttled but leaves backoff guesswork.","description":"Return status 429 with a plain text or JSON message."},{"label":"503 Service Unavailable","tradeoff":"Wrong semantics; clients may treat it as a server outage rather than a rate limit.","description":"Return status 503."},{"label":"200 OK with throttled flag in body","tradeoff":"Does not break naive clients but violates HTTP and confuses monitoring.","description":"Return status 200 with `{ throttled: true }`."}],"brief":{"where":"PLAN.md line 19: what a rejected client sees is undecided.","what":"The response is the customer-facing contract; changing it later is an API change and affects monitoring/alerting.","how":"This decides the response helper and what enterprise scripts must handle."},"header":"Rejection response","recommended":0},{"id":"q6-deadline","question":"Is shipping enforcement this week realistic, or should the milestone this week be dark-launch/config only and enforcement ship next week?","options":[{"label":"Dark-launch/config this week, enforce next week","tradeoff":"Safer: validate counters and enterprise limits without rejecting real traffic; respects that several design decisions are still open.","description":"Log what would have been throttled this week; flip the enforcement switch next week."},{"label":"Ship enforcement this week","tradeoff":"Meets the stated deadline but requires all decisions, tests, enterprise communication, and monitoring in a few days.","description":"Deploy the rate-limiting middleware in enforcing mode this week."}],"brief":{"where":"PLAN.md line 3 says 'ship it this week', and lines 12-20 list seven items still not decided.","what":"The plan has not settled key design choices, so a hard enforcement deadline risks mis-throttling enterprise customers or shipping a half-baked failure mode.","how":"This decides the schedule, the definition of 'done' for the week, and how much safety margin the rollout has."},"header":"This-week deadline","recommended":0},{"id":"q7-default","question":"Should we derive the default per-customer limit from current peak legitimate traffic rather than guessing a number?","options":[{"label":"Measure peak traffic and set limit at 2-5x the highest legitimate customer peak","tradeoff":"Most defensible default; may require a few hours of log analysis and could shift the deadline if data is hard to gather.","description":"Query recent logs for max POST /orders per minute per customer, then add headroom."},{"label":"Set a conservative default now (e.g., 120/min) and tune later","tradeoff":"Ships this week but risks false positives for burst customers or false negatives for abusers.","description":"Pick a reasonable-looking number and adjust after observing metrics."},{"label":"Leave it configurable with no production default","tradeoff":"Flexible but not shippable in enforcing mode; requires every customer to have a configured limit.","description":"Fail to start if no default limit is provided."}],"brief":{"where":"PLAN.md never states a default limit value. The incident was 40,000 orders in 10 minutes (~67 req/s).","what":"Without a default number the middleware cannot be configured, and enterprise uplifts need a baseline.","how":"This becomes the fallback config and the basis for enterprise higher limits."},"header":"Default limit value","recommended":0}]}
```

### ask result

```text
User answers:
q1-key: (cancelled)
q2-algorithm: (cancelled)
q3-storage: (cancelled)
q4-enterprise: (cancelled)
q5-rejection: (cancelled)
q6-deadline: (cancelled)
q7-default: (cancelled)
```

