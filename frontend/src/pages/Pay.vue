<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '@/lib/api'

const route = useRoute()
const link = ref<any>(null)
const loading = ref(true)
const error = ref('')
const paymentMethodId = ref('')
const processing = ref(false)
const result = ref<any>(null)

async function fetchLink() {
  try {
    const { data } = await api.get(`/pub/pay/${route.params.token}`)
    link.value = data
  } catch (err: any) {
    error.value = err.response?.data?.detail || 'Payment link not found'
  } finally {
    loading.value = false
  }
}

async function handlePay() {
  if (!paymentMethodId.value) return
  processing.value = true
  try {
    const { data } = await api.post(`/pub/pay/${route.params.token}/checkout`, {
      paymentMethodId: paymentMethodId.value,
      paymentMethodType: 'card',
    })
    result.value = data
  } catch (err: any) {
    error.value = err.response?.data?.detail || 'Payment failed'
  } finally {
    processing.value = false
  }
}

onMounted(fetchLink)
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-md">
      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div v-if="loading" class="text-center py-8 text-gray-400">Loading...</div>

        <div v-else-if="error && !link" class="text-center py-8">
          <p class="text-red-500">{{ error }}</p>
        </div>

        <div v-else-if="result">
          <div v-if="result.status === 'SUCCEEDED'" class="text-center space-y-4">
            <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h2 class="text-xl font-semibold">Payment Successful</h2>
            <p class="text-gray-500">{{ (result.amount / 100).toFixed(2) }} {{ result.currency?.toUpperCase() }}</p>
          </div>
          <div v-else class="text-center space-y-4">
            <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </div>
            <h2 class="text-xl font-semibold">Payment Failed</h2>
            <p class="text-gray-500">{{ result.status }}</p>
          </div>
        </div>

        <div v-else-if="link">
          <h1 class="text-xl font-bold text-center mb-1">{{ link.title }}</h1>
          <p class="text-3xl font-bold text-center my-6">{{ (link.amount / 100).toFixed(2) }} {{ link.currency?.toUpperCase() }}</p>

          <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3 mb-4">{{ error }}</div>

          <form @submit.prevent="handlePay" class="space-y-4">
            <div>
              <label class="block text-sm font-medium mb-1">Payment Method ID</label>
              <input v-model="paymentMethodId" placeholder="pm_xxx" class="w-full border rounded-md px-3 py-2 text-sm" required />
            </div>
            <button type="submit" :disabled="processing" class="w-full bg-indigo-600 text-white rounded-md py-3 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
              {{ processing ? 'Processing...' : `Pay ${(link.amount / 100).toFixed(2)} ${link.currency?.toUpperCase()}` }}
            </button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
