<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const refunds = ref<any[]>([])
const loading = ref(true)

async function fetchRefunds() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/refunds?mode=${auth.mode}`)
    refunds.value = data.content || []
  } catch { refunds.value = [] }
  finally { loading.value = false }
}

onMounted(fetchRefunds)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Refunds</h1>
    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">ID</th>
            <th class="px-6 py-3">Payment Intent</th>
            <th class="px-6 py-3">Amount</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3">Reason</th>
            <th class="px-6 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in refunds" :key="r.id" class="border-b last:border-0">
            <td class="px-6 py-3 font-mono text-xs">{{ r.id?.slice(0, 8) }}...</td>
            <td class="px-6 py-3 font-mono text-xs">{{ r.paymentIntentId?.slice(0, 8) }}...</td>
            <td class="px-6 py-3">{{ (r.amount / 100).toFixed(2) }} {{ r.currency }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="{ 'bg-green-100 text-green-700': r.status === 'SUCCEEDED', 'bg-red-100 text-red-700': r.status === 'FAILED', 'bg-yellow-100 text-yellow-700': r.status === 'PENDING' }">
                {{ r.status }}
              </span>
            </td>
            <td class="px-6 py-3 text-gray-500">{{ r.reason || '—' }}</td>
            <td class="px-6 py-3 text-gray-500">{{ r.createdAt ? format(new Date(r.createdAt), 'MMM d, HH:mm') : '' }}</td>
          </tr>
          <tr v-if="!refunds.length"><td colspan="6" class="px-6 py-8 text-center text-gray-400">No refunds</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
