<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const route = useRoute()
const auth = useAuthStore()
const payment = ref<any>(null)
const loading = ref(true)

async function fetchPayment() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents/${route.params.id}`)
    payment.value = data
  } catch {
    payment.value = null
  } finally {
    loading.value = false
  }
}

onMounted(fetchPayment)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-2">
      <router-link to="/payments" class="text-gray-400 hover:text-gray-600">Payments</router-link>
      <span class="text-gray-400">/</span>
      <span class="font-mono text-sm">{{ route.params.id }}</span>
    </div>

    <div v-if="payment" class="bg-white rounded-lg border p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold">Payment Details</h1>
        <span class="text-xs px-3 py-1 rounded-full font-medium"
          :class="{
            'bg-green-100 text-green-700': payment.status === 'SUCCEEDED',
            'bg-red-100 text-red-700': payment.status === 'FAILED',
            'bg-gray-100 text-gray-600': payment.status === 'CANCELED',
            'bg-blue-100 text-blue-700': payment.status === 'PROCESSING',
          }">{{ payment.status }}</span>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div><p class="text-xs text-gray-500">Amount</p><p class="font-medium">{{ (payment.amount / 100).toFixed(2) }} {{ payment.currency }}</p></div>
        <div><p class="text-xs text-gray-500">Provider</p><p class="font-medium">{{ payment.resolvedProvider || '—' }}</p></div>
        <div><p class="text-xs text-gray-500">Capture Method</p><p class="font-medium">{{ payment.captureMethod }}</p></div>
        <div><p class="text-xs text-gray-500">Payment Method</p><p class="font-medium">{{ payment.paymentMethodType || 'card' }}</p></div>
        <div><p class="text-xs text-gray-500">Created</p><p class="font-medium">{{ payment.createdAt ? format(new Date(payment.createdAt), 'PPpp') : '—' }}</p></div>
        <div><p class="text-xs text-gray-500">Provider Payment ID</p><p class="font-mono text-sm">{{ payment.providerPaymentId || '—' }}</p></div>
      </div>

      <div v-if="payment.metadata">
        <p class="text-xs text-gray-500 mb-1">Metadata</p>
        <pre class="bg-gray-50 rounded p-3 text-xs overflow-auto">{{ JSON.stringify(payment.metadata, null, 2) }}</pre>
      </div>
    </div>

    <div v-else-if="!loading" class="text-center py-12 text-gray-400">Payment not found</div>
  </div>
</template>
