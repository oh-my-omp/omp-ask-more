## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reply

I'll start by reading the plan and its surroundings.

- tool `read` PLAN.md

- tool `read` .

### Model reasoning

```text
Read the source files to ground facts.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Facts established:
- `x-customer-id` header is the only client identity; no auth beyond requiring the header. So keying on it is trivially spoofable — a script can rotate fake customer IDs to bypass limits. That's a real design fork: trust the header vs. verify identity.
- 3 instances → in-memory counters are per-instance, so effective limit is 3× nominal. That interacts with algorithm choice.
- Redis is shared with sessions; "may use it" — unclear whether separate logical DB / key prefix / pool.
- No config/infra files in repo; no load balancer config, no deployment manifests. So I can't know header forwarding. But client IP would come from `X-Forwarded-For` behind the LB — unverifiable fact, I can state the constraint without asking? The rule: finding facts is my job; but there are no files describing infra. There's nothing to dispatch a sub-agent at beyond these 3 files — I've read everything. So facts are exhausted; remaining unknowns are decisions plus environment facts the user holds (Redis ownership, LB behavior). The skill says don't ask the user for facts I could look up. I looked up everything available: repo has 3 source files, no config, no tests, no deploy manifests. Facts not in the environment (whether Redis is the same logical DB, whether the LB forwards real client IP, who owns enterprise limit numbers) are genuinely the user's — those are organizational facts only they hold, and they gate decisions. I'll fold them into decision questions rather than asking for raw facts.

Now build the design tree. Root decision (prerequisite for everything): what is the actual goal/guarantee — fairness protection vs. hard quota? Actually the deeper root: does the header count as identity at all? That determines keying, algorithm, storage, and error semantics. But the plan asks specific decisions. The tree:

Root: R1 — Protect the shared system (availability/fairness) *or* enforce per-customer quota (billing/contract)? This changes everything: quota needs accuracy and cross-instance consistency and hard rejects; protection needs cheap, fast, approximate, fail-open.

Then branch A (identity/keying) depends on R1? Partly. Keying question is largely independent: x-customer-id vs IP vs both. But depends on whether we trust header → depends on whether there's an auth layer. That's a fact-finding thing not in repo. Actually the code shows no auth: header is trusted for data scoping already (createOrder uses it as owner). So even without rate limiting, anyone can write orders to any customer ID. That means the header is already trusted for tenancy — adding rate limiting keyed on it is no worse. That's an important evidence point and lets me recommend confidently.

Round 1 frontier (independent of each other):
Q1 — Goal/guarantee: fairness protection vs contractual quota. (root)
Q2 — Keying: customer-id vs IP vs both. Independent of Q1 practically? If goal is quota → must be customer id. Hmm, that makes Q2 depend on Q1. Skill says questions depending on an open question go to a later round. So I should ask Q1 alone? That's a thin round but correct per tree discipline. But I can also ask questions that are genuinely independent of Q1:

- Q: Algorithm choice — does it depend on Q1? Fixed window vs sliding vs token bucket: token bucket permits bursts (relevant since 20 enterprise customers legitimately burst), and burst tolerance is needed regardless of goal. Algorithm choice depends on whether burstiness tolerance is a requirement — which is itself a decision. Actually "enterprise burst" fact is given, so token bucket is nearly forced. But the burst allowance *shape* (per-second refill vs per-minute) depends on limits, which depends on goal. Hmm. I could ask algorithm now: it's arguably independent enough. But the cleanest tree: Round 1 asks the root (goal) plus the things that only depend on facts already known.

Independent-of-goal decisions with known facts:
- Storage: Redis vs in-memory. Depends on accuracy requirement (goal) though. In-memory with 3 instances = 3× limit and no cross-instance fairness. If goal is fairness, in-memory is defensible if per-instance limit is divided by 3? No — round-robin means it approximates. Honestly storage depends on whether we need exactness → depends on Q1.
- Fail-open vs fail-closed: depends on goal (quota → fail-closed? no, quota billing wouldn't fail closed either... it depends on whether rejecting legit traffic is worse than overload). Fairly independent actually: recommendation fail-open with local per-instance fallback limiter. Depends on Q1 partially.
- Rejection response shape: independent of nearly everything — 429, Retry-After, error body, headers. Can ask now.
- Rollout: independent-ish — shadow mode first, then enforce. Depends on whether we can measure first (need metrics). Can ask now.
- Enterprise tiers ownership: depends on goal (who owns numbers) — partly independent: mechanism (config table vs env vs Redis keys) vs ownership (a person/team). Could ask now as "mechanism + storage of overrides", but the numbers depend on goal. The mechanism depends on storage decision. So later.

Per skill: "A question whose answer depends on another question still open in this round belongs to a later round." Strictly, Q2 (keying) depends on Q1 (goal). So round 1 = Q1 only? That would be maximally correct but a 1-question round. Hmm, ask format allows multiple questions; a round of one is fine if truly the only root. But is there more than one root? Let me consider the tree more carefully.

Actually the real root could be decomposed: the plan's 7 decisions all hang off two roots:
R1: What guarantee are we buying? (fairness/protection vs quota vs both)
R2: What is the budget for this work this week? ("ship this week") — scope/timebox is a genuine independent root: it decides whether we do Redis at all, whether we do shadow rollout, whether we build a tier admin path. That's independent of R1. Good — that's a legit second root question.

Also R3: Can we change the contract with clients (i.e., are the 20 enterprise integrations allowed to receive 429s at all)? That's part of rollout/breaking, depends on R1. Later.

So Round 1: Q1 (goal/guarantee), Q2 (scope/timebox + blast radius: is this the only place? do we also protect GET?). Hmm GET cheap — "protect POST only vs all routes" is a decision that depends on goal? Mostly independent: GET is cheap, but a scraper hammering GET still costs. It depends on R1 somewhat (quota would apply to all calls; protection might too). Put later.

Hmm, but is the timebox root real? It's a constraint, not a design decision, and asking it is legitimate: it determines how much of the tree is in scope this week vs later. It's a "decision the user owns". I'll ask it as round-1 Q2: scope of this week's ship — minimal POST limiter vs full tiered system. But that overlaps hard with Q1's answer... If Q1 = "fairness only", scope answer follows. Eh. Two roots: goal and deadline/scope. They're independent (you can have a quota goal with a minimal ship, or fairness goal with full tiering).

Let me also include a third genuinely independent question: the limits themselves — what numbers? No, depends on goal and on burst profile facts we don't have (no traffic data in repo — I can't look it up; and it's the user's business fact). Numbers depend on goal. Later round.

Another independent: does the rate limiter live in-process middleware in server.ts or as a separate gateway/LB layer? That's an architecture decision independent of goal... it depends on Redis decision. Hmm: middleware in process vs at the LB (nginx/envoy). But there's no LB config in repo; that's an environment fact I can't fetch. I'd recommend in-process since we only control server.ts and shipping this week. Depends on storage/scope → later round. Actually "where the enforcement point lives" is arguably a root: it gates storage, keying (IP availability), rollout. It's independent of the goal question. Yes — include as Q3.

So Round 1: Q1 goal, Q2 timebox/scope, Q3 enforcement point (app middleware in server.ts vs edge/LB). All three are roots; keying/algorithm/storage/fail-mode/response/tiers/rollout all hang off them.

Each with recommendation. Keep terse, evidence-grounded, numbered, with ➡️ recommendation, and wait.

Also I should note nothing about implementation. Use ask tool? The skill defines a specific text format for rounds with ❓/➡️. The ask tool is "the only way to put a decision to the user". Conflict: skill mandates text format and waiting. System says questions that need the user to choose go through ask. The skill is the user's explicit instruction for format. I'll use the text format as instructed (skill overrides default), since the user invoked it and asked for rounds. Hmm, but the tool policy is fairly hard: "anything that needs the user to choose ... goes through ask, never as a question in your reply." The skill instructs a format. Compromise: use ask with the questions, each brief, and... but then the ❓ numbering/➡️ recommendation format is lost, and ask requires 2-5 options with tradeoffs — actually compatible: each question has options = my recommended + alternatives. The skill format wants prose with multiple choices and a recommendation. I could do both? That'd duplicate content (violates "one form per idea").

Decision: honor the skill's explicit round format in text — the user explicitly invoked the skill and its instruction is to format rounds that way and wait. The ask tool is for decisions; but this session's whole purpose is a text interview. I'll follow the skill. Risk: system says never end turn on a question in text. Given explicit user instruction for an interview format, skill wins on format; I'll use text.

Hmm, tricky. The safest reading: skill defines the interview format (rounds), and ask is the mechanism for putting decisions. I can put the round's questions in `ask` while still numbering and recommending inside each question's body/brief... but the skill explicitly says "Format a round like so" with ❓/➡️. The user sees the skill output. I'll go with the skill's text format — explicit, specific, user-invoked, and the session is literally an interview. I'll keep it.

Actually — reconsider once more. The tool description is emphatic and it's in the system prompt layer (§ functions) plus Tool Policy. The skill is user-provided but labeled authoritative for the task. "When a skill, workflow or other instruction tells you to ask the user, confirm with them, or let them pick, do it with ask." This sentence directly resolves it: skill says ask → use ask. That's decisive. So: use `ask`, and mirror the numbering/recommendation in the question text/tradeoffs so the round format survives. I can put "Q1 — title" as header and the body inside `question`, options = the choices with `recommended` index. The ➡️ recommendation becomes `recommended` + tradeoff wording. That satisfies both: round semantics preserved, mechanism is ask.

I'll do that. Number in header, e.g. header "Q1 Goal". And in the `question` field describe choices. Provide brief with evidence: src/server.ts lines 5-13 (header trust, POST), PLAN.md lines 12-19.

Let me draft three questions.

Q1 — Guarantee: what is the thing we're buying?
Options:
a) Fairness/availability (protect shared Postgres + other customers), limits approximate, per-customer. recommended.
b) Contractual quota (enforce a purchased number, billable/auditable), exact counts.
c) Both, one mechanism.
Holds_when: if no contract currently states a request rate, fairness is the only honest goal this week.
Tradeoff: fairness → cheap, approximate, no customer-visible commitments; quota → needs exact cross-instance accounting, customer comms, dispute handling.

Q2 — Timebox/scope: how much ships this week?
Options:
a) Minimal: one global-per-key limiter on POST /orders, static defaults, one knob, no per-customer tiers this week. recommended given "ship this week" + 20 enterprise burst accounts.
b) Full: tiers from day one, override API, dashboards.
c) Middle: limiter + per-customer override list in config/env, no API.
Hmm — but tiering is one of the seven unresolved items, and picking (a) means pushing tiers to a follow-up, which the plan says "Not decided yet" for enterprise. Better: make Q2 about the ship shape: shadow-then-enforce vs enforce immediately — no, that's rollout, depends on Q1? Rollout is fairly independent, but it's item 7 and depends on whether we can measure (metrics exist? no metrics in repo — fact: no logging/metrics code at all in server.ts). That's a fact I found: no observability hooks. That constrains shadow mode: we'd have to add logging.

Let me restructure a clean tree:

Roots (round 1):
- Q1 Goal: fairness vs quota vs both. (gates keying, numbers, fail mode, storage accuracy)
- Q2 Deadline/scope: what must be true Friday — is a shim that only limits POST acceptable, or must enterprise tiers be included? (gates tiers, rollout complexity, admin surface) — actually this overlaps Q1. Alternative independent root: enforcement point.
- Q3 Enforcement point: in-process middleware in src/server.ts vs shared edge (LB/nginx) vs separate sidecar. Independent of goal. Gates IP availability (for keying), storage, rollout, per-instance multiplier problem.

I'll use those three. Then round 2: keying, algorithm, storage(if not settled by Q3), fail mode, response shape, tiers mechanism, rollout/measurement.

Hmm, but Q3's answer might make Q1/Q2 partially moot? No.

Also worth flagging an evidence-based landmine now: the header is unauthenticated, and no client IP is available without LB cooperation — so "key by IP" is likely impossible this week regardless. But that's an inference from facts; I should state it as part of Q1/Q3 briefs rather than ask.

One more root candidate: "Do we want to reject or slow down?" (429 vs delay vs queue). That's response semantics, depends on goal? It's semi-independent but let's leave for round 2.

Also "who owns the enterprise numbers" is organizational — depends on tiers mechanism/goal. Round 2/3.

Now write briefs with `where/what/how`, evidence references:
- src/server.ts:5-13 — header-only identity, POST path.
- src/orders.ts:10-14 — createOrder writes one row per request.
- PLAN.md:1-19.
- src/db.ts:6-12 — no metrics/pooling config.

Let me write three questions in one ask call, with recommended indices.

Q1 options:
1. "Fairness first (recommended)" — label must be short: "Protect shared capacity". tradeoff: "Cheap and honest this week; no customer-facing number to defend, and you'll need a second pass if anyone ever sells a rate." recommended.
2. "Enforce contracted quotas" — tradeoff: "Exact, billable, auditable; needs exact cross-instance counting, customer comms, and dispute handling before Friday."
3. "One mechanism, both readings" — tradeoff: "Same counter serves fairness and quota; you must pick exactness now, which forces Redis and per-instance config discipline."
4. "Escalate to abuse handling, no limits" — tradeoff: "No engineering, human process; leaves the 10-minute blast radius open and doesn't scale past one known script." (maybe good option)

Q2 (enforcement point):
1. "In-process in src/server.ts" recommended — tradeoff "Only place you control this week, sees x-customer-id directly; 3 instances mean 3× the limit unless counters are shared."
2. "At the load balancer" — tradeoff "One place to count, real client IP visible; you don't own the LB config here and per-customer rules become ops work."
3. "Separate sidecar/gateway process" — tradeoff "Decoupled deploy and shared state; a new service to run, monitor and secure this week."
4. "In-process now, extendable to edge later" — tradeoff "same as 1 plus interface abstraction; slight extra structure, no second convention later." Hmm duplicate-ish with 1. Maybe use 3 options + one "defer to library" option: "Use an off-the-shelf middleware" — tradeoff: "Less code to own; you still choose storage/keying, and most libraries default to per-instance counters."

Q3 (timebox / what ships Friday):
1. "Limiter on POST /orders only, static default, no tiers" — tradeoff "Stops the 10-minute blast and ships; enterprise bursters at the default get 429s on day one unless the default is generous."
2. "POST + GET, all routes" — tradeoff "Covers scrapers reading data; doubles the surface and risks breaking dashboards that poll."
3. "Limiter + per-customer overrides in config, no admin API" — tradeoff "Enterprise safe on day one, edits need a deploy; more moving parts than a single default."
4. "Observability only this week (count, alert, no reject)" — tradeoff "Zero breakage and real numbers for limits; the incident repeats for another week."

Recommended: 3? For "ship this week" with 20 bursting enterprise customers, static default risks breaking them. I'd recommend option 3 (limiter + override list) — but that adds config plumbing. Hmm, the honest recommendation: enforce on POST with a generous default and an override map loaded from env/config. That is option 3. Yes recommend 3, and note Q1's answer may change it.

Wait — Q3's answer depends on Q1? If Q1 = quota, tiers are mandatory. So Q3's option 3 vs 1 is somewhat dependent, but the question is "what ships Friday" with concrete options; it's still a decision the user owns independent of guarantee framing. Hmm, strict tree discipline says dependent → later. But the skill also allows rounds to be broadly independent. I'd rather keep round 1 to two truly root questions (goal, enforcement point) and put scope-with-tiers in round 2 since tier necessity derives from Q1. Yet the "ship this week" scope is itself a root constraint...

I'll include Q3 but frame it as "smallest ship that is safe for the 20 bursters" — that's genuinely independent of goal: even under quota, you need a safe default. Fine, keep 3 questions.

Actually, keep it tight and correct: I'll go with 3 questions, and say in prose what round 2 waits on.

Let me write it. Keep briefs concise but substantive.
```

### Model reply

Facts from the repo first, because they change the shape of the tree: `x-customer-id` is the only identity in the system (`src/server.ts:7`), it is never authenticated, and it is already the tenancy boundary for writes (`src/orders.ts:12`). There is no logging, metrics or middleware layer anywhere in `src/`, so "measure before enforcing" is itself work. And nothing in the repo describes the load balancer, so client-IP keying is not observable from here.

### ask call

```json
{"questions":[{"id":"q1","header":"Q1 Goal","question":"What guarantee is the limiter buying?\n\n(a) Fairness — protect shared Postgres and other customers from one noisy script. Counts may be approximate; nothing is promised to a customer.\n(b) Contracted quota — each customer has a purchased number that must be counted exactly, defensible in a dispute, and possibly billable.\n(c) Both, through one mechanism.\n(d) Neither: this is an abuse problem, handle the one script out of band.\n\nThe choice is not cosmetic. (a) tolerates per-instance counting and sloppy refills. (b) forces exact cross-instance accounting, customer communication and a dispute path before Friday. (c) forces (b)'s exactness now.","options":[{"label":"Fairness first","description":"Protect shared capacity; counts approximate; no customer-facing number","tradeoff":"Cheap, shippable this week, honest about what you can measure; you owe a second pass if anyone ever sells a rate","holds_when":"No contract today states a request rate for these 20 integrations","cost":"One limiter, one default number, no per-customer admin surface"},{"label":"Enforce contracted quotas","description":"Exact per-customer numbers, auditable","tradeoff":"Exact, billable, defendable; demands exact cross-instance counting and customer comms before Friday","holds_when":"Sales already quoted rate numbers to customers","cost":"Redis-backed exact counters, tier table, dispute/debug tooling, comms to 20 accounts"},{"label":"One mechanism, both readings","description":"Same counter serves fairness and quota","tradeoff":"One code path forever; you must adopt quota-grade exactness now, including where overrides live and who edits them","holds_when":"You expect to sell rates within a quarter","cost":"Redis + tier ownership + admin path, all this week"},{"label":"Abuse handling only","description":"No code; contact the customer and block the script","tradeoff":"Zero engineering risk; leaves the ten-minute blast radius open for the next script and does not scale past the one you already know","holds_when":"The incident came from a single known account","cost":"None in code; ongoing human response"}],"brief":{"where":"PLAN.md line 3 describes 40,000 orders in ten minutes slowing every customer. src/server.ts:10-13 handles POST /orders by calling createOrder, which does one Postgres insert per request (src/orders.ts:10-14). There is no rate limiting, no metrics and no auth layer in src/.","what":"The plan lists seven undecided items but never states what the limiter must guarantee. Every other item — keying, algorithm, storage, fail mode, tiers, response, rollout — derives from this one: approximate fairness and exact quota lead to different storage, different error semantics and different customer obligations.","how":"Pick fairness and round two asks about keying, algorithm, fail mode and response shape, with per-instance counting on the table. Pick quota and round two starts with exactness and override ownership instead. Pick both and exactness is settled now; the tier ownership question moves up a round.","evidence":[{"path":"PLAN.md","lines":"1-19","note":"The seven open items, and the incident that motivated them"},{"path":"src/server.ts","lines":"5-13","note":"Single identity source, single expensive route"},{"path":"src/orders.ts","lines":"10-14","note":"One Postgres insert per accepted request"}],"risks":["Choosing quota without a support process turns rate limiting into a customer-relations incident","Choosing fairness and later selling rates means retrofitting exactness into an approximate counter"]},"recommended":0},{"id":"q2","header":"Q2 Where","question":"Where does the limiter run?\n\n(a) In-process inside src/server.ts, before the route branch.\n(b) At the load balancer / edge, which you do not control from this repo.\n(c) A separate sidecar or gateway process you deploy alongside the three instances.\n(d) An off-the-shelf middleware library mounted in-process.\n\nThis gates two things you cannot decide later: whether a real client IP is even visible (the edge can see it, the app sees only what the edge forwards, and nothing in this repo documents the edge), and whether three instances share one counter or hold three.","options":[{"label":"In-process in server.ts","description":"A limiter call before the POST branch","tradeoff":"The one surface you control and can ship this week, and it reads x-customer-id directly; three instances mean three counters, so the effective limit is up to 3x nominal","holds_when":"Correctness of the exact count matters less than shipping","cost":"~50 lines plus Redis or a shared-nothing fallback"},{"label":"At the load balancer","description":"Edge rules, e.g. nginx or an API gateway","tradeoff":"One counter and a real client IP; the config lives outside this repo, so you need another team and per-customer rules become ops tickets","holds_when":"The edge is managed by you and accepts deploy-per-number changes","cost":"Config outside the repo, coordination, no unit-testable path"},{"label":"Sidecar or gateway process","description":"New process next to the app","tradeoff":"Language-agnostic, one counter, independent deploys; a new service to run, monitor and secure before Friday","holds_when":"You already run sidecars in this deployment","cost":"New service, health checks, another failure mode in the request path"},{"label":"Off-the-shelf middleware","description":"An existing limiter package mounted in-process","tradeoff":"Less code to own and review; you still choose keying and storage, and most packages default to in-memory counters, quietly giving you the 3x problem","holds_when":"A vetted package supports your chosen store","cost":"Dependency review plus the same storage decision"}],"brief":{"where":"PLAN.md line 7 says three instances behind a round-robin load balancer. src/server.ts is a single Bun.serve handler with no middleware layer, and the repo contains no balancer, container or deploy configuration.","what":"You can only enforce where you can deploy. In-process is the only surface visible in this repo, but it multiplies the limit by the instance count unless the counter is shared. The edge sees the true client IP; the app sees only forwarded headers of unknown shape, since nothing here documents the balancer.","how":"In-process makes round two's storage question the load-bearing one and rules out IP keying unless the balancer is proven to forward a trustworthy header. Edge or sidecar settles shared counting but moves tier changes into another team's release process. Middleware keeps the in-process shape and inherits its storage decision.","evidence":[{"path":"src/server.ts","lines":"3-19","note":"One handler, no middleware chain, no proxy or IP handling"},{"path":"PLAN.md","lines":"5-10","note":"Three instances, round-robin, existing Redis, one expensive route"}],"risks":["Keying on client IP when the balancer overwrites or omits the forwarded header silently buckets every customer together","Per-instance counters under round-robin make a nominal limit of N behave as 3N, which only shows up in production"]},"recommended":0},{"id":"q3","header":"Q3 Friday","question":"What must be true when this ships, given the 20 integrations that legitimately burst?\n\n(a) One generous static default applies to everyone; a burster that exceeds it gets rejected, and you deal with that customer individually.\n(b) One static default plus a per-customer override list you edit in config and redeploy.\n(c) Enforcement reaches every enterprise customer only after you have observed their real traffic for a few days, so nothing is rejected at first.\n(d) Nothing rejects this week; you only count and alert.\n\nThis is separable from Q1: even under a pure fairness goal the default has to be safe for the twenty accounts you know burst, and this repo has no metrics to tell you what they burst to.","options":[{"label":"Override list in config","description":"Generous default, per-customer exceptions, redeploy to change","tradeoff":"The twenty bursters are safe on day one without an admin surface; every exception is a deploy, and the file becomes a shadow tier system","holds_when":"You can name the twenty accounts now","cost":"Config loading plus a keyed exception map"},{"label":"One static default","description":"No exceptions","tradeoff":"Smallest possible change; someone in the twenty gets 429s on day one and you find out from support","holds_when":"The default can be set above every legitimate burst","cost":"A single number and its configuration"},{"label":"Observe first, enforce after","description":"Count and log now, reject once numbers are real","tradeoff":"Zero chance of breaking a paying integration and limits founded on measurements; the blast radius stays open for several more days","holds_when":"You can tolerate another incident while observing","cost":"Logging and an aggregation path, plus a second change to turn enforcement on"},{"label":"Count and alert only","description":"No rejection at all this week","tradeoff":"No request-path behaviour changes at all; the original incident can repeat unchanged","holds_when":"The incident was a one-off and you mainly need a signal","cost":"Logging and alerting only"}],"brief":{"where":"PLAN.md line 10 says about 20 enterprise customers have scripted integrations that legitimately burst, and line 3 gives the scale of the bad actor at 40,000 orders in ten minutes. There is no logging in src/server.ts, so no record of what customer traffic looks like today exists.","what":"Two of the plan's open items collapse into this: how enterprise customers get higher limits, and how to roll out without breaking them. The app has no observability, so an enforcement number chosen now is a guess about twenty accounts, and the guess is discovered by them hitting 429.","how":"Pick the override list and round two asks storage, keying and fail mode, with tiers as a config artefact. Pick observe-first and round two is about where observations are recorded and what turns enforcement on later. Pick count-only and keying, algorithm and response shape leave this week's scope entirely.","evidence":[{"path":"PLAN.md","lines":"10-19","note":"Twenty bursting integrations, and the rollout and tier items left open"},{"path":"src/server.ts","lines":"3-19","note":"No logging, metrics or configuration loading in the handler"}],"risks":["A hard default invented without traffic data breaks a paying integration within minutes of deploy","An override file with no owner drifts into undocumented per-customer contracts"]},"recommended":0}]}
```

### ask result

```text
User answers:
q1: Fairness first
q2: In-process in server.ts
q3: Override list in config
```

### Model reasoning

```text
Settled: fairness first, in-process, override list in config.

Now recompute frontier. Decisions unblocked:

1. Keying: x-customer-id vs IP vs both. Given (a) fairness, (b) in-process, (c) no LB docs → IP unavailable/untrustworthy. So recommend x-customer-id only, with a note about spoofability. Still a decision — ask.

2. Storage: Redis vs in-process memory. Given 3 instances in-process: memory gives 3× limit; Redis gives one counter but adds a network hop and a failure mode. Key prompt depends on #1? No, independent. Ask now. Sub-options: shared Redis counter, in-memory divided by 3, hybrid (Redis with in-memory fallback).

3. Algorithm: fixed window / sliding window / token bucket. Token bucket because bursts. Does this depend on storage? Partially (Redis sliding window needs sorted sets/lua; fixed window is INCR+EXPIRE). But algorithm choice is a requirement-level decision, independent enough. Ask now? It depends on burst tolerance which we know is needed. I'd ask now.

4. Response shape on rejection: status code, Retry-After, body, headers. Independent of everything above. Ask now.

5. Fail mode when store unreachable: depends on storage choice (Q below). If in-memory, no store to fail. So this depends on the storage answer → later round. Good example of tree discipline.

6. Rollout: depends on q3 answer (override list, enforce immediately or observe). Hmm — q3 chose override list, which implies enforcement now. But rollout mechanics (deploy all 3 at once? canary? log-mode first?) is still a separate decision. Depends on storage. But actually rollout is independent of storage... it's about whether the first deploy rejects. Given q3 = override list (enforce), rollout question = staged rollout: canary one instance first vs all three. That's independent of storage/fail mode. Ask now.

7. Who owns the enterprise override numbers: organizational, depends on tier mechanism (settled: config file). Now unblocked: does the config live in repo (reviewed by eng) or a separate ops-owned file/env? Ownership decision. Ask now.

So round 2: keying, algorithm, storage, rejection response, rollout staging, override ownership. That's 6 questions — a bit many but all independent. Fail mode waits for storage; limit numbers depend on algorithm+observation (q3 chose enforce, so numbers are needed... the actual numeric values depend on algorithm choice and on the observed traffic which we don't have — I can ask "how do we pick the default number" as a decision, but that depends on algorithm. Later round 3.)

Actually keying also interacts with override ownership? No.

Let me be careful: algorithm vs failure mode: token bucket with Redis → atomic op via Lua. Fine.

Round 2, six questions. Recommendations:

Q4 Keying: x-customer-id only (recommended). Rationale: it's already the tenancy key; no trustworthy IP; keying by IP would lump a customer's whole egress behind one NAT anyway. Alternatives: IP only; both (customer + IP, whichever trips); customer + per-route.

Spoofability wrinkle: rotating fake customer IDs bypasses a per-customer limit while still hammering Postgres. That's a real consequence of fairness goal: a fairness limiter keyed on an unauthenticated header doesn't protect shared capacity. Should I ask whether to add a global circuit-breaker as backstop? That's a distinct decision: "do we need a global/shared capacity ceiling in addition to per-customer?" That depends on keying Q4. Hmm, it depends on Q4's answer, so later round. But it's important. I'll fold as a separate option in Q4? Options: (a) customer id only, (b) customer id + global aggregate ceiling as backstop, (c) IP, (d) both customer and IP. Recommended: (b) — since header is spoofable, per-customer alone doesn't protect Postgres. That's stronger reasoning and keeps fairness honest. Yes, recommend (b).

Q5 Algorithm: token bucket recommended (bursts allowed up to bucket size, smooth refill), alternatives fixed window (cheap, 2x burst at boundary, wrong for bursters), sliding window log (precise, memory-heavy), sliding window counter. Recommend token bucket.

Q6 Storage: Redis shared vs in-memory per-instance vs in-memory with limit/3. Fairness goal + 3 instances → per-instance is defensible if you accept 3× and don't care about exactness. But override list per customer × 3 instances... Recommend Redis shared counter with a short key TTL, keyed prefix separate from sessions keyspace. Hmm — but fail mode then becomes a question (next round). Given fairness goal, an in-memory per-instance limiter is much simpler and needs no Redis dependency, and round-robin means each instance sees ~1/3 of traffic; a burst still hits all three. A token bucket per instance with limit/3 per instance approximately enforces the total only if traffic is evenly distributed. Redis is the safer choice for a real limit; in-memory is the simplest. For fairness with 20 bursters and one bad actor: the bad actor spreads evenly, so per-instance limit/3 works fine in expectation. Honestly in-memory with per-instance = total/3 is boring and good. But "3× the limit" risk with uneven round-robin... round-robin is even. Recommend in-memory per-instance bucket sized total/3: no Redis latency, no new failure mode, no keyspace contention with sessions. Alternative Redis for exactness.

Hmm. Which do I actually recommend? The user chose "fairness first" — approximate is acceptable, and the whole point of that answer was cheap and shippable. So in-memory, per-instance, limit divided by instance count (configurable), is consistent. Redis would be needed for exact quota — which was rejected. So recommend in-memory. But then the plan's "Redis already used for sessions; we may use it" becomes unused — fine, and I should note that choosing in-memory makes the fail-mode question disappear, which is a real simplification. Good, that's a tree insight: storage answer prunes fail-mode branch. Though I still might ask fail mode if Redis chosen.

Note: in-memory requires knowing instance count as config; 3 is hardcoded-ish (env var). Fine.

Q7 Rejection response: 429 + Retry-After + JSON body with machine-readable code + rate-limit headers (X-RateLimit-Limit/Remaining/Reset or the IETF draft RateLimit headers). Recommended: 429, `Retry-After` seconds, JSON `{error:"rate_limited", retryAfterMs}`, plus RateLimit-* headers on all POST responses so clients can self-pace. Alternate: 503; or silent 429 without headers; or queue/delay.

Q8 Rollout: canary one instance → all three, vs all at once, vs log-only first deploy then enforce. Given q3=override list with enforcement, how staged? Recommend: deploy with limits set high enough to never trip for a day (log-only via a flag) then tighten? That's basically observe-first which q3 rejected (they chose override list over observe-first). Careful: q3 options were (a) override list, (b) static default, (c) observe first, (d) count only. They chose override list. But within override-list, you can still stage the deploy: canary instance. Recommend canary 1 of 3 for an hour (traffic is round-robin so it's a real sample), then all three. Alternatives: all at once; enforce in one instance only permanently (bad); ramp via limit multiplier.

Q9 Override ownership/config location: file in repo (PR-reviewed, eng owns), env var JSON, or Redis-stored config that ops/support edits at runtime. Given in-memory storage choice... if Redis not used, runtime edits impossible. But careful: Q6 and Q9 interact? Q9's option "Redis config" depends on Q6. Hmm — dependency. If storage is in-memory, config must be a file/env loaded at boot. To avoid cross-dependency, phrase Q9 as ownership only: who owns the numbers and how changes get reviewed — eng PR to a checked-in file vs support-team edit + deploy vs sales-driven. Then the mechanism follows from Q6. Ask as "who owns the numbers".

Round 2 = Q4 keying(+global backstop), Q5 algorithm, Q6 storage, Q7 rejection response, Q8 rollout, Q9 ownership. All independent of each other? Q6 storage vs Q7 no. Q5 vs Q6 no. Q8 vs all no. Yes, six independent.

That's a lot but skill says ask the whole frontier. Go.

Evidence pointers:
- keying: src/server.ts:7, src/orders.ts:12.
- algorithm: PLAN.md:15, :10.
- storage: PLAN.md:7-8, src/server.ts (no shared state), src/db.ts maybe.
- response: src/server.ts:8 (existing 401 plain text — precedent: plain text errors, no JSON error envelope). Good evidence: existing errors are `new Response("missing x-customer-id", {status:401})` — no JSON error body convention. So recommending JSON body is establishing a new convention; alternatives: match existing plain text. Good nuance.
- rollout: PLAN.md:7.
- ownership: PLAN.md:18.

Write concise briefs. Use mermaid? Not needed.
```

### Model reply

Settled: fairness, in-process, override list. That prunes one branch already — if counters stay in process, the "store unreachable" question dissolves. Which is exactly what Q6 tests.

Round 2 frontier — six decisions, mutually independent:

### ask call

```json
{"questions":[{"brief":{"evidence":[{"lines":"5-8","note":"The only identity in the request path, unauthenticated"},{"lines":"10-14","note":"Every accepted request becomes one insert"}],"how":"Customer-keyed only means the global ceiling question disappears. Customer plus a global ceiling adds one counter and closes the spoofing hole. IP keying forces a dependency on balancer headers you cannot verify from here, and makes NAT'd offices share a bucket.","risks":["A per-customer limit on an unauthenticated header does not protect Postgres from an attacker who rotates the header","IP bucketing collapses many real customers behind one corporate NAT into a single limit"],"what":"The header is free-form: any caller can send any value, and the app never validates it against anything. A limiter keyed only on it protects you from a buggy script but not from someone who rewrites the header each request — and the stated goal is protecting shared Postgres. A second, customer-independent ceiling is the only thing that keeps the fairness promise honest.","where":"src/server.ts:7 reads x-customer-id and 401s when absent; src/orders.ts:12 uses it as the owner of the inserted row. No authentication, no session lookup, no client-IP handling exists in src/. PLAN.md line 14 lists keying as open."},"header":"Q4 Key","id":"q4","options":[{"cost":"Two counters, one shared helper","description":"Per-customer bucket plus one process-wide ceiling","holds_when":"Header values are attacker-controlled, which they are","label":"Customer id + global ceiling","tradeoff":"Keeps the fairness promise even when the header is rotated; the global ceiling is a blunt instrument that can throttle everyone if one attacker is loud enough"},{"cost":"One counter","description":"Limit per x-customer-id","holds_when":"Every caller is trusted to send its real id","label":"Customer id only","tradeoff":"Simplest and matches the existing tenancy key; a caller that rotates the header gets an unlimited budget"},{"cost":"One counter plus a header-trust assumption","description":"Limit per observed client IP","holds_when":"The balancer forwards a trustworthy, sanitised forwarded-for header","label":"Client IP only","tradeoff":"Harder to evade than a header; needs balancer behaviour this repo cannot show you, and groups NAT'd customers together"},{"cost":"Two counters","description":"Either key can trip the limit","holds_when":"You want per-desk fairness as well as per-account fairness","label":"Both customer and IP","tradeoff":"Emulates per-user fairness inside one account; doubles the keys and produces confusing double rejections"}],"recommended":0},{"brief":{"evidence":[{"lines":"14-19","note":"Algorithm and response left open"},{"lines":"10","note":"The twenty legitimate bursters"}],"how":"Token bucket and round two's storage question interact only in how the refill is made atomic; the choice itself stands on the burst requirement. Fixed window is the cheapest to implement and the worst fit here.","risks":["Fixed windows let a client use two full allowances back to back at the boundary, which is exactly the shape of the incident","A sliding log per customer costs memory proportional to the limit and grows with every burster"],"what":"Twenty customers are described as legitimately bursting, so a limiter that spreads load perfectly evenly is the wrong tool — it turns a legitimate spike into rejections. A token bucket permits a spike up to bucket size and admits the sustained rate afterwards, which is the shape you described. Fixed windows also admit double the limit across a window boundary, which reproduces the incident's shape.","where":"PLAN.md line 10 says twenty enterprise integrations legitimately burst; line 3 describes the incident as sustained volume over ten minutes. Nothing in src/ implements any counting today."},"header":"Q5 Algorithm","id":"q5","options":[{"cost":"Bucket state per key, one refill computation per request","description":"Capacity plus refill rate per customer","holds_when":"Legitimate traffic is spiky","label":"Token bucket","tradeoff":"Absorbs legitimate bursts up to a stated burst size and still enforces a sustained rate; requires a burst parameter someone must choose"},{"cost":"One counter per key per window","description":"Counter resets each fixed interval","holds_when":"You want the smallest possible implementation","label":"Fixed window","tradeoff":"Two integers and no clock arithmetic; admits up to twice the limit across a boundary and rejects bursts inside a window"},{"cost":"Timestamped entries per key","description":"Exact count over trailing interval","holds_when":"Exactness matters more than memory","label":"Sliding window log","tradeoff":"Exact and burst-friendly in the sense of never allowing boundary doubling; memory grows with request volume, one entry per request"},{"cost":"Two counters blended per key","description":"Weighted mix of current and previous window","holds_when":"You want window semantics without per-request storage","label":"Sliding window counter","tradeoff":"Smooth boundary behaviour at constant memory; approximates, so the effective limit wobbles a few percent"}],"recommended":0},{"brief":{"evidence":[{"lines":"5-9","note":"Three instances, and Redis described as someone else's"},{"lines":"3-19","note":"No shared state, no store client"}],"how":"In-process removes the fail-mode branch entirely and makes the override list boot-time state. Redis makes the next round ask what happens on a timeout, and whether the counter shares the sessions keyspace. Dividing the nominal limit by the instance count is the price of the simple route.","risks":["In-process counters under a changing instance count silently change the effective limit","Sharing a Redis keyspace with sessions invites an outage in one to become an outage in the other"],"what":"Round one chose in-process enforcement. With three instances, an in-process counter means each instance enforces the full limit independently, so a customer's real budget is up to three times the nominal number. Redis removes that, at the cost of a network dependency inside the request path and a failure mode you must then decide about.","where":"PLAN.md lines 7-8: three instances behind round-robin, and Redis 7 already used for sessions by another service. src/server.ts holds no state between requests and src/db.ts is the only outbound client."},"header":"Q6 Store","id":"q6","options":[{"cost":"A map, a clock, and one config value for instance count","description":"Per-instance bucket sized to nominal limit divided by instance count","holds_when":"Round-robin really is even, as stated","label":"In-memory, divided by instance count","tradeoff":"No new dependency, no new failure mode, no latency; the effective limit is approximate and breaks if the fleet scales past the configured divisor"},{"cost":"A client, a keyspace prefix, and a decision about timeouts","description":"One shared bucket per customer in Redis","holds_when":"You need the count to be right across instances","label":"Shared Redis counter","tradeoff":"One true number regardless of instance count; adds a network hop to the hot path and inherits a shared failure domain with the sessions data"},{"cost":"Map plus client plus fallback logic","description":"Redis when reachable, local bucket otherwise","holds_when":"You want exactness and refuse to fail on Redis loss","label":"Redis with local fallback","tradeoff":"Survives a Redis outage; the two counters disagree during and after the outage, and the fallback multiplies the limit again"},{"cost":"Redis if you already run one; otherwise none","description":"Ask the sessions service team for a namespaced counter |","holds_when":"Another team already operates that Redis","label":"Redis, namespaced and owned elsewhere","tradeoff":"Borrows their runbook and monitoring; you depend on their capacity and their incident response"}],"recommended":0},{"brief":{"evidence":[{"lines":"5-18","note":"All existing errors are plain text with a status code"},{"lines":"11-12","note":"The 201 body is a bare Order object"}],"how":"Headers on accepted responses are a decision of their own: they are cheap to add now and let the twenty integrations self-pace instead of discovering the limit by hitting it. Pick the JSON envelope and the error convention changes for this route only, which is a small inconsistency to accept knowingly.","risks":["A 429 with no Retry-After turns a polite client into a tight retry loop","Adding rate-limit headers to every response exposes your configured limits to customers, which is fine only if you would defend them"],"what":"Nothing in the app returns a JSON error today, so any structured rejection is a new convention. What a rejected client sees determines whether it backs off or hammers: a bare 429 with no retry hint invites immediate retries, which is worse than the original burst.","where":"src/server.ts:8 and :17 return plain-text errors; :12 returns the created order as JSON. No response headers beyond defaults are set anywhere. PLAN.md line 19 leaves this open."},"header":"Q7 Reject","id":"q7","options":[{"cost":"One helper plus a header set","description":"429, Retry-After, plus RateLimit headers on every POST response","holds_when":"Clients can read headers and are scripted integrations","label":"429 + Retry-After + headers","tradeoff":"A scripted client can self-pace without hitting the wall; publishes your numbers, and RateLimit headers are not yet a settled standard"},{"cost":"A few lines","description":"429 with Retry-After only","holds_when":"You want minimal surface and no published numbers","label":"429 + Retry-After","tradeoff":"Tells a client when to come back without making a standing promise about limits; well-behaved clients still cannot see how close they are"},{"cost":"A few lines","description":"Bare 429","holds_when":"The limiter almost never fires","label":"429 plain","tradeoff":"Matches the existing plain-text error style; no backoff signal, so retry storms are likely"},{"cost":"Requires holding requests and a timeout","description":"Delay or queue instead of rejecting","holds_when":"Latency is cheap and rejection is unacceptable","label":"Throttle, do not reject","tradeoff":"No client sees an error; holds connections and memory, and converts a rate problem into a latency and timeout problem"}],"recommended":0},{"brief":{"evidence":[{"lines":"7","note":"Round-robin makes a canary instance a representative sample"},{"lines":"10","note":"Twenty accounts you cannot afford to break"}],"how":"Canary-first means one hour of real traffic with one instance's worth of rejects before all customers are exposed. All-at-once is faster and gambles on the override list being complete. A dry-run flag needs a second deploy but tests the decision logic without any rejections.","risks":["Canary limits are computed per instance, so a canary with the full limit hides the 3x problem until the other two deploy","Deploying all three at once means a bad default is a fleet-wide outage, not a degraded one"],"what":"The override list is a guess until traffic proves it. With round-robin, one instance is a representative sample of all customers, so a canary is meaningful; but a canary also means the effective limit differs during the canary window, which is worth knowing before you read the metrics.","where":"PLAN.md line 7: three instances behind a round-robin balancer, so each instance sees roughly a third of every customer's traffic. The override list chosen in round one is boot-time config, so every rollout step is a deploy."},"header":"Q8 Rollout","id":"q8","options":[{"cost":"Three deploys or a stepped rollout","description":"One instance first, watch, then the rest","holds_when":"You can watch one instance's rejects for an hour","label":"Canary one instance, then all","tradeoff":"Limits the blast radius of a wrong number to a third of traffic; during the window the effective limit is not what the config says"},{"cost":"One deploy","description":"Same change everywhere","holds_when":"The override list is known-complete","label":"All three at once","tradeoff":"Fastest and uniform; a wrong default breaks a paying integration immediately and fleet-wide"},{"cost":"Two deploys and a flag","description":"Log what would have been rejected, then enforce","holds_when":"You want to validate the override list against real traffic","label":"Dry-run first, enforce second","tradeoff":"Proves the numbers before anyone sees a 429; delays real protection and adds a mode flag that people forget to flip"},{"cost":"One deploy plus config discipline","description":"High limits now, tighten over days","holds_when":"You only need to catch the extreme case this week","label":"High limits, tighten later","tradeoff":"Nothing legitimate breaks and the 40k-in-ten-minutes script still gets stopped; leaves you with a limit nobody has validated and a follow-up nobody owns"}],"recommended":0},{"brief":{"evidence":[{"note":"Tier ownership is the open item","path":"PLAN.md","lines":"18"},{"note":"One identity, one route","path":"src/server.ts","lines":"7-13"}],"how":"Engineering-owned config means every limit change is a reviewed pull request with a deploy. Support-owned means a runbook and a faster path, and probably a runtime store, which would reopen the storage question. Sales-owned means legal language you must not contradict in code. The answer decides where this config lives in round three.","risks":["Numbers owned by sales but implemented as code constants produce silent contract breaches","Nobody owning the override list means it only ever grows, never shrinks, and becomes the real quota system"],"what":"The override list creates a number per customer whether or not anyone calls it a contract. If support or sales can promise a number, whoever edits the file is effectively writing customer commitments, and the review path determines how fast and how carefully that happens.","where":"PLAN.md line 18 asks how enterprise customers get higher limits and who owns those numbers. Round one chose a per-customer override list in config, reloadable only by deploy."},"header":"Q9 Owner","id":"q9","options":[{"cost":"A code review per change","description":"Checked-in config, changed by pull request","holds_when":"Changes are rare and should be deliberate","label":"Engineering owns the file","tradeoff":"Every number is reviewed and versioned; a support request for a higher limit waits on a deploy"},{"cost":"A runbook, a runtime store option, and on-call training","description":"Support edits the values, engineering owns the code path","holds_when":"Limit changes are expected weekly","label":"Support owns the numbers","tradeoff":"Fast response to customers; support can now create incidents without a review, and likely forces a runtime config store"},{"cost":"Comms to twenty accounts plus a written policy","description":"Limits come from signed agreements","holds_when":"Customers already have written rate terms","label":"Sales owns them, code follows","tradeoff":"Aligns code with contracts; slow, and every unlisted customer needs a default nobody has agreed to in writing"},{"cost":"No new owner; revisit when it hurts","description":"Engineering now, formal ownership later","holds_when":"This week only needs a working default","label":"Nobody, explicitly, for now","tradeoff":"Avoids an organisational detour this week; the file becomes an undocumented contract by default"}],"recommended":0}]}
```

### ask result

```text
Validation failed for tool "ask":
  - questions/0/question: questions[0].question must be one or two sentences; the brief carries the context (was missing)
  - questions/0/brief/evidence/0/path: questions[0].brief.evidence[0].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/0/brief/evidence/1/path: questions[0].brief.evidence[1].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/1/question: questions[1].question must be one or two sentences; the brief carries the context (was missing)
  - questions/1/brief/evidence/0/path: questions[1].brief.evidence[0].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/1/brief/evidence/1/path: questions[1].brief.evidence[1].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/2/question: questions[2].question must be one or two sentences; the brief carries the context (was missing)
  - questions/2/brief/evidence/0/path: questions[2].brief.evidence[0].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/2/brief/evidence/1/path: questions[2].brief.evidence[1].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/3/question: questions[3].question must be one or two sentences; the brief carries the context (was missing)
  - questions/3/brief/evidence/0/path: questions[3].brief.evidence[0].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/3/brief/evidence/1/path: questions[3].brief.evidence[1].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/4/question: questions[4].question must be one or two sentences; the brief carries the context (was missing)
  - questions/4/brief/evidence/0/path: questions[4].brief.evidence[0].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/4/brief/evidence/1/path: questions[4].brief.evidence[1].path must be file, directory path, relative to the working directory or absolute (was missing)
  - questions/5/question: questions[5].question must be one or two sentences; the brief carries the context (was missing)

Received arguments:
{
  "questions": [
    {
      "brief": {
        "evidence": [
          {
            "lines": "5-8",
            "note": "The only identity in the request path, unauthenticated"
          },
          {
            "lines": "10-14",
            "note": "Every accepted request becomes one insert"
          }
        ],
        "how": "Customer-keyed only means the global ceiling question disappears. Customer plus a global ceiling adds one counter and closes the spoofing hole. IP keying forces a dependency on balancer headers you cannot verify from here, and makes NAT'd offices share a b… [truncated 6 chars]",
        "risks": [
          "A per-customer limit on an unauthenticated header does not protect Postgres from an attacker who rotates the header",
          "IP bucketing collapses many real customers behind one corporate NAT into a single limit"
        ],
        "what": "The header is free-form: any caller can send any value, and the app never validates it against anything. A limiter keyed only on it protects you from a buggy script but not from someone who rewrites the header each request — and the stated goal is protecti… [truncated 116 chars]",
        "where": "src/server.ts:7 reads x-customer-id and 401s when absent; src/orders.ts:12 uses it as the owner of the inserted row. No authentication, no session lookup, no client-IP handling exists in src/. PLAN.md line 14 lists keying as open."
      },
      "header": "Q4 Key",
      "id": "q4",
      "options": [
        {
          "cost": "Two counters, one shared helper",
          "description": "Per-customer bucket plus one process-wide ceiling",
          "holds_when": "Header values are attacker-controlled, which they are",
          "label": "Customer id + global ceiling",
          "tradeoff": "Keeps the fairness promise even when the header is rotated; the global ceiling is a blunt instrument that can throttle everyone if one attacker is loud enough"
        },
        {
          "cost": "One counter",
          "description": "Limit per x-customer-id",
          "holds_when": "Every caller is trusted to send its real id",
          "label": "Customer id only",
          "tradeoff": "Simplest and matches the existing tenancy key; a caller that rotates the header gets an unlimited budget"
        },
        {
          "cost": "One counter plus a header-trust assumption",
          "description": "Limit per observed client IP",
          "holds_when": "The balancer forwards a trustworthy, sanitised forwarded-for header",
          "label": "Client IP only",
          "tradeoff": "Harder to evade than a header; needs balancer behaviour this repo cannot show you, and groups NAT'd customers together"
        },
        {
          "cost": "Two counters",
          "description": "Either key can trip the limit",
          "holds_when": "You want per-desk fairness as well as per-account fairness",
          "label": "Both customer and IP",
          "tradeoff": "Emulates per-user fairness inside one account; doubles the keys and produces confusing double rejections"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "14-19",
            "note": "Algorithm and response left open"
          },
          {
            "lines": "10",
            "note": "The twenty legitimate bursters"
          }
        ],
        "how": "Token bucket and round two's storage question interact only in how the refill is made atomic; the choice itself stands on the burst requirement. Fixed window is the cheapest to implement and the worst fit here.",
        "risks": [
          "Fixed windows let a client use two full allowances back to back at the boundary, which is exactly the shape of the incident",
          "A sliding log per customer costs memory proportional to the limit and grows with every burster"
        ],
        "what": "Twenty customers are described as legitimately bursting, so a limiter that spreads load perfectly evenly is the wrong tool — it turns a legitimate spike into rejections. A token bucket permits a spike up to bucket size and admits the sustained rate afterwa… [truncated 145 chars]",
        "where": "PLAN.md line 10 says twenty enterprise integrations legitimately burst; line 3 describes the incident as sustained volume over ten minutes. Nothing in src/ implements any counting today."
      },
      "header": "Q5 Algorithm",
      "id": "q5",
      "options": [
        {
          "cost": "Bucket state per key, one refill computation per request",
          "description": "Capacity plus refill rate per customer",
          "holds_when": "Legitimate traffic is spiky",
          "label": "Token bucket",
          "tradeoff": "Absorbs legitimate bursts up to a stated burst size and still enforces a sustained rate; requires a burst parameter someone must choose"
        },
        {
          "cost": "One counter per key per window",
          "description": "Counter resets each fixed interval",
          "holds_when": "You want the smallest possible implementation",
          "label": "Fixed window",
          "tradeoff": "Two integers and no clock arithmetic; admits up to twice the limit across a boundary and rejects bursts inside a window"
        },
        {
          "cost": "Timestamped entries per key",
          "description": "Exact count over trailing interval",
          "holds_when": "Exactness matters more than memory",
          "label": "Sliding window log",
          "tradeoff": "Exact and burst-friendly in the sense of never allowing boundary doubling; memory grows with request volume, one entry per request"
        },
        {
          "cost": "Two counters blended per key",
          "description": "Weighted mix of current and previous window",
          "holds_when": "You want window semantics without per-request storage",
          "label": "Sliding window counter",
          "tradeoff": "Smooth boundary behaviour at constant memory; approximates, so the effective limit wobbles a few percent"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "5-9",
            "note": "Three instances, and Redis described as someone else's"
          },
          {
            "lines": "3-19",
            "note": "No shared state, no store client"
          }
        ],
        "how": "In-process removes the fail-mode branch entirely and makes the override list boot-time state. Redis makes the next round ask what happens on a timeout, and whether the counter shares the sessions keyspace. Dividing the nominal limit by the instance count i… [truncated 32 chars]",
        "risks": [
          "In-process counters under a changing instance count silently change the effective limit",
          "Sharing a Redis keyspace with sessions invites an outage in one to become an outage in the other"
        ],
        "what": "Round one chose in-process enforcement. With three instances, an in-process counter means each instance enforces the full limit independently, so a customer's real budget is up to three times the nominal number. Redis removes that, at the cost of a network… [truncated 82 chars]",
        "where": "PLAN.md lines 7-8: three instances behind round-robin, and Redis 7 already used for sessions by another service. src/server.ts holds no state between requests and src/db.ts is the only outbound client."
      },
      "header": "Q6 Store",
      "id": "q6",
      "options": [
        {
          "cost": "A map, a clock, and one config value for instance count",
          "description": "Per-instance bucket sized to nominal limit divided by instance count",
          "holds_when": "Round-robin really is even, as stated",
          "label": "In-memory, divided by instance count",
          "tradeoff": "No new dependency, no new failure mode, no latency; the effective limit is approximate and breaks if the fleet scales past the configured divisor"
        },
        {
          "cost": "A client, a keyspace prefix, and a decision about timeouts",
          "description": "One shared bucket per customer in Redis",
          "holds_when": "You need the count to be right across instances",
          "label": "Shared Redis counter",
          "tradeoff": "One true number regardless of instance count; adds a network hop to the hot path and inherits a shared failure domain with the sessions data"
        },
        {
          "cost": "Map plus client plus fallback logic",
          "description": "Redis when reachable, local bucket otherwise",
          "holds_when": "You want exactness and refuse to fail on Redis loss",
          "label": "Redis with local fallback",
          "tradeoff": "Survives a Redis outage; the two counters disagree during and after the outage, and the fallback multiplies the limit again"
        },
        {
          "cost": "Redis if you already run one; otherwise none",
          "description": "Ask the sessions service team for a namespaced counter |",
          "holds_when": "Another team already operates that Redis",
          "label": "Redis, namespaced and owned elsewhere",
          "tradeoff": "Borrows their runbook and monitoring; you depend on their capacity and their incident response"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "5-18",
            "note": "All existing errors are plain text with a status code"
          },
          {
            "lines": "11-12",
            "note": "The 201 body is a bare Order object"
          }
        ],
        "how": "Headers on accepted responses are a decision of their own: they are cheap to add now and let the twenty integrations self-pace instead of discovering the limit by hitting it. Pick the JSON envelope and the error convention changes for this route only, whic… [truncated 47 chars]",
        "risks": [
          "A 429 with no Retry-After turns a polite client into a tight retry loop",
          "Adding rate-limit headers to every response exposes your configured limits to customers, which is fine only if you would defend them"
        ],
        "what": "Nothing in the app returns a JSON error today, so any structured rejection is a new convention. What a rejected client sees determines whether it backs off or hammers: a bare 429 with no retry hint invites immediate retries, which is worse than the origina… [truncated 8 chars]",
        "where": "src/server.ts:8 and :17 return plain-text errors; :12 returns the created order as JSON. No response headers beyond defaults are set anywhere. PLAN.md line 19 leaves this open."
      },
      "header": "Q7 Reject",
      "id": "q7",
      "options": [
        {
          "cost": "One helper plus a header set",
          "description": "429, Retry-After, plus RateLimit headers on every POST response",
          "holds_when": "Clients can read headers and are scripted integrations",
          "label": "429 + Retry-After + headers",
          "tradeoff": "A scripted client can self-pace without hitting the wall; publishes your numbers, and RateLimit headers are not yet a settled standard"
        },
        {
          "cost": "A few lines",
          "description": "429 with Retry-After only",
          "holds_when": "You want minimal surface and no published numbers",
          "label": "429 + Retry-After",
          "tradeoff": "Tells a client when to come back without making a standing promise about limits; well-behaved clients still cannot see how close they are"
        },
        {
          "cost": "A few lines",
          "description": "Bare 429",
          "holds_when": "The limiter almost never fires",
          "label": "429 plain",
          "tradeoff": "Matches the existing plain-text error style; no backoff signal, so retry storms are likely"
        },
        {
          "cost": "Requires holding requests and a timeout",
          "description": "Delay or queue instead of rejecting",
          "holds_when": "Latency is cheap and rejection is unacceptable",
          "label": "Throttle, do not reject",
          "tradeoff": "No client sees an error; holds connections and memory, and converts a rate problem into a latency and timeout problem"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "lines": "7",
            "note": "Round-robin makes a canary instance a representative sample"
          },
          {
            "lines": "10",
            "note": "Twenty accounts you cannot afford to break"
          }
        ],
        "how": "Canary-first means one hour of real traffic with one instance's worth of rejects before all customers are exposed. All-at-once is faster and gambles on the override list being complete. A dry-run flag needs a second deploy but tests the decision logic with… [truncated 19 chars]",
        "risks": [
          "Canary limits are computed per instance, so a canary with the full limit hides the 3x problem until the other two deploy",
          "Deploying all three at once means a bad default is a fleet-wide outage, not a degraded one"
        ],
        "what": "The override list is a guess until traffic proves it. With round-robin, one instance is a representative sample of all customers, so a canary is meaningful; but a canary also means the effective limit differs during the canary window, which is worth knowin… [truncated 30 chars]",
        "where": "PLAN.md line 7: three instances behind a round-robin balancer, so each instance sees roughly a third of every customer's traffic. The override list chosen in round one is boot-time config, so every rollout step is a deploy."
      },
      "header": "Q8 Rollout",
      "id": "q8",
      "options": [
        {
          "cost": "Three deploys or a stepped rollout",
          "description": "One instance first, watch, then the rest",
          "holds_when": "You can watch one instance's rejects for an hour",
          "label": "Canary one instance, then all",
          "tradeoff": "Limits the blast radius of a wrong number to a third of traffic; during the window the effective limit is not what the config says"
        },
        {
          "cost": "One deploy",
          "description": "Same change everywhere",
          "holds_when": "The override list is known-complete",
          "label": "All three at once",
          "tradeoff": "Fastest and uniform; a wrong default breaks a paying integration immediately and fleet-wide"
        },
        {
          "cost": "Two deploys and a flag",
          "description": "Log what would have been rejected, then enforce",
          "holds_when": "You want to validate the override list against real traffic",
          "label": "Dry-run first, enforce second",
          "tradeoff": "Proves the numbers before anyone sees a 429; delays real protection and adds a mode flag that people forget to flip"
        },
        {
          "cost": "One deploy plus config discipline",
          "description": "High limits now, tighten over days",
          "holds_when": "You only need to catch the extreme case this week",
          "label": "High limits, tighten later",
          "tradeoff": "Nothing legitimate breaks and the 40k-in-ten-minutes script still gets stopped; leaves you with a limit nobody has validated and a follow-up nobody owns"
        }
      ],
      "recommended": 0
    },
    {
      "brief": {
        "evidence": [
          {
            "note": "Tier ownership is the open item",
            "path": "PLAN.md",
            "lines": "18"
          },
          {
            "note": "One identity, one route",
            "path": "src/server.ts",
            "lines": "7-13"
          }
        ],
        "how": "Engineering-owned config means every limit change is a reviewed pull request with a deploy. Support-owned means a runbook and a faster path, and probably a runtime store, which would reopen the storage question. Sales-owned means legal language you must no… [truncated 80 chars]",
        "risks": [
          "Numbers owned by sales but implemented as code constants produce silent contract breaches",
          "Nobody owning the override list means it only ever grows, never shrinks, and becomes the real quota system"
        ],
        "what": "The override list creates a number per customer whether or not anyone calls it a contract. If support or sales can promise a number, whoever edits the file is effectively writing customer commitments, and the review path determines how fast and how careful… [truncated 16 chars]",
        "where": "PLAN.md line 18 asks how enterprise customers get higher limits and who owns those numbers. Round one chose a per-customer override list in config, reloadable only by deploy."
      },
      "header": "Q9 Owner",
      "id": "q9",
      "options": [
        {
          "cost": "A code review per change",
          "description": "Checked-in config, changed by pull request",
          "holds_when": "Changes are rare and should be deliberate",
          "label": "Engineering owns the file",
          "tradeoff": "Every number is reviewed and versioned; a support request for a higher limit waits on a deploy"
        },
        {
          "cost": "A runbook, a runtime store option, and on-call training",
          "description": "Support edits the values, engineering owns the code path",
          "holds_when": "Limit changes are expected weekly",
          "label": "Support owns the numbers",
          "tradeoff": "Fast response to customers; support can now create incidents without a review, and likely forces a runtime config store"
        },
        {
          "cost": "Comms to twenty accounts plus a written policy",
          "description": "Limits come from signed agreements",
          "holds_when": "Customers already have written rate terms",
          "label": "Sales owns them, code follows",
          "tradeoff": "Aligns code with contracts; slow, and every unlisted customer needs a default nobody has agreed to in writing"
        },
        {
          "cost": "No new owner; revisit when it hurts",
          "description": "Engineering now, formal ownership later",
          "holds_when": "This week only needs a working default",
          "label": "Nobody, explicitly, for now",
          "tradeoff": "Avoids an organisational detour this week; the file becomes an undocumented contract by default"
        }
      ],
      "recommended": 0
    }
  ]
}
```

### Model reasoning

```text
I omitted `question` and evidence `path` fields in most entries. Fix and resend.
```

### ask call

```json
{"questions":[{"id":"q4","header":"Q4 Key","question":"What do you key the limit on: x-customer-id, client IP, both, or the customer id plus a process-wide ceiling as backstop?","options":[{"label":"Customer id + global ceiling","description":"Per-customer bucket plus one process-wide ceiling","tradeoff":"Keeps the fairness promise even when the header is rotated; the global ceiling is a blunt instrument that can throttle everyone if one attacker is loud enough","holds_when":"Header values are attacker-controlled, which they are","cost":"Two counters, one shared helper"},{"label":"Customer id only","description":"Limit per x-customer-id","tradeoff":"Simplest and matches the existing tenancy key; a caller that rotates the header gets an unlimited budget","holds_when":"Every caller is trusted to send its real id","cost":"One counter"},{"label":"Client IP only","description":"Limit per observed client IP","tradeoff":"Harder to evade than a header; needs balancer behaviour this repo cannot show you, and groups NAT'd customers together","holds_when":"The balancer forwards a trustworthy, sanitised forwarded-for header","cost":"One counter plus a header-trust assumption"},{"label":"Both customer and IP","description":"Either key can trip the limit","tradeoff":"Emulates per-user fairness inside one account; doubles the keys and produces confusing double rejections","holds_when":"You want per-desk fairness as well as per-account fairness","cost":"Two counters"}],"brief":{"where":"src/server.ts:7 reads x-customer-id and 401s when absent; src/orders.ts:12 uses it as the owner of the inserted row. No authentication, no session lookup, no client-IP handling exists in src/. PLAN.md line 14 lists keying as open.","what":"The header is free-form: any caller can send any value and the app never validates it. A limiter keyed only on it stops a buggy script but not someone who rewrites the header each request, and the stated goal is protecting shared Postgres. A customer-independent ceiling is the only thing that keeps the fairness promise honest.","how":"Customer-keyed only means the global ceiling question disappears. Customer plus global ceiling adds one counter and closes the spoofing hole. IP keying ties you to balancer headers you cannot verify from here and makes NAT'd offices share a bucket.","evidence":[{"path":"src/server.ts","lines":"5-8","note":"The only identity in the request path, unauthenticated"},{"path":"src/orders.ts","lines":"10-14","note":"Every accepted request becomes one insert"}],"risks":["A per-customer limit on an unauthenticated header does not protect Postgres from an attacker who rotates the header","IP bucketing collapses many real customers behind one corporate NAT into a single limit"]},"recommended":0},{"id":"q5","header":"Q5 Algorithm","question":"Which algorithm: fixed window, sliding window log, sliding window counter, or token bucket?","options":[{"label":"Token bucket","description":"Capacity plus refill rate per customer","tradeoff":"Absorbs legitimate bursts up to a stated burst size and still enforces a sustained rate; requires a burst parameter someone must choose","holds_when":"Legitimate traffic is spiky","cost":"Bucket state per key, one refill computation per request"},{"label":"Fixed window","description":"Counter resets each fixed interval","tradeoff":"Two integers and no clock arithmetic; admits up to twice the limit across a boundary and rejects bursts inside a window","holds_when":"You want the smallest possible implementation","cost":"One counter per key per window"},{"label":"Sliding window log","description":"Exact count over trailing interval","tradeoff":"Exact, never allows boundary doubling; memory grows with request volume, one entry per request","holds_when":"Exactness matters more than memory","cost":"Timestamped entries per key"},{"label":"Sliding window counter","description":"Weighted mix of current and previous window","tradeoff":"Smooth boundary behaviour at constant memory; approximates, so the effective limit wobbles a few percent","holds_when":"You want window semantics without per-request storage","cost":"Two counters blended per key"}],"brief":{"where":"PLAN.md line 10 says twenty enterprise integrations legitimately burst; line 3 describes the incident as sustained volume over ten minutes. Nothing in src/ implements counting today.","what":"Twenty customers legitimately burst, so a limiter that spreads load perfectly evenly is the wrong tool: it turns a legitimate spike into rejections. A token bucket permits a spike up to bucket size then admits the sustained rate. Fixed windows also admit double the limit across a boundary, which reproduces the incident's shape.","how":"The choice stands on the burst requirement alone; the storage answer only decides how a refill is made atomic. Fixed window is cheapest to implement and the worst fit for these customers.","evidence":[{"path":"PLAN.md","lines":"14-19","note":"Algorithm and response left open"},{"path":"PLAN.md","lines":"10","note":"The twenty legitimate bursters"}],"risks":["Fixed windows let a client spend two full allowances back to back at the boundary, the shape of the incident","A sliding log per customer costs memory proportional to the limit and grows with every burster"]},"recommended":0},{"id":"q6","header":"Q6 Store","question":"Where do the counters live: in each instance's memory, in the shared Redis, a Redis-with-local-fallback hybrid, or a Redis namespaced and run by the sessions team?","options":[{"label":"In-memory, divided by instance count","description":"Per-instance bucket sized to nominal limit divided by instance count","tradeoff":"No new dependency, no new failure mode, no latency; the effective limit is approximate and breaks if the fleet scales past the configured divisor","holds_when":"Round-robin really is even, as stated","cost":"A map, a clock, and one config value for instance count"},{"label":"Shared Redis counter","description":"One shared bucket per customer in Redis","tradeoff":"One true number regardless of instance count; adds a network hop to the hot path and inherits a failure domain shared with session data","holds_when":"You need the count to be right across instances","cost":"A client, a keyspace prefix, and a decision about timeouts"},{"label":"Redis with local fallback","description":"Redis when reachable, local bucket otherwise","tradeoff":"Survives a Redis outage; the two counters disagree during and after the outage, and the fallback multiplies the limit again","holds_when":"You want exactness and refuse to fail on Redis loss","cost":"Map plus client plus fallback logic"},{"label":"Redis, namespaced and owned elsewhere","description":"Borrow a namespaced counter in the sessions cluster","tradeoff":"Borrows their runbook and monitoring; you depend on their capacity and their incident response","holds_when":"Another team already operates that Redis","cost":"Coordination, a keyspace prefix, no new infrastructure"}],"brief":{"where":"PLAN.md lines 7-8: three instances behind round-robin, and Redis 7 already used for sessions by another service. src/server.ts holds no state between requests and src/db.ts is the only outbound client.","what":"Round one chose in-process enforcement. With three instances, an in-process counter means each instance enforces the full limit independently, so a customer's real budget is up to three times the nominal number. Redis removes that, at the cost of a network dependency in the request path and a failure mode you must then decide about.","how":"In-process removes the fail-mode branch entirely and makes the override list boot-time state. Redis makes the next round ask what happens on timeout and whether the counter shares the sessions keyspace. Dividing the nominal limit by the instance count is the price of the simple route.","evidence":[{"path":"PLAN.md","lines":"5-9","note":"Three instances, and Redis described as someone else's"},{"path":"src/server.ts","lines":"3-19","note":"No shared state, no store client"}],"risks":["In-process counters under a changing instance count silently change the effective limit","Sharing a Redis keyspace with sessions invites an outage in one to become an outage in the other"]},"recommended":0},{"id":"q7","header":"Q7 Reject","question":"What does a rejected client see: 429 with Retry-After and rate-limit headers, 429 with Retry-After only, a bare 429, or a throttled response with no rejection?","options":[{"label":"429 + Retry-After + headers","description":"429, Retry-After, plus RateLimit headers on every POST response","tradeoff":"A scripted client can self-pace without hitting the wall; publishes your numbers, and RateLimit headers are not yet a settled standard","holds_when":"Clients are scripted integrations that can read headers","cost":"One helper plus a header set"},{"label":"429 + Retry-After","description":"429 with Retry-After only","tradeoff":"Tells a client when to come back without making a standing promise about limits; well-behaved clients still cannot see how close they are","holds_when":"You want minimal surface and no published numbers","cost":"A few lines"},{"label":"429 plain","description":"Bare 429","tradeoff":"Matches the existing plain-text error style; no backoff signal, so retry storms are likely","holds_when":"The limiter almost never fires","cost":"A few lines"},{"label":"Throttle, do not reject","description":"Delay or queue instead of rejecting","tradeoff":"No client sees an error; holds connections and memory, and converts a rate problem into a latency and timeout problem","holds_when":"Latency is cheap and rejection is unacceptable","cost":"Requires holding requests and a timeout"}],"brief":{"where":"src/server.ts:8 and :17 return plain-text errors; :12 returns the created order as JSON. No response headers beyond defaults are set anywhere. PLAN.md line 19 leaves this open.","what":"Nothing in the app returns a JSON error today, so any structured rejection is a new convention. What a rejected client sees decides whether it backs off or hammers: a bare 429 with no retry hint invites immediate retries, which is worse than the original burst.","how":"Headers on accepted responses are cheap now and let the twenty integrations self-pace instead of discovering the limit by hitting it. A JSON envelope changes the error convention for this route only, which is a small inconsistency to accept knowingly.","evidence":[{"path":"src/server.ts","lines":"5-18","note":"All existing errors are plain text with a status code"},{"path":"src/server.ts","lines":"11-12","note":"The 201 body is a bare Order object"}],"risks":["A 429 with no Retry-After turns a polite client into a tight retry loop","Publishing rate-limit headers exposes your configured limits, which is fine only if you would defend them"]},"recommended":0},{"id":"q8","header":"Q8 Rollout","question":"How does it reach production: canary one instance then all three, all three at once, a dry-run flag first, or high limits now with tightening later?","options":[{"label":"Canary one instance, then all","description":"One instance first, watch, then the rest","tradeoff":"Limits the blast radius of a wrong number to a third of traffic; during the window the effective limit is not what the config says","holds_when":"You can watch one instance's rejects for an hour","cost":"Stepped rollout"},{"label":"All three at once","description":"Same change everywhere","tradeoff":"Fastest and uniform; a wrong default breaks a paying integration immediately and fleet-wide","holds_when":"The override list is known-complete","cost":"One deploy"},{"label":"Dry-run first, enforce second","description":"Log what would have been rejected, then enforce","tradeoff":"Proves the numbers before anyone sees a 429; delays real protection and adds a mode flag people forget to flip","holds_when":"You want to validate the override list against real traffic","cost":"Two deploys and a flag"},{"label":"High limits, tighten later","description":"High limits now, tighten over days","tradeoff":"Nothing legitimate breaks and the 40k-in-ten-minutes script still gets stopped; leaves a limit nobody has validated and a follow-up nobody owns","holds_when":"You only need to catch the extreme case this week","cost":"One deploy plus config discipline"}],"brief":{"where":"PLAN.md line 7: three instances behind a round-robin balancer, so each instance sees about a third of every customer's traffic. The override list chosen in round one is boot-time config, so every rollout step is a deploy.","what":"The override list is a guess until traffic proves it. With round-robin one instance is a representative sample of all customers, so a canary is meaningful; but during the canary the effective limit differs, which you must know before reading the numbers.","how":"Canary-first means an hour of real traffic with one instance's worth of rejects before every customer is exposed. All-at-once gambles on the override list being complete. A dry-run flag needs a second deploy but tests the decision logic without rejections.","evidence":[{"path":"PLAN.md","lines":"7","note":"Round-robin makes a canary instance a representative sample"},{"path":"PLAN.md","lines":"10","note":"Twenty accounts you cannot afford to break"}],"risks":["A canary enforcing the full limit hides the 3x problem until the other two deploy","All three at once means a bad default is a fleet-wide outage rather than a degraded one"]},"recommended":0},{"id":"q9","header":"Q9 Owner","question":"Who owns the enterprise override numbers: engineering via pull request, support via a runbook, sales via signed agreements, or nobody for now?","options":[{"label":"Engineering owns the file","description":"Checked-in config, changed by pull request","tradeoff":"Every number is reviewed and versioned; a support request for a higher limit waits on a deploy","holds_when":"Changes are rare and should be deliberate","cost":"A code review per change"},{"label":"Support owns the numbers","description":"Support edits values, engineering owns the code path","tradeoff":"Fast response to customers; support can now create incidents without review, and likely forces a runtime config store","holds_when":"Limit changes are expected weekly","cost":"A runbook, a runtime store option, on-call training"},{"label":"Sales owns them, code follows","description":"Limits come from signed agreements","tradeoff":"Aligns code with contracts; slow, and every unlisted customer needs a default nobody agreed to in writing","holds_when":"Customers already have written rate terms","cost":"Comms to twenty accounts plus a written policy"},{"label":"Nobody, explicitly, for now","description":"Engineering now, formal ownership later","tradeoff":"Avoids an organisational detour this week; the file becomes an undocumented contract by default","holds_when":"This week only needs a working default","cost":"No new owner; revisit when it hurts"}],"brief":{"where":"PLAN.md line 18 asks how enterprise customers get higher limits and who owns those numbers. Round one chose a per-customer override list in config, reloadable only by deploy. src/server.ts:7-13 is the only route that needs it.","what":"The override list creates a number per customer whether or not anyone calls it a contract. If support or sales can promise a number, whoever edits the file is writing customer commitments, and the review path decides how fast and how carefully that happens.","how":"Engineering-owned config means every limit change is a reviewed pull request and a deploy. Support-owned means a runbook and probably a runtime store, which reopens the storage question. Sales-owned means legal terms the code must not contradict. The answer decides where this config lives next round.","evidence":[{"path":"PLAN.md","lines":"18","note":"Tier ownership is the open item"},{"path":"src/server.ts","lines":"7-13","note":"One identity, one expensive route"}],"risks":["Numbers owned by sales but implemented as code constants produce silent contract breaches","An unowned override list only ever grows and becomes the real quota system"]},"recommended":0}]}
```

### ask result

```text
User answers:
q4: Customer id + global ceiling
q5: Token bucket
q6: In-memory, divided by instance count
q7: 429 + Retry-After + headers
q8: Canary one instance, then all
q9: Engineering owns the file
```

### Model reasoning

```text
Settled: customer id + global ceiling; token bucket; in-memory divided by instance count; 429+Retry-After+headers; canary; engineering owns config.

Now recompute frontier. Open items and new consequences:

1. Since in-memory: fail-mode question is gone (no store). But wait — q4 added a global ceiling, which is also in-memory. Good.

2. New consequence of in-memory + divided by instance count: how is the divisor configured and what happens when the fleet scales or when the canary window is running? This is a real decision: instance count as env var, or discovery, or "compute per-instance from a total env var". And a canary interaction: during canary, if all instances run the divided limit, effective limit is fine; but if canary uses full limit, it's 3x. Need decision: same per-instance config everywhere (divisor fixed at 3) vs divisor from env. This depends on q8 (canary) + q6 — both settled. So it's now unblocked. Good question.

3. Actual limit numbers: default limit, burst size, refill rate per customer; enterprise override values. Depends on algorithm (settled) and on the fairness goal. The numbers themselves — I cannot measure traffic (no data in repo). Decision: how to choose them (invent a generous default vs derive from observed max vs ask sales). Partially depends on q8 (canary observation). Since q8 = canary, you can observe. Decision: where do the numbers come from — a stated derivation policy. Unblocked now.

But careful: "the numbers" is a fact-ish thing I can't look up. It's the user's business fact, but as a design
```

