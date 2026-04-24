import { describe, expect, it } from 'vitest'

import {
  adaptChatGPTPlusSubscription,
  adaptCursorSubscription,
  adaptGoogleAISubscription,
  adaptProviderSubscription,
  adaptXiaomiMiMoSubscription,
  type ChatGPTPlusSnapshot,
  type CursorSnapshot,
  getSubscriptionAdapter,
  type GoogleAISnapshot,
  providerSubscriptionAdapters,
  type XiaomiMiMoSnapshot
} from '../domain/subscriptionAdapters.js'
import { normalizeSubscription } from '../domain/subscriptions.js'

const NOW = 1_700_000_000_000
const HOUR = 60 * 60 * 1000

const expectCanonicalShape = (providerId: string, providerName: string, subscription: ReturnType<typeof normalizeSubscription>) => {
  expect(subscription).toMatchObject({
    confidence: expect.any(String),
    connection: expect.any(Object),
    displayUnit: expect.any(String),
    metricKind: expect.any(String),
    notes: expect.any(Array),
    providerId,
    providerName,
    sourceUpdatedAt: expect.any(Number),
    staleAfterMs: expect.any(Number),
    status: expect.any(String)
  })
}

describe('subscription provider adapters', () => {
  it('normalizes Xiaomi MiMo API snapshots into synced token records', () => {
    const snapshot: XiaomiMiMoSnapshot = {
      apiKeyLabel: 'MiMo prod key',
      planCapTokens: 20_000,
      providerId: 'xiaomi_mimo-subscription',
      providerName: 'Xiaomi MiMo',
      remainingTokens: 12_400,
      sourceType: 'api',
      sourceUpdatedAt: NOW - HOUR,
      usedTokens: 7_600
    }

    const result = adaptXiaomiMiMoSubscription(snapshot, NOW)
    const record = normalizeSubscription(result.subscription, NOW)

    expectCanonicalShape(snapshot.providerId, snapshot.providerName, record)
    expect(record).toMatchObject({
      activeSource: 'synced',
      confidence: 'high',
      displayUnit: 'tokens',
      metricKind: 'tokens',
      status: 'synced'
    })
    expect(record.connection).toMatchObject({
      connected: true,
      connectorKind: 'api',
      label: 'MiMo prod key'
    })
    expect(record.syncedValue).toMatchObject({
      limit: 20_000,
      metricKind: 'tokens',
      remaining: 12_400,
      sourceType: 'api',
      used: 7_600
    })
    expect(result.capabilities.supportedConnectorKinds).toEqual(expect.arrayContaining(['api', 'manual']))
    expect(result.connectorGuides.map(guide => guide.connectorKind)).toEqual(['api', 'manual'])
  })

  it('normalizes ChatGPT Plus browser-import snapshots as honest message trackers', () => {
    const snapshot: ChatGPTPlusSnapshot = {
      messageCap: 100,
      messagesUsed: 26,
      providerId: 'chatgpt_plus-subscription',
      providerName: 'ChatGPT Plus',
      remainingMessages: 74,
      sourceType: 'browser-import',
      sourceUpdatedAt: NOW - 2 * HOUR
    }

    const result = adaptChatGPTPlusSubscription(snapshot, NOW)
    const record = normalizeSubscription(result.subscription, NOW)

    expectCanonicalShape(snapshot.providerId, snapshot.providerName, record)
    expect(record).toMatchObject({
      activeSource: 'synced',
      confidence: 'medium',
      displayUnit: 'messages',
      metricKind: 'messages',
      status: 'synced'
    })
    expect(record.connection).toMatchObject({
      connected: true,
      connectorKind: 'browser-import'
    })
    expect(record.syncedValue).toMatchObject({
      limit: 100,
      metricKind: 'messages',
      remaining: 74,
      sourceType: 'browser-import',
      used: 26
    })
    expect(result.capabilities.supportedConnectorKinds).toEqual(expect.arrayContaining(['browser-import', 'manual', 'oauth']))
  })

  it('supports manual-only Cursor trackers without inventing a sync source', () => {
    const snapshot: CursorSnapshot = {
      creditsUsed: 11,
      providerId: 'cursor-subscription',
      providerName: 'Cursor',
      remainingCredits: 9,
      requestCap: 20,
      requestsUsed: 11,
      sourceType: 'manual',
      sourceUpdatedAt: NOW - HOUR
    }

    const result = adaptCursorSubscription(snapshot, NOW)
    const record = normalizeSubscription(result.subscription, NOW)

    expectCanonicalShape(snapshot.providerId, snapshot.providerName, record)
    expect(record).toMatchObject({
      activeSource: 'manual',
      confidence: 'low',
      displayUnit: 'credits',
      metricKind: 'credits',
      status: 'manual'
    })
    expect(record.connection).toMatchObject({
      connected: false,
      connectorKind: 'manual'
    })
    expect(record.manualValue).toMatchObject({
      limit: 20,
      metricKind: 'credits',
      remaining: 9,
      sourceType: 'manual',
      used: 11
    })
    expect(record.syncedValue).toBeNull()
    expect(result.capabilities.supportedConnectorKinds).toEqual(expect.arrayContaining(['api', 'browser-import', 'manual', 'oauth']))
  })

  it('marks Google AI snapshots stale or errored when the source is old or failing', () => {
    const snapshot: GoogleAISnapshot = {
      lastError: 'quota fetch rate-limited',
      providerId: 'google_ai-subscription',
      providerName: 'Google AI',
      quotaCapTokens: 2_000,
      remainingTokens: 1_800,
      sourceType: 'oauth',
      sourceUpdatedAt: NOW - 30 * HOUR,
      tokensUsed: 200
    }

    const result = adaptGoogleAISubscription(snapshot, NOW)
    const record = normalizeSubscription(result.subscription, NOW)

    expectCanonicalShape(snapshot.providerId, snapshot.providerName, record)
    expect(record).toMatchObject({
      confidence: 'low',
      displayUnit: 'tokens',
      lastError: 'quota fetch rate-limited',
      metricKind: 'tokens',
      status: 'error'
    })
    expect(record.connection).toMatchObject({
      connected: true,
      connectorKind: 'oauth',
      lastError: 'quota fetch rate-limited'
    })
    expect(result.capabilities.supportedConnectorKinds).toEqual(expect.arrayContaining(['api', 'manual', 'oauth']))
  })

  it('dispatches through the provider registry', () => {
    const viaRegistry = adaptProviderSubscription('xiaomi_mimo', {
      providerId: 'xiaomi_mimo-subscription',
      providerName: 'Xiaomi MiMo',
      remainingTokens: 500,
      sourceType: 'api',
      sourceUpdatedAt: NOW
    }, NOW)

    const direct = adaptXiaomiMiMoSubscription({
      providerId: 'xiaomi_mimo-subscription',
      providerName: 'Xiaomi MiMo',
      remainingTokens: 500,
      sourceType: 'api',
      sourceUpdatedAt: NOW
    }, NOW)

    expect(viaRegistry.subscription).toEqual(direct.subscription)
    expect(getSubscriptionAdapter('xiaomi_mimo').providerName).toBe('Xiaomi MiMo')
    expect(Object.keys(providerSubscriptionAdapters)).toEqual(['chatgpt_plus', 'cursor', 'google_ai', 'xiaomi_mimo'])
  })
})
