import { describe, expect, it } from 'vitest'

import { buildSubscriptionDashboardModel } from '../domain/subscriptionDashboard.js'

describe('subscription connection guidance', () => {
  it('surfaces provider-specific setup guidance and plain-language fallback copy', () => {
    const model = buildSubscriptionDashboardModel([], 1_700_000_000_000)

    const providers = Object.fromEntries(model.cards.map(card => [card.providerId, card]))

    expect(Object.keys(providers)).toEqual(['chatgpt_plus', 'cursor', 'google_ai', 'xiaomi_mimo'])

    expect(providers.chatgpt_plus.connectorGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorKind: 'browser-import',
          exampleState: expect.stringContaining('Imported browser usage snapshot'),
          title: 'Import from browser session'
        }),
        expect.objectContaining({
          connectorKind: 'manual',
          exampleState: expect.stringContaining('Manual message-cap tracker'),
          title: 'Manual tracking'
        })
      ])
    )

    expect(providers.cursor.connectorGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorKind: 'api',
          requiredCredentials: expect.arrayContaining(['API key', 'workspace identifier']),
          title: 'Connect with API key'
        }),
        expect.objectContaining({
          connectorKind: 'browser-import',
          exampleState: expect.stringContaining('Imported local account record'),
          title: 'Import usage snapshot'
        })
      ])
    )

    expect(providers.google_ai.connectorGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorKind: 'oauth',
          exampleState: expect.stringContaining('OAuth-linked project quota snapshot'),
          title: 'Connect with OAuth'
        })
      ])
    )

    expect(providers.xiaomi_mimo.connectorGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          connectorKind: 'api',
          exampleState: expect.stringContaining('Connected via API key'),
          title: 'Connect with API key'
        }),
        expect.objectContaining({
          connectorKind: 'manual',
          exampleState: expect.stringContaining('Manual tracking only'),
          title: 'Manual fallback'
        })
      ])
    )
  })
})
