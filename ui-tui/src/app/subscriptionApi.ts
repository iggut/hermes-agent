import type {
  SubscriptionConnectRequest,
  SubscriptionConnectResponse,
  SubscriptionDisconnectRequest,
  SubscriptionDisconnectResponse,
  SubscriptionHistoryResponse,
  SubscriptionListResponse,
  SubscriptionSyncRequest,
  SubscriptionSyncResponse,
  SubscriptionUpdateRequest,
  SubscriptionUpdateResponse
} from '../gatewayTypes.js'

import type { GatewayRpc } from './interfaces.js'
import { setSubscriptionHistory, setSubscriptions } from './subscriptionStore.js'

export async function hydrateSubscriptionDashboard(rpc: GatewayRpc, now = Date.now()) {
  const response = await rpc<SubscriptionListResponse>('subscriptions.list', {})

  if (!response?.subscriptions?.length) {
    return response
  }

  setSubscriptions(response.subscriptions, now)

  await Promise.all(
    response.subscriptions.map(async subscription => {
      const history = await rpc<SubscriptionHistoryResponse>('subscriptions.history', {
        provider_id: subscription.providerId
      })

      if (history?.history?.length) {
        setSubscriptionHistory(subscription.providerId, history.history)
      }
    })
  )

  return response
}

export async function persistSubscriptionUpdate(rpc: GatewayRpc, request: SubscriptionUpdateRequest) {
  return rpc<SubscriptionUpdateResponse>('subscriptions.update', request as unknown as Record<string, unknown>)
}

export async function persistSubscriptionConnect(rpc: GatewayRpc, request: SubscriptionConnectRequest) {
  return rpc<SubscriptionConnectResponse>('subscriptions.connect', request as unknown as Record<string, unknown>)
}

export async function persistSubscriptionDisconnect(rpc: GatewayRpc, request: SubscriptionDisconnectRequest) {
  return rpc<SubscriptionDisconnectResponse>('subscriptions.disconnect', request as unknown as Record<string, unknown>)
}

export async function persistSubscriptionSync(rpc: GatewayRpc, request: SubscriptionSyncRequest) {
  return rpc<SubscriptionSyncResponse>('subscriptions.sync', request as unknown as Record<string, unknown>)
}
