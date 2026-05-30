<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const route = useRoute()
const auth = useAuthStore()
const payment = ref<any>(null)
const refunds = ref<any[]>([])
const loading = ref(true)

const showRefund = ref(false)
const refunding = ref(false)
const refundError = ref('')
const refundForm = ref({ amount: '', reason: '' })

const actionInFlight = ref(false)
const actionError = ref('')

async function captureNow() {
  if (!confirm('Capture this authorised payment now?')) return
  actionError.value = ''; actionInFlight.value = true
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents/${route.params.id}/capture`)
    await fetchPayment()
  } catch (err: any) {
    actionError.value = err.response?.data?.detail || 'Capture failed'
  } finally { actionInFlight.value = false }
}

async function cancelNow() {
  if (!confirm('Cancel this payment? This is irreversible.')) return
  actionError.value = ''; actionInFlight.value = true
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents/${route.params.id}/cancel`)
    await fetchPayment()
  } catch (err: any) {
    actionError.value = err.response?.data?.detail || 'Cancel failed'
  } finally { actionInFlight.value = false }
}

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

async function fetchRefunds() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/refunds?mode=${auth.mode}`)
    refunds.value = (data.content || []).filter((r: any) => r.paymentIntentId === route.params.id)
  } catch { refunds.value = [] }
}

async function submitRefund() {
  refundError.value = ''
  refunding.value = true
  try {
    const body: any = {}
    if (refundForm.value.amount) body.amount = Math.round(parseFloat(refundForm.value.amount) * 100)
    if (refundForm.value.reason) body.reason = refundForm.value.reason
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents/${route.params.id}/refunds`, body)
    showRefund.value = false
    refundForm.value = { amount: '', reason: '' }
    await Promise.all([fetchPayment(), fetchRefunds()])
  } catch (err: any) {
    refundError.value = err.response?.data?.detail || 'Refund failed'
  } finally {
    refunding.value = false
  }
}

onMounted(() => {
  fetchPayment()
  fetchRefunds()
})
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
        <div class="flex items-center gap-3">
          <span class="text-xs px-3 py-1 rounded-full font-medium"
            :class="{
              'bg-green-100 text-green-700': payment.status === 'SUCCEEDED',
              'bg-red-100 text-red-700': payment.status === 'FAILED',
              'bg-gray-100 text-gray-600': payment.status === 'CANCELED',
              'bg-blue-100 text-blue-700': payment.status === 'PROCESSING',
              'bg-yellow-100 text-yellow-700': payment.status === 'REQUIRES_CAPTURE' || payment.status === 'REQUIRES_ACTION',
            }">{{ payment.status }}</span>
          <button v-if="payment.status === 'REQUIRES_CAPTURE'" @click="captureNow" :disabled="actionInFlight"
            class="text-sm bg-green-600 text-white px-3 py-1 rounded-md hover:bg-green-700 disabled:opacity-50">
            Capture
          </button>
          <button v-if="['REQUIRES_PAYMENT_METHOD','REQUIRES_CONFIRMATION','REQUIRES_CAPTURE','REQUIRES_ACTION'].includes(payment.status)"
                  @click="cancelNow" :disabled="actionInFlight"
            class="text-sm border border-gray-400 text-gray-700 px-3 py-1 rounded-md hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <a v-if="payment.status === 'REQUIRES_ACTION' && payment.threeDsActionUrl"
             :href="payment.threeDsActionUrl" target="_blank" rel="noopener"
             class="text-sm border border-indigo-600 text-indigo-600 px-3 py-1 rounded-md hover:bg-indigo-50">
            Open 3DS Action
          </a>
          <button v-if="payment.status === 'SUCCEEDED'" @click="showRefund = !showRefund"
            class="text-sm border border-indigo-600 text-indigo-600 px-3 py-1 rounded-md hover:bg-indigo-50">
            {{ showRefund ? 'Cancel' : 'Refund' }}
          </button>
        </div>
      </div>

      <div v-if="actionError" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">{{ actionError }}</div>

      <div v-if="showRefund" class="border rounded-lg p-4 bg-gray-50 space-y-3">
        <div v-if="refundError" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">{{ refundError }}</div>
        <div class="flex flex-wrap items-end gap-3">
          <div>
            <label class="text-xs text-gray-500">Amount ({{ payment.currency }}) — leave blank for full</label>
            <input v-model="refundForm.amount" type="number" step="0.01" :placeholder="(payment.amount / 100).toFixed(2)"
              class="w-40 border rounded px-3 py-2 text-sm mt-1" />
          </div>
          <div class="flex-1 min-w-[200px]">
            <label class="text-xs text-gray-500">Reason (optional)</label>
            <input v-model="refundForm.reason" placeholder="requested_by_customer" class="w-full border rounded px-3 py-2 text-sm mt-1" />
          </div>
          <button @click="submitRefund" :disabled="refunding"
            class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {{ refunding ? 'Processing...' : 'Issue Refund' }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div><p class="text-xs text-gray-500">Amount</p><p class="font-medium">{{ (payment.amount / 100).toFixed(2) }} {{ payment.currency }}</p></div>
        <div><p class="text-xs text-gray-500">Provider</p><p class="font-medium">{{ payment.resolvedProvider || '—' }}</p></div>
        <div><p class="text-xs text-gray-500">Capture Method</p><p class="font-medium">{{ payment.captureMethod }}</p></div>
        <div><p class="text-xs text-gray-500">Payment Method</p><p class="font-medium">{{ payment.paymentMethodType || 'card' }}</p></div>
        <div><p class="text-xs text-gray-500">Created</p><p class="font-medium">{{ payment.createdAt ? format(new Date(payment.createdAt), 'PPpp') : '—' }}</p></div>
        <div><p class="text-xs text-gray-500">Provider Payment ID</p><p class="font-mono text-sm">{{ payment.providerPaymentId || '—' }}</p></div>
      </div>

      <div v-if="refunds.length">
        <p class="text-xs text-gray-500 mb-1">Refunds</p>
        <table class="w-full text-sm border rounded">
          <thead>
            <tr class="border-b text-gray-500 text-left">
              <th class="px-3 py-2">Amount</th>
              <th class="px-3 py-2">Status</th>
              <th class="px-3 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in refunds" :key="r.id" class="border-b last:border-0">
              <td class="px-3 py-2">{{ (r.amount / 100).toFixed(2) }} {{ r.currency }}</td>
              <td class="px-3 py-2">
                <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                  :class="{ 'bg-green-100 text-green-700': r.status === 'SUCCEEDED', 'bg-red-100 text-red-700': r.status === 'FAILED', 'bg-yellow-100 text-yellow-700': r.status === 'PENDING' }">
                  {{ r.status }}
                </span>
              </td>
              <td class="px-3 py-2 text-gray-500">{{ r.reason || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="payment.metadata">
        <p class="text-xs text-gray-500 mb-1">Metadata</p>
        <pre class="bg-gray-50 rounded p-3 text-xs overflow-auto">{{ JSON.stringify(payment.metadata, null, 2) }}</pre>
      </div>
    </div>

    <div v-else-if="!loading" class="text-center py-12 text-gray-400">Payment not found</div>
  </div>
</template>
