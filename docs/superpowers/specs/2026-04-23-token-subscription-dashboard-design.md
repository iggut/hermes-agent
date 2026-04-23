# Token Subscription Dashboard Design

Date: 2026-04-23
Status: Draft for review

## Summary

Build a new dashboard inside the existing Hermes web UI that tracks remaining allowance across four subscriptions:

- Xiaomi MiMo
- ChatGPT Plus
- Cursor
- Google AI

The experience should feel professional, calm, and coherent with the current Hermes dashboard design system. The key behavior is **hybrid tracking**: sync automatically when a provider connection exists, but always allow manual override so the dashboard remains useful even when a provider has no stable API or the account cannot be connected.

## Goals

1. Show a fast, polished overview of remaining allowance across all subscriptions.
2. Make it obvious which values are synced, manually entered, or stale.
3. Support provider-specific connection flows where they exist.
4. Allow manual edits to override synced values without breaking the sync history.
5. Use a consistent UI language with the existing Hermes web app.
6. Provide connection examples and guidance so the user can understand how each provider is wired.

## Non-goals

- Replacing provider dashboards entirely.
- Guaranteeing a true "tokens left" API for every provider.
- Building a billing or invoice system.
- Creating a mobile-specific experience in this phase.

## UX principles

- **Overview first:** the main page should answer "how much do I have left?" immediately.
- **Progressive disclosure:** details and connection steps are secondary.
- **Clear provenance:** every number should say where it came from.
- **Forgiving editing:** users should be able to correct numbers manually at any time.
- **Professional density:** enough information for power users, but not visually noisy.
- **Consistent styling:** reuse the Hermes dashboard palette, spacing, card patterns, and badge language.

## Information architecture

### Proposed navigation

Add a new top-level route in the existing web app, for example:

- `/subscriptions` or `/tokens`

Suggested nav label:

- **Subscriptions** or **Tokens**

### Page structure

1. **Global summary bar**
   - Total estimated remaining allowance across all subscriptions
   - Number of connected providers
   - Last sync time
   - Number of stale/manual-only providers

2. **Provider cards grid**
   - One card per subscription
   - Color-coded status badge
   - Remaining allowance
   - Usage / cap / reset info where available
   - Sync source label
   - Quick actions: refresh, edit manually, connect/disconnect

3. **Detail panel or drawer**
   - Connection instructions
   - Sync history / last updated
   - Manual override form
   - Provider-specific notes

4. **Settings / connections section**
   - List of available connector types
   - API key / OAuth / browser import guidance
   - Example payloads or example connection states

## Visual design direction

Keep the same design language as the current Hermes web app:

- dark, refined dashboard background
- bordered cards with subtle contrast
- compact typography and strong hierarchy
- badges for state and trust level
- small icons for scanability
- measured use of color for warning/healthy states

### Core visual states

- **Synced:** green/teal badge, "Synced X min ago"
- **Manual:** neutral badge, "Manual override"
- **Stale:** amber badge, "Last sync older than threshold"
- **Disconnected:** muted red or gray badge, "Not connected"
- **Error:** red badge, with inline retry action

## Data model

The dashboard should normalize provider data into a common model so the UI can stay coherent even when each subscription reports different units.

### Canonical fields

- `provider_id`
- `provider_name`
- `display_unit` — tokens, messages, requests, credits, or allowance
- `remaining`
- `limit`
- `used`
- `reset_at` or `renewal_at`
- `sync_status` — synced, manual, stale, disconnected, error
- `source_type` — api, oauth, browser-import, manual
- `source_updated_at`
- `confidence` — high, medium, low
- `notes`
- `last_error`

### Display rule

The UI should show both:

1. the normalized remaining number, and
2. the provider-native unit when it matters.

Example:

- `12,400 tokens left`
- `74 / 100 messages remaining`
- `1.8K credits left`

If a provider does not expose a true token count, the UI should label the metric honestly rather than forcing a fake token conversion.

## Hybrid sync behavior

### Sync precedence

1. Use provider sync if a valid connector exists.
2. If sync fails or is unavailable, fall back to the last known manual value.
3. Manual overrides always win visually until the next successful sync.
4. Keep sync history so the user can see when a manual value replaced a synced value.

### Conflict handling

If both synced and manual values exist:

- display the current active value prominently
- show the other value in a secondary line
- allow the user to choose "use synced value" or "keep manual value"

### Staleness policy

Mark a subscription as stale when:

- the source has not synced within a configurable threshold
- the account token changed or expired
- the provider returns incomplete data

## Provider-specific design notes

The connectors should be designed per provider rather than pretending they are all identical.

### 1) Xiaomi MiMo

**Primary intent:** sync account or plan usage when a stable provider connection is available.

UI should support:
- connection card
- API key or token-based setup if supported
- a "test connection" action
- a manual fallback if the endpoint is unavailable

Show fields such as:
- remaining tokens
- quota or plan cap
- last sync time
- source confidence

### 2) ChatGPT Plus

**Primary intent:** track a practical remaining allowance even if the exact token balance is not publicly exposed.

Likely behavior:
- manual entry is the baseline
- sync may come from a browser-import, usage snapshot, or future connector if one is available
- if only usage windows or message caps are available, show that honestly as the effective allowance

UI should make it clear that this may be a **limit/usage tracker** rather than a raw token balance tracker.

### 3) Cursor

**Primary intent:** track the current plan usage / allowance in a clean, developer-friendly way.

Likely behavior:
- connector may rely on account metadata, local usage data, or a manual override
- show whether the value is sourced from a login session, imported record, or manual edit
- if true token counts are not accessible, display request/credit allowance instead

### 4) Google AI

**Primary intent:** sync API or quota usage where available.

This is the most likely to support a clear technical connector.

UI should support:
- API key / project connection flow
- usage limit and reset window
- tokens used vs tokens remaining
- last successful fetch

## Connection examples / guidance

The user mentioned that the existing web UI might have connection examples. The design should reuse that idea by providing a dedicated "Connect" area on each provider card and a central help drawer.

Each provider should show:

- a short explanation of the connector type
- a sample connection state
- required credentials
- optional environment variables or setup steps
- a "Copy example" action when there is sample config

### Example content pattern

- **Connect with API key**
- **Connect with OAuth**
- **Import from browser session**
- **Manual tracking only**

If a provider does not support a direct connector, the UI should say so plainly and provide the best fallback path.

## Suggested backend/API shape

A single dashboard API should return a normalized list of subscriptions.

### Example endpoints

- `GET /api/subscriptions`
- `PUT /api/subscriptions/:id` for manual overrides
- `POST /api/subscriptions/:id/sync` for one-off refresh
- `POST /api/subscriptions/:id/connect` for connector setup
- `DELETE /api/subscriptions/:id/connection` for disconnect

### Example response shape

```json
{
  "subscriptions": [
    {
      "provider_id": "google_ai",
      "provider_name": "Google AI",
      "display_unit": "tokens",
      "remaining": 18234,
      "limit": 50000,
      "used": 31766,
      "sync_status": "synced",
      "source_type": "api",
      "source_updated_at": "2026-04-23T17:10:00Z",
      "confidence": "high",
      "reset_at": "2026-05-01T00:00:00Z",
      "notes": "Synced from project quota"
    }
  ]
}
```

## Component breakdown

### Summary cards

- total remaining allowance
- connected providers
- stale providers
- last sync freshness

### Provider card

- name and logo/icon
- status badge
- remaining value
- usage bar or progress ring
- source label
- last sync line
- action buttons

### Detail drawer

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
- save / cancel

## Accessibility

- High contrast badges and text
- Keyboard-accessible card actions
- Focus states on edit and connect actions
- Screen-reader labels for status and numeric fields
- No information conveyed by color alone

## Error and empty states

### Empty state

If nothing is connected yet:

- friendly headline
- short explanation of hybrid tracking
- list of providers with a primary "Connect" action
- fallback "Add manually" action

### Error state

If sync fails:

- do not clear the last known value immediately
- show a non-blocking error badge
- provide retry and manual fallback

## Acceptance criteria

1. The dashboard clearly shows remaining allowance for Xiaomi MiMo, ChatGPT Plus, Cursor, and Google AI.
2. Each provider has an obvious sync status.
3. Manual override works even when sync is unavailable.
4. Sync history and staleness are visible.
5. The page feels visually consistent with the existing Hermes web UI.
6. Providers without a stable API are still useful through manual tracking.

## Open questions for implementation

1. Which providers have a stable, supportable API or connector today?
2. Do we want the route to be `/subscriptions` or `/tokens`?
3. Should ChatGPT Plus and Cursor be treated as usage-limit trackers rather than strict token balances when necessary?
4. Do we want browser-import helpers for providers that lack public APIs?
5. Should the dashboard live as a built-in page or as a plugin module?

## Recommendation

Implement this as a built-in Hermes dashboard page first, with a shared normalized subscription model and provider-specific connector adapters underneath. That gives the cleanest UI, keeps the product coherent, and preserves flexibility for manual fallback when provider APIs are missing or incomplete.
