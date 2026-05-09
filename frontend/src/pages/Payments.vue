<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const payments = ref<any[]>([])
const loading = ref(true)
const page = ref(0)
const total = ref(0)

async function fetchPayments() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents?page=${page.value}&size=20&mode=${auth.mode}`)
    payments.value = data.content || []
    total.value = data.totalElements || 0
  } catch {
    payments.value = []
  } finally {
    loading.value = false
  }
}

onMounted(fetchPayments)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Payments</h1>
      <span class="text-sm text-gray-500">{{ total }} total</span>
    </div>

    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">ID</th>
            <th class="px-6 py-3">Amount</th>
            <th class="px-6 py-3">Currency</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3">Provider</th>
            <th class="px-6 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments" :key="p.id" class="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
              @click="$router.push(`/payments/${p.id}`)">
            <td class="px-6 py-3 font-mono text-xs">{{ p.id?.slice(0, 8) }}...</td>
            <td class="px-6 py-3">{{ (p.amount / 100).toFixed(2) }}</td>
            <td class="px-6 py-3 uppercase">{{ p.currency }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="{
                  'bg-green-100 text-green-700': p.status === 'SUCCEEDED',
                  'bg-red-100 text-red-700': p.status === 'FAILED',
                  'bg-gray-100 text-gray-600': p.status === 'CANCELED',
                  'bg-blue-100 text-blue-700': p.status === 'PROCESSING',
                  'bg-yellow-100 text-yellow-700': p.status === 'REQUIRES_CAPTURE',
                }">{{ p.status }}</span>
            </td>
            <td class="px-6 py-3">{{ p.resolvedProvider || '—' }}</td>
            <td class="px-6 py-3 text-gray-500">{{ p.createdAt ? format(new Date(p.createdAt), 'MMM d, HH:mm') : '' }}</td>
          </tr>
          <tr v-if="!payments.length && !loading">
            <td colspan="6" class="px-6 py-8 text-center text-gray-400">No payments found</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
