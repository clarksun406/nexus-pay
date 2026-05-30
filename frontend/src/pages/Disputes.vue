<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const disputes = ref<any[]>([])
const loading = ref(true)

async function fetchDisputes() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/disputes`, {
      params: { mode: auth.mode },
    })
    disputes.value = data.content || []
  } catch {
    disputes.value = []
  } finally {
    loading.value = false
  }
}

function statusClass(s: string) {
  if (s === 'WON') return 'bg-green-100 text-green-700'
  if (s === 'LOST' || s === 'CHARGE_REFUNDED') return 'bg-red-100 text-red-700'
  if (s === 'OPEN' || s === 'WARNING_NEEDS_RESPONSE') return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-600'
}

onMounted(fetchDisputes)
watch(() => auth.mode, fetchDisputes)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Disputes</h1>

    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">ID</th>
            <th class="px-6 py-3">Amount</th>
            <th class="px-6 py-3">Reason</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3">Evidence Due</th>
            <th class="px-6 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading"><td colspan="6" class="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
          <tr v-else-if="!disputes.length"><td colspan="6" class="px-6 py-8 text-center text-gray-400">No disputes</td></tr>
          <tr v-for="d in disputes" :key="d.id" class="border-b last:border-0">
            <td class="px-6 py-3 font-mono text-xs">{{ d.providerDisputeId || d.id.slice(0, 8) }}</td>
            <td class="px-6 py-3">{{ (d.amount / 100).toFixed(2) }} {{ d.currency }}</td>
            <td class="px-6 py-3 text-gray-500">{{ d.reason || '—' }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="statusClass(d.status)">{{ d.status }}</span>
            </td>
            <td class="px-6 py-3 text-gray-500">{{ d.evidenceDueBy ? format(new Date(d.evidenceDueBy), 'PP') : '—' }}</td>
            <td class="px-6 py-3 text-gray-500">{{ d.createdAt ? format(new Date(d.createdAt), 'PPp') : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
