import { type ProviderConnectorGuide, type ProviderId, providerSubscriptionAdapters } from './subscriptionAdapters.js'
import type { SourceType, SubscriptionRecord, SubscriptionSummary } from './subscriptions.js'
import { normalizeSubscription, summarizeSubscriptions } from './subscriptions.js'

export interface SubscriptionDashboardCard {
  connectorGuides: ProviderConnectorGuide[]
  manualFallback: boolean
  providerId: ProviderId
  providerName: string
  record: SubscriptionRecord
  supportedConnectorKinds: readonly SourceType[]
  syncAvailable: boolean
}

export interface SubscriptionDashboardModel {
  cards: SubscriptionDashboardCard[]
  summary: SubscriptionSummary
}

const PROVIDER_NAMES: Record<ProviderId, string> = {
  chatgpt_plus: 'ChatGPT Plus',
  cursor: 'Cursor',
  google_ai: 'Google AI',
  xiaomi_mimo: 'Xiaomi MiMo'
}

const providerOrder = Object.keys(providerSubscriptionAdapters) as ProviderId[]

export function buildSubscriptionDashboardModel(subscriptions: readonly SubscriptionRecord[], now = Date.now()): SubscriptionDashboardModel {
  const records = new Map(subscriptions.map(record => [record.providerId as ProviderId, record]))

  const cards = providerOrder.map(providerId => {
    const adapter = providerSubscriptionAdapters[providerId]
    const record = records.get(providerId) ?? normalizeSubscription({ providerId, providerName: PROVIDER_NAMES[providerId] }, now)

    return {
      connectorGuides: adapter.connectorGuides,
      manualFallback: adapter.capabilities.manualFallback,
      providerId,
      providerName: PROVIDER_NAMES[providerId],
      record,
      supportedConnectorKinds: adapter.capabilities.supportedConnectorKinds,
      syncAvailable: adapter.capabilities.syncAvailable
    }
  })

  const summary = summarizeSubscriptions(cards.map(card => card.record), now)

  return { cards, summary }
}
