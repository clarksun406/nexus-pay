<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const payouts = ref<any[]>([])
const loading = ref(true)
const selected = ref<any | null>(null)
const items = ref<any[]>([])

async function fetchPayouts() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payouts`, {
      params: { mode: auth.mode },
    })
    payouts.value = data.content || []
  } catch {
    payouts.value = []
  } finally {
    loading.value = false
  }
}

async function openPayout(p: any) {
  selected.value = p
  items.value = []
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payouts/${p.id}`)
    items.value = data.items || []
  } catch {}
}

function fmt(amount: number, currency: string) {
  const sign = amount < 0 ? '-' : ''
  return `${sign}${(Math.abs(amount) / 100).toFixed(2)} ${currency}`
}

onMounted(fetchPayouts)
watch(() => auth.mode, () => { fetchPayouts(); selected.value = null })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Payouts</h1>
      <p class="text-xs text-gray-400">Reconciliation summary — actual deposits are scheduled by your provider.</p>
    </div>

    <div v-if="!selected" class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">Period</th>
            <th class="px-6 py-3 text-right">Gross</th>
            <th class="px-6 py-3 text-right">Refunds</th>
            <th class="px-6 py-3 text-right">Fees</th>
            <th class="px-6 py-3 text-right">Net</th>
            <th class="px-6 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
          <tr v-else-if="!payouts.length"><td colspan="6" class="px-6 py-8 text-center text-gray-400">No payouts yet — they roll up daily.</td></tr>
          <tr v-for="p in payouts" :key="p.id" @click="openPayout(p)" class="border-b last:border-0 cursor-pointer hover:bg-gray-50">
            <td class="px-6 py-3 text-gray-500">
              {{ format(new Date(p.periodStart), 'PP') }} – {{ format(new Date(p.periodEnd), 'PP') }}
            </td>
            <td class="px-6 py-3 text-right">{{ fmt(p.grossAmount, p.currency) }}</td>
            <td class="px-6 py-3 text-right text-red-500">-{{ fmt(p.refundedAmount, p.currency) }}</td>
            <td class="px-6 py-3 text-right text-gray-500">-{{ fmt(p.feeAmount, p.currency) }}</td>
            <td class="px-6 py-3 text-right font-medium">{{ fmt(p.netAmount, p.currency) }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{{ p.status }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="bg-white rounded-lg border p-6 space-y-4">
      <div class="flex items-center gap-2 text-sm text-gray-500">
        <button @click="selected = null" class="text-indigo-600 hover:underline">← Payouts</button>
        <span>/</span>
        <span class="font-mono text-xs">{{ selected.id.slice(0, 8) }}</span>
      </div>
      <div class="grid grid-cols-4 gap-4">
        <div><p class="text-xs text-gray-500">Gross</p><p class="font-medium">{{ fmt(selected.grossAmount, selected.currency) }}</p></div>
        <div><p class="text-xs text-gray-500">Refunds</p><p class="font-medium text-red-500">-{{ fmt(selected.refundedAmount, selected.currency) }}</p></div>
        <div><p class="text-xs text-gray-500">Fees</p><p class="font-medium">-{{ fmt(selected.feeAmount, selected.currency) }}</p></div>
        <div><p class="text-xs text-gray-500">Net</p><p class="font-medium text-lg">{{ fmt(selected.netAmount, selected.currency) }}</p></div>
      </div>
      <table class="w-full text-sm border-t pt-2">
        <thead>
          <tr class="text-gray-500 text-left">
            <th class="px-4 py-2">Type</th>
            <th class="px-4 py-2">Reference</th>
            <th class="px-4 py-2 text-right">Amount</th>
            <th class="px-4 py-2 text-right">Fee</th>
            <th class="px-4 py-2 text-right">Net</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="i in items" :key="i.id" class="border-t">
            <td class="px-4 py-2">{{ i.type }}</td>
            <td class="px-4 py-2 font-mono text-xs text-gray-500">
              {{ (i.paymentIntentId || i.refundId || '').slice(0, 8) }}
            </td>
            <td class="px-4 py-2 text-right">{{ fmt(i.amount, i.currency) }}</td>
            <td class="px-4 py-2 text-right text-gray-500">{{ fmt(i.feeAmount, i.currency) }}</td>
            <td class="px-4 py-2 text-right font-medium">{{ fmt(i.netAmount, i.currency) }}</td>
          </tr>
          <tr v-if="!items.length"><td colspan="5" class="px-4 py-6 text-center text-gray-400">No items</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
