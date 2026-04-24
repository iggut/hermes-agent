import { Box, NoSelect, ScrollBox, Text, useInput, useStdout } from '@hermes/ink'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'

import { useGateway } from '../app/gatewayContext.js'
import { $overlayState } from '../app/overlayStore.js'
import {
  hydrateSubscriptionDashboard,
  persistSubscriptionDisconnect,
  persistSubscriptionSync,
  persistSubscriptionUpdate
} from '../app/subscriptionApi.js'
import {
  $subscriptionHistory,
  $subscriptions,
  applyActiveSourceSelection,
  applyManualOverride,
  disconnectSubscriptionRecord,
  upsertSubscription
} from '../app/subscriptionStore.js'
import { buildSubscriptionDashboardModel } from '../domain/subscriptionDashboard.js'
import { hasSubscriptionValueConflict, isStale, resolveActiveValue, type SubscriptionValue } from '../domain/subscriptions.js'
import type { Theme } from '../theme.js'

import { FloatBox } from './appChrome.js'
import { TextInput } from './textInput.js'

const MIN_WIDTH = 92
const MAX_WIDTH = 132
const LIST_WIDTH = 45

const statusTone: Record<string, 'cyan' | 'green' | 'magenta' | 'red' | 'yellow'> = {
  disconnected: 'yellow',
  error: 'red',
  manual: 'magenta',
  stale: 'yellow',
  synced: 'green'
}

const statusText: Record<string, string> = {
  disconnected: 'Disconnected',
  error: 'Error',
  manual: 'Manual',
  stale: 'Stale',
  synced: 'Synced'
}

const sourceLabel: Record<string, string> = {
  manual: 'manual',
  synced: 'synced'
}

const statusTextFor = (status: string) => statusText[status] ?? status

const formatMaybeTime = (value?: number | null) => {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleString()
}

const formatValue = (value: SubscriptionValue | null) => {
  if (!value) {
    return '—'
  }

  const parts = [`${value.remaining} ${value.displayUnit}`]

  if (typeof value.limit === 'number') {
    parts.push(`of ${value.limit}`)
  }

  if (value.used != null) {
    parts.push(`used ${value.used}`)
  }

  return parts.join(' · ')
}

function clampIndex(index: number, total: number) {
  if (!total) {
    return 0
  }

  return Math.max(0, Math.min(index, total - 1))
}

export function SubscriptionsOverlay({ onClose, t }: SubscriptionsOverlayProps) {
  const { rpc } = useGateway()
  const overlay = useStore($overlayState)
  const subscriptions = useStore($subscriptions)
  const history = useStore($subscriptionHistory)
  const { stdout } = useStdout()

  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (stdout?.columns ?? 80) - 6))
  const model = useMemo(() => buildSubscriptionDashboardModel(subscriptions), [subscriptions])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (overlay.subscriptionsProviderId) {
      const next = model.cards.findIndex(card => card.providerId === overlay.subscriptionsProviderId)

      if (next >= 0) {
        setSelectedIndex(next)
      }

      return
    }

    setSelectedIndex(idx => clampIndex(idx, model.cards.length))
  }, [model.cards, overlay.subscriptionsProviderId])

  useEffect(() => {
    if (!overlay.subscriptions) {
      return
    }

    void hydrateSubscriptionDashboard(rpc)
  }, [overlay.subscriptions, rpc])

  const selected = model.cards[clampIndex(selectedIndex, model.cards.length)]
  const selectedHistory = selected ? history[selected.providerId] ?? [] : []
  const cardWidth = Math.max(28, Math.min(38, Math.floor((width - LIST_WIDTH - 4) / 2)))
  const detailWidth = Math.max(32, width - LIST_WIDTH - cardWidth - 6)
  const summaryLastSync = formatMaybeTime(model.summary.lastSyncAt)

  useInput((ch, key) => {
    if (!overlay.subscriptions) {
      return
    }

    if (editing) {
      if (key.escape) {
        setEditing(false)
        setEditValue('')
        setMessage('edit cancelled')
      }

      return
    }

    if (key.escape || ch === 'q') {
      onClose()

      return
    }

    if (key.upArrow || ch === 'k') {
      setSelectedIndex(idx => clampIndex(idx - 1, model.cards.length))
      setMessage('')

      return
    }

    if (key.downArrow || ch === 'j') {
      setSelectedIndex(idx => clampIndex(idx + 1, model.cards.length))
      setMessage('')

      return
    }

    if (ch === 'e' || key.return) {
      setEditing(true)
      setEditValue(selected?.record.manualValue?.remaining?.toString() ?? selected?.record.syncedValue?.remaining?.toString() ?? '')
      setMessage(`editing ${selected?.providerName ?? 'subscription'}`)

      return
    }

    if (ch === 'u' && selected?.record.syncedValue) {
      applyActiveSourceSelection(selected.providerId, 'synced')
      void persistSubscriptionUpdate(rpc, {
        active_source: 'synced',
        manual_value: selected.record.manualValue,
        notes: [...selected.record.notes, 'Selected synced value from dashboard'],
        provider_id: selected.providerId,
        synced_value: selected.record.syncedValue,
        renewal_at: selected.record.renewalAt,
        reset_at: selected.record.resetAt
      })
      setMessage(`using synced value for ${selected.providerName}`)

      return
    }

    if (ch === 'm' && selected?.record.manualValue) {
      applyActiveSourceSelection(selected.providerId, 'manual')
      void persistSubscriptionUpdate(rpc, {
        active_source: 'manual',
        manual_value: selected.record.manualValue,
        notes: [...selected.record.notes, 'Kept manual value from dashboard'],
        provider_id: selected.providerId,
        synced_value: selected.record.syncedValue,
        renewal_at: selected.record.renewalAt,
        reset_at: selected.record.resetAt
      })
      setMessage(`keeping manual value for ${selected.providerName}`)

      return
    }

    if (ch === 'y' && selected) {
      void persistSubscriptionSync(rpc, {
        provider_id: selected.providerId,
        synced_value: selected.record.syncedValue,
        last_error: selected.record.lastError ?? undefined
      })
      setMessage(`refreshed ${selected.providerName}`)

      return
    }

    if (ch === 'd' && selected) {
      disconnectSubscriptionRecord(selected.providerId)
      void persistSubscriptionDisconnect(rpc, { provider_id: selected.providerId })
      setMessage(`disconnected ${selected.providerName}`)

      return
    }

    if (ch === 'r') {
      setSelectedIndex(0)
      setMessage('selection reset')
    }
  })

  const submitManualOverride = (value: string) => {
    if (!selected) {
      return
    }

    const next = Number.parseFloat(value)

    if (!Number.isFinite(next)) {
      setMessage('enter a numeric remaining value')

      return
    }

    const source = selected.record.activeSource
    const current = selected.record.manualValue ?? selected.record.syncedValue

    const manualValue: SubscriptionValue = {
      confidence: current?.confidence ?? selected.record.confidence,
      displayUnit: selected.record.displayUnit,
      limit: current?.limit,
      lastError: undefined,
      metricKind: selected.record.metricKind,
      notes: [...selected.record.notes, 'Manual override from dashboard'],
      remaining: next,
      sourceType: 'manual',
      sourceUpdatedAt: Date.now(),
      used: current?.used
    }

    if ($subscriptions.get().some(item => item.providerId === selected.providerId)) {
      applyManualOverride(selected.providerId, manualValue, {
        eventType: 'manual_update',
        summary: `Manual override set to ${next} ${selected.record.displayUnit}`
      })

    } else {
      upsertSubscription({
        activeSource: 'manual',
        connection: selected.record.connection,
        displayUnit: selected.record.displayUnit,
        manualValue,
        metricKind: selected.record.metricKind,
        notes: [...selected.record.notes, 'Created from dashboard manual override'],
        providerId: selected.providerId,
        providerName: selected.providerName,
        resetAt: selected.record.resetAt,
        renewalAt: selected.record.renewalAt,
        sourceUpdatedAt: Date.now(),
        syncedValue: null
      })

      applyManualOverride(selected.providerId, manualValue, {
        eventType: 'manual_update',
        summary: `Manual override set to ${next} ${selected.record.displayUnit}`
      })

    }

    void persistSubscriptionUpdate(rpc, {
      active_source: 'manual',
      manual_value: manualValue,
      notes: [...selected.record.notes, 'Manual override from dashboard'],
      provider_id: selected.providerId,
      renewal_at: selected.record.renewalAt,
      reset_at: selected.record.resetAt
    })
    setEditing(false)
    setEditValue('')
    setMessage(`${selected.providerName} updated`)

    if (source === 'synced') {
      setSelectedIndex(idx => clampIndex(idx, model.cards.length))
    }
  }

  const detailHistory = selectedHistory[0]

  return (
    <NoSelect flexDirection="column" flexGrow={1} marginTop={1}>
      <FloatBox color={t.color.bronze}>
        <Box flexDirection="column" width={width - 2}>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={t.color.bronze}>
              Subscription dashboard
            </Text>
            <Text color={t.color.dim}>
              Esc/q close · ↑/↓ select · Enter/e edit manual value · u use synced · m keep manual · y refresh · d disconnect
            </Text>
          </Box>

          <Box flexDirection="row" marginBottom={1}>
            <Box flexDirection="column" width={Math.max(28, width - 38)}>
              <Text bold color={t.color.label}>
                Summary
              </Text>
              <Text>
                Remaining: <Text color={t.color.cornsilk}>{model.summary.totalRemaining}</Text>
              </Text>
              <Text>
                Connected: <Text color={t.color.cornsilk}>{model.summary.connectedProviders}</Text>
              </Text>
              <Text>
                Last sync: <Text color={t.color.cornsilk}>{summaryLastSync}</Text>
              </Text>
              <Text>
                Stale/manual-only: <Text color={t.color.cornsilk}>{model.summary.staleProviders + model.summary.manualOnlyProviders}</Text>
              </Text>
            </Box>

            <Box flexDirection="column" paddingLeft={2} width={34}>
              <Text bold color={t.color.label}>
                Selection
              </Text>
              <Text color={selected ? t.color.cornsilk : t.color.dim}>{selected?.providerName ?? '—'}</Text>
              <Text color={selected ? t.color.dim : t.color.dim}>{selected ? statusTextFor(selected.record.status) : '—'}</Text>
              <Text color={t.color.dim}>
                {selected ? formatValue(resolveActiveValue(selected.record)) : '—'}
              </Text>
            </Box>
          </Box>

          <Box flexDirection="row">
            <ScrollBox flexDirection="column" height={18} width={LIST_WIDTH}>
              {model.cards.map((card, index) => {
                const active = index === selectedIndex

                return (
                  <Box
                    borderColor={active ? t.color.bronze : t.color.dim}
                    borderStyle={active ? 'double' : 'single'}
                    flexDirection="column"
                    key={card.providerId}
                    marginBottom={1}
                    paddingX={1}
                    paddingY={0}
                    width={cardWidth}
                  >
                    <Text bold color={active ? t.color.bronze : t.color.label} wrap="truncate-end">
                      {active ? '▶ ' : '  '}{card.providerName}
                    </Text>
                    <Text color={statusTone[card.record.status] ?? t.color.cornsilk}>
                      {statusTextFor(card.record.status)} · {formatValue(resolveActiveValue(card.record))}
                    </Text>
                    <Text color={t.color.dim}>
                      {sourceLabel[card.record.activeSource] ?? card.record.activeSource} · {card.record.connection.connected ? 'connected' : 'disconnected'}
                    </Text>
                    <Text color={t.color.dim} wrap="truncate-end">
                      {card.record.connection.label ?? card.connectorGuides[0]?.title ?? 'Manual tracking'}
                    </Text>
                  </Box>
                )
              })}
            </ScrollBox>

            <Box flexDirection="column" paddingLeft={2} width={detailWidth}>
              <Text bold color={t.color.label}>
                Details
              </Text>

              {selected ? (
                <>
                  <Text bold color={t.color.cornsilk}>
                    {selected.providerName}
                  </Text>
                  <Text>
                    Status: <Text color={statusTone[selected.record.status] ?? t.color.cornsilk}>{statusTextFor(selected.record.status)}</Text>
                  </Text>
                  <Text>
                    Unit: <Text color={t.color.cornsilk}>{selected.record.displayUnit}</Text> · Metric: <Text color={t.color.cornsilk}>{selected.record.metricKind}</Text>
                  </Text>
                    <Text>
                      Active: <Text color={t.color.cornsilk}>{formatValue(resolveActiveValue(selected.record))}</Text>
                    </Text>
                    <Text>
                      Manual: <Text color={t.color.cornsilk}>{formatValue(selected.record.manualValue)}</Text>
                    </Text>
                    <Text>
                      Synced: <Text color={t.color.cornsilk}>{formatValue(selected.record.syncedValue)}</Text>
                    </Text>
                    {hasSubscriptionValueConflict(selected.record) ? (
                      <Text color={t.color.warn}>
                        Manual and synced values differ; press `m` to keep manual or `u` to use synced.
                      </Text>
                    ) : null}
                    <Text>
                      Freshness: <Text color={isStale(selected.record) ? t.color.warn : t.color.ok}>{isStale(selected.record) ? 'stale' : 'fresh'}</Text>
                    </Text>
                    <Text>
                      Sync confidence: <Text color={t.color.cornsilk}>{selected.record.confidence}</Text>
                    </Text>
                  <Text>
                    Source updated: <Text color={t.color.cornsilk}>{formatMaybeTime(selected.record.sourceUpdatedAt)}</Text>
                  </Text>
                  <Text>
                    Connection: <Text color={t.color.cornsilk}>{selected.record.connection.label ?? (selected.record.connection.connected ? 'Connected' : 'Not connected')}</Text>
                  </Text>
                  <Text>
                    Last error: <Text color={t.color.cornsilk}>{selected.record.lastError ?? '—'}</Text>
                  </Text>
                  <Text>
                    Latest note: <Text color={t.color.cornsilk}>{selected.record.notes[0] ?? '—'}</Text>
                  </Text>

                  <Box flexDirection="column" marginTop={1}>
                    <Text bold color={t.color.label}>
                      Connection guidance
                    </Text>
                    {selected.connectorGuides.length ? (
                      selected.connectorGuides.map(guide => (
                        <Box
                          borderColor={guide.connectorKind === 'manual' ? t.color.dim : t.color.bronze}
                          borderStyle="single"
                          flexDirection="column"
                          key={`${selected.providerId}:${guide.title}`}
                          marginTop={1}
                          paddingX={1}
                          paddingY={0}
                        >
                          <Text bold color={guide.connectorKind === 'manual' ? t.color.label : t.color.cornsilk} wrap="truncate-end">
                            {guide.title}
                          </Text>
                          <Text color={t.color.dim} wrap="truncate-end">
                            {guide.exampleState}
                          </Text>
                          <Text color={t.color.dim} wrap="truncate-end">
                            Credentials: {guide.requiredCredentials.length ? guide.requiredCredentials.join(', ') : 'none'}
                          </Text>
                          <Text color={t.color.dim} wrap="truncate-end">
                            Notes: {guide.setupNotes.join(' · ')}
                          </Text>
                        </Box>
                      ))
                    ) : (
                      <Text color={t.color.dim}>Manual tracking only; keep a local estimate until a connector is available.</Text>
                    )}
                  </Box>

                  <Box flexDirection="column" marginTop={1}>
                    <Text bold color={t.color.label}>
                      History
                    </Text>
                    <Text color={t.color.dim}>
                      {detailHistory ? `${detailHistory.summary} · ${formatMaybeTime(detailHistory.createdAt)}` : 'No events yet'}
                    </Text>
                  </Box>

                  <Box flexDirection="column" marginTop={1}>
                    <Text bold color={t.color.label}>
                      Connectivity
                    </Text>
                    <Text color={t.color.dim}>
                      {selected.syncAvailable ? 'Sync is available for this provider.' : 'No stable sync connector yet; use manual tracking.'}
                    </Text>
                    <Text color={t.color.dim}>
                      Supported: {selected.supportedConnectorKinds.join(', ')} · Manual fallback: {selected.manualFallback ? 'yes' : 'no'}
                    </Text>
                  </Box>
                </>
              ) : (
                <Text color={t.color.dim}>No subscription selected.</Text>
              )}
            </Box>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {editing ? (
              <Box flexDirection="column">
                <Text bold color={t.color.label}>
                  Manual override for {selected?.providerName ?? 'subscription'}
                </Text>
                <TextInput
                  columns={Math.max(24, width - 4)}
                  focus
                  onChange={setEditValue}
                  onSubmit={submitManualOverride}
                  placeholder="enter remaining value"
                  value={editValue}
                />
              </Box>
            ) : (
              <Text color={message ? t.color.cornsilk : t.color.dim} wrap="truncate-end">
                {message || 'Open a provider card, press Enter, and edit the manual remaining value.'}
              </Text>
            )}
          </Box>
        </Box>
      </FloatBox>
    </NoSelect>
  )
}

interface SubscriptionsOverlayProps {
  onClose: () => void
  t: Theme
}
