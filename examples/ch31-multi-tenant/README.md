# Chapter 31 - Design: A Multi-Tenant Agent Platform

Demonstrates the core components of a multi-tenant AI platform:
tenant isolation, quota enforcement, usage metering, noisy neighbor
detection, and billing.

## Requirements

Node 22.6 or later. Nothing else.

## Run the whole lab

```bash
node scripts/lab.mjs
```

Runs all seven steps with 26 assertions, exits non-zero if any fail.
Takes about one second.

## The key insight

Multi-tenancy is not a feature bolted on at the end. It is an
architectural decision that permeates every layer: data storage,
request routing, quota enforcement, metering, and billing.

The core principles:

1. **Tenant ID is not trusted from requests** - it comes from the
   authenticated context, not request parameters.

2. **Every data operation is tenant-scoped** - the data layer never
   returns data from a different tenant, even if the query is malformed.

3. **Quotas are checked in priority order** - cheapest checks first,
   most likely to reject first.

4. **Noisy neighbors are throttled, not killed** - temporary throttling
   protects other tenants without breaking the offending tenant's SLA.

## Layout

```
src/
  types.ts        Core types: TenantConfig, UsageRecord, etc.
  tenant.ts       Tenant lifecycle management
  isolation.ts    Data isolation and request routing
  quota.ts        Rate limiting and budget enforcement
  metering.ts     Usage tracking and aggregation
  billing.ts      Invoice generation and cost attribution
```

## What the lab demonstrates

| Step | What it shows |
| --- | --- |
| 1 | Tenant creation with custom quotas |
| 2 | Data isolation between tenants |
| 3 | Per-tenant rate limit enforcement |
| 4 | Usage metering accuracy and isolation |
| 5 | Noisy neighbor detection and throttling |
| 6 | Tenant configuration (model tiers, tools) |
| 7 | Billing and tier-based cost attribution |

## Isolation model

```
Request arrives with auth token
  -> Extract tenant ID from token (not request params!)
  -> Load tenant config from registry
  -> Check tenant status (active, suspended, etc.)

Data access:
  -> Every read/write takes tenantId parameter
  -> Data layer verifies ownership before returning
  -> Cross-tenant access returns null, not error
       (don't leak existence of other tenants' data)

Compute isolation:
  -> Shared tenants: logical separation, noisy neighbor detection
  -> Dedicated tenants: separate compute pools
  -> Isolated tenants: separate infrastructure
```

## Quota enforcement order

Quotas are checked in this order, which reflects cost of check and
likelihood of rejection:

1. Tenant status (is active?)
2. Rate limits (per second, per minute)
3. Concurrency limits
4. Daily token budget
5. Monthly token budget
6. Storage limits

## Noisy neighbor detection

Tenants are scored based on resource consumption relative to fair share.
When a tenant's score exceeds the threshold, they are temporarily
throttled. This protects other tenants without requiring manual
intervention.

```
Score = (tenant's usage / fair share) * factor
Throttle when score > 80
Throttle duration: 30 seconds (configurable)
```

## Things worth breaking on purpose

- Create two tenants with identical IDs and observe the registry
  behavior. (Hint: it overwrites, which is a bug in production.)

- Remove the tenant ownership check in `retrieve()` and observe
  cross-tenant data access succeeding.

- Set the noisy neighbor threshold to 0 and observe all tenants
  getting throttled immediately.

- Remove the rate limit check and observe a single tenant consuming
  all available capacity.
