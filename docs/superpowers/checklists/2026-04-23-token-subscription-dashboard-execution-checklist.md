# Token Subscription Dashboard Execution Checklist

Date: 2026-04-23
Based on: `docs/superpowers/plans/2026-04-23-token-subscription-dashboard-implementation-plan.md`

## 0) Pre-implementation alignment

- [ ] Confirm the first shipped route: `/subscriptions` or `/tokens`
- [ ] Confirm which providers have stable connectors today
- [ ] Confirm whether browser-import is a first-class connector or an internal fallback
- [ ] Confirm whether one shared detail drawer is sufficient or provider-specific panels are needed
- [ ] Confirm any provider-specific freshness thresholds beyond the 24-hour default

## 1) Data model and API foundation

- [ ] Define the normalized subscription model
- [ ] Add `metric_kind` to distinguish tokens, messages, requests, credits, and allowance
- [ ] Add `display_unit` as the human-readable unit label shown in the UI
- [ ] Store synced and manual values independently
- [ ] Add history tracking for sync and manual override events
- [ ] Add `GET /api/subscriptions`
- [ ] Add `GET /api/subscriptions/:id/history`
- [ ] Add `PUT /api/subscriptions/:id` for manual overrides
- [ ] Add `POST /api/subscriptions/:id/sync` for one-off refresh
- [ ] Add `POST /api/subscriptions/:id/connect` for connector setup
- [ ] Add `DELETE /api/subscriptions/:id/connection` for disconnect
- [ ] Ensure sensitive connector material is excluded from normal UI payloads
- [ ] Ensure secret material is not leaked through logs or public API responses

### Verification for Phase 1

- [ ] API returns normalized subscription objects consistently
- [ ] History endpoint returns sync/manual event records
- [ ] Manual and synced values are stored separately
- [ ] Sensitive connector fields do not appear in standard responses

## 2) Provider adapter layer

- [ ] Create Xiaomi MiMo adapter
- [ ] Create ChatGPT Plus adapter
- [ ] Create Cursor adapter
- [ ] Create Google AI adapter
- [ ] Normalize each provider into the shared model
- [ ] Support API key connectors where applicable
- [ ] Support OAuth connectors where applicable
- [ ] Support browser-import connectors where applicable
- [ ] Support manual-only provider handling
- [ ] Make adapters report sync status
- [ ] Make adapters report confidence
- [ ] Make adapters report staleness
- [ ] Make adapters report last error

### Verification for Phase 2

- [ ] Each provider maps into the same canonical shape
- [ ] Each adapter clearly marks whether the value is synced, manual, stale, disconnected, or error
- [ ] Providers without a stable API still render usable manual-only state

## 3) Dashboard UI shell

- [ ] Add the top-level route
- [ ] Choose and wire the nav label
- [ ] Build the global summary bar
- [ ] Show total estimated remaining allowance
- [ ] Show connected provider count
- [ ] Show last sync time
- [ ] Show stale/manual-only provider count
- [ ] Build the provider cards grid
- [ ] Build the detail drawer or side panel
- [ ] Build the manual override form
- [ ] Build the settings/connections section
- [ ] Ensure the copy is honest about unit type

### Verification for Phase 3

- [ ] Dashboard opens from the main Hermes UI navigation
- [ ] Summary bar is visible and populated
- [ ] Provider cards render one card per subscription
- [ ] Detail panel opens and closes reliably
- [ ] Manual edit form is reachable from the provider card or detail panel

## 4) Sync, conflict, and staleness behavior

- [ ] Implement refresh flows that update synced data without destroying manual state
- [ ] Show manual and synced values together when they differ
- [ ] Add explicit action to use synced value
- [ ] Add explicit action to keep manual value
- [ ] Mark stale when the source has not synced within the threshold
- [ ] Mark stale when credentials expire or change
- [ ] Mark stale when provider data is incomplete
- [ ] Surface retries and fallback actions without clearing the last known value prematurely
- [ ] Apply the default 24-hour staleness threshold
- [ ] Allow provider-specific threshold overrides

### Verification for Phase 4

- [ ] Failed sync does not erase the last known value
- [ ] Manual override remains active until the user explicitly changes it
- [ ] Stale state is visible and distinct from error and disconnected states
- [ ] Conflict actions update the active value correctly

## 5) Connection guidance and provider-specific UX

- [ ] Create connection cards per provider
- [ ] Add provider-specific notes and setup guidance
- [ ] Include example payloads or example connection states where helpful
- [ ] Show a plain-language fallback when a provider lacks a stable connector
- [ ] Keep guidance concise and actionable
- [ ] Ensure ChatGPT Plus guidance clearly describes usage/allowance tracking when token balance is unavailable
- [ ] Ensure Cursor guidance clearly describes usage/allowance tracking when token balance is unavailable
- [ ] Ensure Xiaomi MiMo guidance reflects the best available connector path
- [ ] Ensure Google AI guidance reflects the API key / project flow

### Verification for Phase 5

- [ ] Each provider has a visible connect/help entry point
- [ ] Fallback copy is understandable for manual-only or unsupported connector states
- [ ] Example connection guidance is copyable or easy to follow

## 6) Accessibility and polish

- [ ] Verify all state badges and labels are visually distinct
- [ ] Confirm keyboard accessibility for cards, drawers, and actions
- [ ] Confirm screen-reader labels for status and numbers
- [ ] Test empty state
- [ ] Test disconnected state
- [ ] Test stale state
- [ ] Test error state
- [ ] Test manual-only state
- [ ] Confirm the dashboard matches Hermes UI styling
- [ ] Use dark background, bordered cards, compact hierarchy, and measured color usage

### Verification for Phase 6

- [ ] Keyboard-only navigation works for core flows
- [ ] Screen readers can interpret statuses and numeric values
- [ ] Visual states are clearly distinguishable without relying on color alone
- [ ] Empty and error states remain useful and actionable

## 7) Security and privacy

- [ ] Do not expose raw secrets in the UI
- [ ] Encrypt persisted credentials at rest
- [ ] Avoid logging tokens, cookies, or imported session data
- [ ] Treat browser-import flows as user-approved and revocable
- [ ] Keep sensitive connector metadata out of public API responses

### Verification for Phase 7

- [ ] No secret-bearing fields appear in standard UI responses
- [ ] Logs do not contain token values or imported session payloads
- [ ] Browser-import connections can be revoked cleanly

## 8) Acceptance criteria check

- [ ] Dashboard clearly shows remaining allowance for Xiaomi MiMo, ChatGPT Plus, Cursor, and Google AI
- [ ] Each provider has an obvious sync status badge and provenance label
- [ ] Manual override persists when sync is unavailable and can be re-applied or replaced explicitly
- [ ] Sync history and staleness are visible for every provider
- [ ] Providers without a stable API are still useful through manual tracking
- [ ] Page feels visually consistent with the existing Hermes web UI
- [ ] UI distinguishes true token balances from usage-limit or allowance-based metrics when providers do not expose a raw token count
- [ ] API response does not leak sensitive connector material

## Recommended execution order

- [ ] Complete data model and API foundation first
- [ ] Implement history tracking next
- [ ] Add provider adapters after the shared model exists
- [ ] Build the UI shell and summary cards
- [ ] Add detail panels and manual editing
- [ ] Add connection guidance and provider-specific copy
- [ ] Finish with accessibility, polish, and security checks

## Done when

- [ ] The dashboard works end-to-end in the Hermes web UI
- [ ] Sync and manual override flows both function correctly
- [ ] History and staleness are visible and accurate
- [ ] Unsupported or API-limited providers still remain useful
- [ ] The implementation satisfies every acceptance criterion above
