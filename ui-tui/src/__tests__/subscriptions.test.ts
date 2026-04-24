import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyActiveSourceSelection,
  applyManualOverride,
  applySyncResult,
  clearSubscriptionState,
  disconnectSubscriptionRecord,
  getSubscriptionHistory,
  getSubscriptions,
  getSubscriptionSummary,
  recordSubscriptionEvent,
  setSubscriptions,
  upsertSubscription
} from '../app/subscriptionStore.js'
import {
  hasSubscriptionValueConflict,
  normalizeSubscription,
  resolveActiveValue,
  setSubscriptionActiveSource,
  type SubscriptionDraft,
  type SubscriptionValue,
  summarizeSubscriptions
} from '../domain/subscriptions.js'

const makeValue = (overrides: Partial<SubscriptionValue> = {}): SubscriptionValue => ({
  confidence: 'high',
  displayUnit: 'tokens',
  metricKind: 'tokens',
  notes: [],
  remaining: 100,
  sourceType: 'api',
  sourceUpdatedAt: 1_700_000_000_000,
  ...overrides
})

const makeDraft = (overrides: Partial<SubscriptionDraft> & Pick<SubscriptionDraft, 'providerId' | 'providerName'>): SubscriptionDraft => ({
  activeSource: 'manual',
  confidence: 'high',
  connection: { connected: true, connectorKind: 'api', connectedAt: 1_700_000_000_000 },
  displayUnit: 'tokens',
  manualValue: makeValue({ remaining: 80, sourceType: 'manual', displayUnit: 'allowance' }),
  metricKind: 'tokens',
  notes: ['keep an eye on this'],
  sourceUpdatedAt: 1_700_000_000_500,
  staleAfterMs: 24 * 60 * 60 * 1000,
  status: 'manual',
  syncedValue: makeValue({ remaining: 120 }),
  ...overrides
})

describe('subscription foundation', () => {
  beforeEach(() => {
    clearSubscriptionState()
  })

  it('normalizes synced and manual values independently and keeps the active source explicit', () => {
    const record = normalizeSubscription(
      makeDraft({ providerId: 'google_ai', providerName: 'Google AI' }),
      1_700_000_001_000
    )

    expect(record.providerId).toBe('google_ai')
    expect(record.metricKind).toBe('tokens')
    expect(record.displayUnit).toBe('tokens')
    expect(record.activeSource).toBe('manual')
    expect(record.syncedValue?.remaining).toBe(120)
    expect(record.manualValue?.remaining).toBe(80)
    expect(resolveActiveValue(record)?.remaining).toBe(80)
  })


  it('lets the user explicitly switch between manual and synced values without discarding either source', () => {
    const record = normalizeSubscription(
      {
        activeSource: 'manual',
        manualValue: makeValue({ remaining: 80, sourceType: 'manual' }),
        providerId: 'cursor',
        providerName: 'Cursor',
        syncedValue: makeValue({ remaining: 120, sourceType: 'api' })
      },
      1_700_000_000_000
    )

    const synced = setSubscriptionActiveSource(record, 'synced', 1_700_000_000_100)
    expect(synced.activeSource).toBe('synced')
    expect(synced.syncedValue?.remaining).toBe(120)
    expect(synced.manualValue?.remaining).toBe(80)
    expect(resolveActiveValue(synced)?.remaining).toBe(120)

    const manual = setSubscriptionActiveSource(synced, 'manual', 1_700_000_000_200)
    expect(manual.activeSource).toBe('manual')
    expect(manual.syncedValue?.remaining).toBe(120)
    expect(manual.manualValue?.remaining).toBe(80)
    expect(resolveActiveValue(manual)?.remaining).toBe(80)
  })

  it('detects when manual and synced values diverge so the dashboard can show a conflict banner', () => {
    const record = normalizeSubscription(
      {
        activeSource: 'manual',
        manualValue: makeValue({ remaining: 80, sourceType: 'manual' }),
        providerId: 'google_ai',
        providerName: 'Google AI',
        syncedValue: makeValue({ remaining: 120, sourceType: 'api' })
      },
      1_700_000_000_000
    )

    expect(hasSubscriptionValueConflict(record)).toBe(true)
    expect(hasSubscriptionValueConflict(normalizeSubscription({ providerId: 'cursor', providerName: 'Cursor' }, 1_700_000_000_000))).toBe(false)
  })

  it('summarizes totals, staleness, and manual-only coverage', () => {
    const records = [
      normalizeSubscription(
        makeDraft({
          connection: { connected: true, connectorKind: 'oauth', connectedAt: 1_700_000_000_000 },
          manualValue: null,
          providerId: 'google_ai',
          providerName: 'Google AI',
          syncedValue: makeValue({ remaining: 250 })
        }),
        1_700_000_001_000
      ),
      normalizeSubscription(
        makeDraft({
          activeSource: 'manual',
          connection: { connected: false, connectorKind: 'manual' },
          providerId: 'cursor',
          providerName: 'Cursor',
          syncedValue: null
        }),
        1_700_000_001_000
      )
    ]

    const summary = summarizeSubscriptions(records, 1_700_000_001_000)
    expect(summary.connectedProviders).toBe(1)
    expect(summary.manualOnlyProviders).toBe(1)
    expect(summary.totalRemaining).toBe(330)
    expect(summary.lastSyncAt).toBe(1_700_000_000_500)
  })

  it('applies sync updates without overwriting the active manual state', () => {
    setSubscriptions([
      makeDraft({ providerId: 'mimo', providerName: 'Xiaomi MiMo' })
    ])

    const next = applySyncResult(
      'mimo',
      makeValue({ remaining: 140, sourceType: 'api', sourceUpdatedAt: 1_700_000_002_000 }),
      { summary: 'Refreshed MiMo allowance' },
      1_700_000_002_000
    )

    expect(next?.activeSource).toBe('manual')
    expect(next?.syncedValue?.remaining).toBe(140)
    expect(next?.manualValue?.remaining).toBe(80)
    expect(getSubscriptionHistory('mimo')).toHaveLength(1)
    expect(getSubscriptions()[0]?.syncedValue?.remaining).toBe(140)
  })

  it('records manual overrides and disconnects in history', () => {
    upsertSubscription(makeDraft({ providerId: 'chatgpt_plus', providerName: 'ChatGPT Plus' }))

    const updated = applyManualOverride(
      'chatgpt_plus',
      makeValue({ remaining: 55, sourceType: 'manual', displayUnit: 'messages', metricKind: 'messages' }),
      { summary: 'Manual allowance adjusted' },
      1_700_000_003_000
    )

    expect(updated?.manualValue?.remaining).toBe(55)
    expect(getSubscriptionHistory('chatgpt_plus')[0]?.eventType).toBe('manual_update')

    const disconnected = disconnectSubscriptionRecord('chatgpt_plus', 1_700_000_004_000)
    expect(disconnected?.status).toBe('disconnected')
    expect(getSubscriptionHistory('chatgpt_plus')[0]?.eventType).toBe('disconnect')
  })

  it('allows direct history writes for API-driven events', () => {
    const entry = recordSubscriptionEvent(
      {
        afterValue: makeValue({ remaining: 42 }),
        eventType: 'sync',
        providerId: 'google_ai',
        sourceType: 'api',
        summary: 'Nightly sync completed'
      },
      1_700_000_005_000
    )

    expect(entry.providerId).toBe('google_ai')
    expect(getSubscriptionHistory('google_ai')[0]?.summary).toBe('Nightly sync completed')
  })

  it('keeps selection changes and history events separate from the underlying sync/manual values', () => {
    upsertSubscription(
      normalizeSubscription(
        {
          activeSource: 'manual',
          manualValue: makeValue({ remaining: 80, sourceType: 'manual' }),
          providerId: 'cursor',
          providerName: 'Cursor',
          syncedValue: makeValue({ remaining: 120, sourceType: 'api' })
        },
        1_700_000_000_000
      )
    )

    const next = applyActiveSourceSelection('cursor', 'synced', {
      summary: 'Synced value selected from dashboard'
    })

    expect(next?.activeSource).toBe('synced')
    expect(next?.manualValue?.remaining).toBe(80)
    expect(next?.syncedValue?.remaining).toBe(120)
    expect(resolveActiveValue(next!).remaining).toBe(120)
    expect(getSubscriptionHistory('cursor')[0]?.summary).toBe('Synced value selected from dashboard')
  })

  it('keeps the summary atom in sync with the normalized records', () => {
    setSubscriptions([
      makeDraft({ providerId: 'google_ai', providerName: 'Google AI' }),
      makeDraft({ providerId: 'cursor', providerName: 'Cursor', connection: { connected: false, connectorKind: 'manual' }, syncedValue: null })
    ])

    const summary = getSubscriptionSummary(1_700_000_001_000)
    expect(summary.connectedProviders).toBe(1)
    expect(summary.manualOnlyProviders).toBe(1)
    expect(summary.totalRemaining).toBeGreaterThan(0)
  })
})
