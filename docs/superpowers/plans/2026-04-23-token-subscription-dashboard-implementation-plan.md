# Token Subscription Dashboard Implementation Plan

Date: 2026-04-23
Status: Ready to implement

## Objective

Build a polished subscriptions dashboard inside the existing Hermes web UI that tracks remaining allowance for:

- Xiaomi MiMo
- ChatGPT Plus
- Cursor
- Google AI

The dashboard must support a hybrid model:

- sync when a connector exists
- fall back to manual tracking when sync is unavailable
- keep synced and manual values separate so the active value can be chosen explicitly
- remain useful even when providers expose only usage/allowance information instead of a true token balance

## Finalized design adjustments

Before implementation, the design spec has been tightened in these ways:

- Added `metric_kind` so the UI can distinguish true token balances from messages, requests, credits, or allowance-based metrics.
- Clarified sync precedence:
  - sync updates the synced record
  - manual values stay active until the user explicitly switches to synced
- Added a default staleness threshold of 24 hours, with provider-specific overrides allowed.
- Added `GET /api/subscriptions/:id/history` so the UI can show sync/manual history.
- Added secret-handling guidance:
  - encrypt persisted secrets at rest
  - keep sensitive connector metadata out of logs and public API responses

## Implementation approach

### Phase 1: Data model and API foundation

1. Define a normalized subscription model.
2. Add the new `metric_kind` field.
3. Store synced and manual values independently.
4. Add history tracking for sync and manual override events.
5. Add or extend API endpoints:
   - `GET /api/subscriptions`
   - `GET /api/subscriptions/:id/history`
   - `PUT /api/subscriptions/:id`
   - `POST /api/subscriptions/:id/sync`
   - `POST /api/subscriptions/:id/connect`
   - `DELETE /api/subscriptions/:id/connection`
6. Ensure sensitive connector material is excluded from normal UI payloads.

### Phase 2: Provider adapter layer

1. Create provider-specific adapters for:
   - Xiaomi MiMo
   - ChatGPT Plus
   - Cursor
   - Google AI
2. Normalize each provider into the shared model.
3. Support multiple connector modes where applicable:
   - API key
   - OAuth
   - browser import
   - manual-only
4. Make provider adapters report:
   - sync status
   - confidence
   - staleness
   - last error

### Phase 3: Dashboard UI

1. Add the new top-level route, likely `/subscriptions` or `/tokens`.
2. Add the global summary bar:
   - total estimated remaining allowance
   - connected providers
   - last sync time
   - stale/manual-only providers
3. Add the provider cards grid.
4. Add the detail drawer or side panel.
5. Add the manual override form.
6. Add the settings/connections section with provider-specific guidance.
7. Make sure the copy is honest about unit type:
   - tokens where true token counts exist
   - messages/requests/credits/allowance where they do not

### Phase 4: Sync, conflict, and staleness behavior

1. Implement refresh flows that update synced data without destroying manual state.
2. Show manual and synced values together when they differ.
3. Add explicit actions for:
   - use synced value
   - keep manual value
4. Mark stale states when:
   - the source has not synced within threshold
   - credentials expire or change
   - provider data is incomplete
5. Surface retries and fallback actions without clearing the last known value prematurely.

### Phase 5: Connection guidance and provider-specific UX

1. Create connection cards per provider.
2. Add provider-specific notes and setup guidance.
3. Include example payloads or example connection states where helpful.
4. Show a plain-language fallback when a provider lacks a stable connector.
5. Keep the copy concise and actionable.

### Phase 6: Validation and polish

1. Verify all state badges and labels are visually distinct.
2. Confirm keyboard accessibility for cards, drawers, and actions.
3. Confirm screen-reader labels for status and numbers.
4. Test empty, disconnected, stale, error, and manual-only states.
5. Confirm the dashboard matches Hermes UI styling:
   - dark background
   - bordered cards
   - compact hierarchy
   - measured color usage

## Data contract

### Canonical subscription fields

- `provider_id`
- `provider_name`
- `metric_kind`
- `display_unit`
- `remaining`
- `limit`
- `used`
- `reset_at` or `renewal_at`
- `sync_status`
- `source_type`
- `source_updated_at`
- `confidence`
- `notes`
- `last_error`

### History record fields

- `event_type` — sync, manual_update, connect, disconnect, error
- `created_at`
- `source_type`
- `before_value`
- `after_value`
- `summary`
- `details`

## UI requirements

### Summary bar

- total remaining allowance
- connected provider count
- last sync freshness
- stale/manual-only count

### Provider card

- name and icon
- status badge
- active value
- secondary value when there is a conflict
- usage bar or progress ring
- source label
- last sync line
- actions: refresh, edit manually, connect/disconnect

### Detail panel

- current value and history
- connector state
- edit form
- sync controls
- troubleshooting tips

### Manual override form

- remaining value
- total limit
- reset date
- note field
- save/cancel

## Security and privacy requirements

- Do not expose raw secrets in the UI.
- Encrypt persisted credentials at rest.
- Avoid logging tokens, cookies, or imported session data.
- Treat browser-import flows as user-approved and revocable.

## Acceptance criteria

1. The dashboard clearly shows remaining allowance for Xiaomi MiMo, ChatGPT Plus, Cursor, and Google AI.
2. Each provider has an obvious sync status badge and provenance label.
3. Manual override persists when sync is unavailable and can be re-applied or replaced explicitly.
4. Sync history and staleness are visible for every provider.
5. Providers without a stable API are still useful through manual tracking.
6. The page feels visually consistent with the existing Hermes web UI.
7. The UI distinguishes true token balances from usage-limit or allowance-based metrics when providers do not expose a raw token count.
8. The API response does not leak sensitive connector material.

## Suggested implementation order

1. Data model + API contract
2. History tracking
3. Provider adapters
4. UI shell and summary cards
5. Provider detail drawer and manual editing
6. Connection guidance and provider-specific copy
7. Accessibility and polish
8. Validation against acceptance criteria

## Open questions to resolve during implementation

- Which route should ship first: `/subscriptions` or `/tokens`?
- Which providers have a stable connector today versus manual-only support?
- Should browser-import support be a first-class connector or an implementation detail?
- Do we want one shared detail drawer or provider-specific panels?
- Are there provider-specific freshness thresholds beyond the default 24 hours?
