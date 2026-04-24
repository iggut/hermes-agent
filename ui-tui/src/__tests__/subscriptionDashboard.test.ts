import { describe, expect, it } from 'vitest'

import { buildSubscriptionDashboardModel } from '../domain/subscriptionDashboard.js'
import { normalizeSubscription } from '../domain/subscriptions.js'

describe('subscription dashboard model', () => {
  it('builds a four-provider dashboard and preserves existing subscription records', () => {
    const cursor = normalizeSubscription(
      {
        connection: {
          connected: true,
          connectorKind: 'api',
          label: 'Cursor workspace'
        },
        manualValue: null,
        providerId: 'cursor',
        providerName: 'Cursor',
        syncedValue: {
          confidence: 'high',
          displayUnit: 'credits',
          limit: 20,
          metricKind: 'credits',
          notes: ['API sync'],
          remaining: 12,
          sourceType: 'api'
        }
      },
      1_700_000_000_000
    )

    const model = buildSubscriptionDashboardModel([cursor], 1_700_000_000_000)

    expect(model.cards).toHaveLength(4)
    expect(model.summary).toMatchObject({
      connectedProviders: 1,
      totalRemaining: 12
    })
    expect(model.cards.find(card => card.providerId === 'cursor')?.record).toEqual(cursor)
    expect(model.cards.find(card => card.providerId === 'chatgpt_plus')?.providerName).toBe('ChatGPT Plus')
  })
})
