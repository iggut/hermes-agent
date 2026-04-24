import { beforeEach, describe, expect, it } from 'vitest'

import type { GatewayRpc } from '../app/interfaces.js'
import { hydrateSubscriptionDashboard } from '../app/subscriptionApi.js'
import { clearSubscriptionState, getSubscriptionHistory, getSubscriptions } from '../app/subscriptionStore.js'
import type { SubscriptionHistoryEntry, SubscriptionRecord } from '../domain/subscriptions.js'

const makeRecord = (providerId: string, providerName: string): SubscriptionRecord => ({
  activeSource: 'manual',
  confidence: 'medium',
  connection: {
    connected: false,
    connectorKind: 'manual',
    lastCheckedAt: 1_700_000_000_000,
    label: `${providerName} manual tracking`
  },
  displayUnit: 'allowance',
  manualValue: null,
  metricKind: 'allowance',
  notes: [`${providerName} dashboard entry`],
  providerId,
  providerName,
  sourceUpdatedAt: 1_700_000_000_000,
  staleAfterMs: 24 * 60 * 60 * 1000,
  status: 'disconnected',
  syncedValue: null
})

beforeEach(() => {
  clearSubscriptionState()
})

describe('subscription gateway hydration', () => {
  it('hydrates the dashboard and histories from gateway RPCs', async () => {
    const cursorHistory: SubscriptionHistoryEntry[] = [
      {
        afterValue: null,
        beforeValue: null,
        createdAt: 1_700_000_000_100,
        eventType: 'manual_update',
        id: 'evt-1',
        providerId: 'cursor',
        sourceType: 'manual',
        summary: 'Manual override set'
      }
    ]

    const rpc: GatewayRpc = async (method, params) => {
      if (method === 'subscriptions.list') {
        return {
          subscriptions: [
            makeRecord('cursor', 'Cursor'),
            makeRecord('chatgpt_plus', 'ChatGPT Plus')
          ]
        }
      }

      if (method === 'subscriptions.history' && params?.provider_id === 'cursor') {
        return { history: cursorHistory, provider_id: 'cursor' }
      }

      if (method === 'subscriptions.history') {
        return { history: [], provider_id: String(params?.provider_id ?? '') }
      }

      return null
    }

    await hydrateSubscriptionDashboard(rpc)

    expect(getSubscriptions()).toHaveLength(2)
    expect(getSubscriptions()[0].providerId).toBe('cursor')
    expect(getSubscriptionHistory('cursor')).toEqual(cursorHistory)
    expect(getSubscriptionHistory('chatgpt_plus')).toEqual([])
  })
})
