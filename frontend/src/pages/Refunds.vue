<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const refunds = ref<any[]>([])
const stats = ref<any>(null)
const loading = ref(true)
const syncing = ref<string | null>(null)
const retrying = ref<string | null>(null)
const bulkSyncing = ref(false)

interface RefundStats {
  total: number
  succeeded: number
  failed: number
  pending: number
  totalAmount: number
  succeededAmount: number
  failedAmount: number
  pendingAmount: number
  currency: string
  syncPending: number
}

function fmtAmount(amount: number) {
  return (amount / 100).toFixed(2)
}

async function fetchRefunds() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/refunds?mode=${auth.mode}`)
    refunds.value = data.content || []
  } catch { refunds.value = [] }
  finally { loading.value = false }
}

async function fetchStats() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/refunds/stats?mode=${auth.mode}`)
    stats.value = data as RefundStats
  } catch { stats.value = null }
}

async function syncRefund(refundId: string) {
  syncing.value = refundId
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/refunds/${refundId}/sync`)
    await fetchRefunds()
    await fetchStats()
  } catch { /* ignore */ }
  finally { syncing.value = null }
}

async function retryRefund(refundId: string) {
  retrying.value = refundId
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/refunds/${refundId}/retry`)
    await fetchRefunds()
    await fetchStats()
  } catch { /* ignore */ }
  finally { retrying.value = null }
}

async function bulkSync() {
  bulkSyncing.value = true
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/refunds/sync-all`)
    await fetchRefunds()
    await fetchStats()
  } catch { /* ignore */ }
  finally { bulkSyncing.value = false }
}

onMounted(() => {
  fetchRefunds()
  fetchStats()
})

const statusClass = (status: string) => ({
  'bg-green-100 text-green-700': status === 'SUCCEEDED',
  'bg-red-100 text-red-700': status === 'FAILED',
  'bg-yellow-100 text-yellow-700': status === 'PENDING',
})

const syncStatusClass = (syncStatus: string) => ({
  'text-green-600': syncStatus === 'SYNCED',
  'text-yellow-600': syncStatus === 'NOT_SYNCED' || syncStatus === 'SYNCING',
  'text-red-600': syncStatus === 'SYNC_FAILED',
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Refunds</h1>
      <button
        v-if="stats && stats.syncPending > 0"
        @click="bulkSync"
        :disabled="bulkSyncing"
        class="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {{ bulkSyncing ? 'Syncing...' : `Sync All (${stats.syncPending} pending)` }}
      </button>
    </div>

    <!-- Stats Cards -->
    <div v-if="stats" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Total Refunds</div>
        <div class="text-2xl font-semibold mt-1">{{ stats.total }}</div>
        <div class="text-sm text-gray-400 mt-1">{{ fmtAmount(stats.totalAmount) }} {{ stats.currency }}</div>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Succeeded</div>
        <div class="text-2xl font-semibold text-green-600 mt-1">{{ stats.succeeded }}</div>
        <div class="text-sm text-gray-400 mt-1">{{ fmtAmount(stats.succeededAmount) }} {{ stats.currency }}</div>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Failed</div>
        <div class="text-2xl font-semibold text-red-600 mt-1">{{ stats.failed }}</div>
        <div class="text-sm text-gray-400 mt-1">{{ fmtAmount(stats.failedAmount) }} {{ stats.currency }}</div>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <div class="text-sm text-gray-500">Pending</div>
        <div class="text-2xl font-semibold text-yellow-600 mt-1">{{ stats.pending }}</div>
        <div class="text-sm text-gray-400 mt-1">{{ fmtAmount(stats.pendingAmount) }} {{ stats.currency }}</div>
      </div>
    </div>

    <!-- Refunds Table -->
    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">ID</th>
            <th class="px-6 py-3">Payment Intent</th>
            <th class="px-6 py-3">Amount</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3">Reason</th>
            <th class="px-6 py-3">Sync</th>
            <th class="px-6 py-3">Created</th>
            <th class="px-6 py-3 w-24">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in refunds" :key="r.id" class="border-b last:border-0">
            <td class="px-6 py-3 font-mono text-xs">{{ r.id?.slice(0, 8) }}...</td>
            <td class="px-6 py-3 font-mono text-xs">{{ r.paymentIntentId?.slice(0, 8) }}...</td>
            <td class="px-6 py-3">{{ fmtAmount(r.amount) }} {{ r.currency }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="statusClass(r.status)">
                {{ r.status }}
              </span>
            </td>
            <td class="px-6 py-3 text-gray-500 max-w-40 truncate" :title="r.reason || r.failureReason">
              {{ r.reason || r.failureReason || '—' }}
            </td>
            <td class="px-6 py-3">
              <span class="text-xs font-medium" :class="syncStatusClass(r.syncStatus)">
                {{ r.syncStatus }}
              </span>
              <span v-if="r.syncAttempts > 0" class="text-xs text-gray-400 ml-1">({{ r.syncAttempts }})</span>
            </td>
            <td class="px-6 py-3 text-gray-500">{{ r.createdAt ? format(new Date(r.createdAt), 'MMM d, HH:mm') : '' }}</td>
            <td class="px-6 py-3">
              <div class="flex gap-1">
                <button
                  v-if="r.status === 'PENDING' && r.providerRefundId"
                  @click="syncRefund(r.id)"
                  :disabled="syncing === r.id"
                  class="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50"
                  title="Query PSP for current status"
                >
                  {{ syncing === r.id ? '...' : 'Sync' }}
                </button>
                <button
                  v-if="r.status === 'FAILED' && (r.retryCount || 0) < 3"
                  @click="retryRefund(r.id)"
                  :disabled="retrying === r.id"
                  class="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-50"
                  title="Retry the refund at the provider"
                >
                  {{ retrying === r.id ? '...' : 'Retry' }}
                </button>
                <span
                  v-if="r.status === 'FAILED' && (r.retryCount || 0) >= 3"
                  class="text-xs text-gray-400"
                  title="Max retries exceeded"
                >
                  Maxed
                </span>
              </div>
            </td>
          </tr>
          <tr v-if="!refunds.length && !loading">
            <td colspan="8" class="px-6 py-8 text-center text-gray-400">No refunds</td>
          </tr>
          <tr v-if="loading">
            <td colspan="8" class="px-6 py-8 text-center text-gray-400">Loading...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>