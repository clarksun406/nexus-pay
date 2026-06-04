<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const disputes = ref<any[]>([])
const loading = ref(true)

const selected = ref<any | null>(null)
const evidence = ref<any | null>(null)
const evError = ref('')
const evSaving = ref(false)
const evSubmitting = ref(false)

const form = ref({
  productDescription: '',
  customerName: '',
  customerEmailAddress: '',
  billingAddress: '',
  shippingAddress: '',
  shippingCarrier: '',
  shippingTrackingNumber: '',
  serviceDate: '',
  refundPolicy: '',
  uncategorizedText: '',
})

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

async function openDispute(d: any) {
  selected.value = d
  evError.value = ''
  evidence.value = null
  form.value = {
    productDescription: '', customerName: '', customerEmailAddress: '',
    billingAddress: '', shippingAddress: '', shippingCarrier: '',
    shippingTrackingNumber: '', serviceDate: '', refundPolicy: '', uncategorizedText: '',
  }
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/disputes/${d.id}/evidence`)
    if (data) {
      evidence.value = data
      Object.assign(form.value, {
        productDescription: data.productDescription || '',
        customerName: data.customerName || '',
        customerEmailAddress: data.customerEmailAddress || '',
        billingAddress: data.billingAddress || '',
        shippingAddress: data.shippingAddress || '',
        shippingCarrier: data.shippingCarrier || '',
        shippingTrackingNumber: data.shippingTrackingNumber || '',
        serviceDate: data.serviceDate || '',
        refundPolicy: data.refundPolicy || '',
        uncategorizedText: data.uncategorizedText || '',
      })
    }
  } catch {}
}

async function saveDraft() {
  if (!selected.value) return
  evError.value = ''; evSaving.value = true
  try {
    const { data } = await api.put(
      `/api/v1/merchants/${auth.activeMerchantId}/disputes/${selected.value.id}/evidence`,
      form.value,
    )
    evidence.value = data
  } catch (err: any) {
    evError.value = err.response?.data?.detail || 'Save failed'
  } finally { evSaving.value = false }
}

async function submitEvidence() {
  if (!selected.value) return
  if (!confirm('Submit this evidence to the provider? You may not be able to edit it after submission.')) return
  evError.value = ''; evSubmitting.value = true
  try {
    const { data } = await api.post(
      `/api/v1/merchants/${auth.activeMerchantId}/disputes/${selected.value.id}/evidence/submit`,
      form.value,
    )
    evidence.value = data
    await fetchDisputes()
  } catch (err: any) {
    evError.value = err.response?.data?.detail || 'Submit failed'
  } finally { evSubmitting.value = false }
}

function statusClass(s: string) {
  if (s === 'WON') return 'bg-green-100 text-green-700'
  if (s === 'LOST' || s === 'CHARGE_REFUNDED') return 'bg-red-100 text-red-700'
  if (s === 'OPEN' || s === 'WARNING_NEEDS_RESPONSE') return 'bg-yellow-100 text-yellow-700'
  return 'bg-gray-100 text-gray-600'
}

const isSubmittable = (d: any) => ['OPEN', 'UNDER_REVIEW', 'WARNING_NEEDS_RESPONSE'].includes(d?.status)

onMounted(fetchDisputes)
watch(() => auth.mode, fetchDisputes)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Disputes</h1>

    <div v-if="!selected" class="bg-white rounded-lg border">
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
          <tr v-for="d in disputes" :key="d.id" @click="openDispute(d)" class="border-b last:border-0 hover:bg-gray-50 cursor-pointer">
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

    <div v-else class="bg-white rounded-lg border p-6 space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm">
          <button @click="selected = null" class="text-indigo-600 hover:underline">← Disputes</button>
          <span class="text-gray-400">/</span>
          <span class="font-mono text-xs">{{ selected.providerDisputeId }}</span>
        </div>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium" :class="statusClass(selected.status)">{{ selected.status }}</span>
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div><p class="text-xs text-gray-500">Amount</p><p class="font-medium">{{ (selected.amount / 100).toFixed(2) }} {{ selected.currency }}</p></div>
        <div><p class="text-xs text-gray-500">Reason</p><p class="font-medium">{{ selected.reason || '—' }}</p></div>
        <div><p class="text-xs text-gray-500">Evidence due</p><p class="font-medium">{{ selected.evidenceDueBy ? format(new Date(selected.evidenceDueBy), 'PP') : '—' }}</p></div>
      </div>

      <div class="border-t pt-4 space-y-3">
        <h2 class="font-medium">Evidence</h2>
        <p v-if="evidence?.status === 'SUBMITTED'" class="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Submitted to provider on {{ evidence.submittedAt ? format(new Date(evidence.submittedAt), 'PPpp') : '—' }}.
        </p>
        <div v-if="evError" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2">{{ evError }}</div>

        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label class="text-xs text-gray-500">Product description</label>
            <textarea v-model="form.productDescription" rows="2" class="w-full border rounded px-3 py-2 text-sm mt-1"></textarea>
          </div>
          <div><label class="text-xs text-gray-500">Customer name</label>
            <input v-model="form.customerName" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Customer email</label>
            <input v-model="form.customerEmailAddress" type="email" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Billing address</label>
            <input v-model="form.billingAddress" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Shipping address</label>
            <input v-model="form.shippingAddress" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Shipping carrier</label>
            <input v-model="form.shippingCarrier" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Shipping tracking #</label>
            <input v-model="form.shippingTrackingNumber" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Service date</label>
            <input v-model="form.serviceDate" placeholder="2024-05-01" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div><label class="text-xs text-gray-500">Refund policy</label>
            <input v-model="form.refundPolicy" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
          <div class="col-span-2">
            <label class="text-xs text-gray-500">Other / uncategorized notes</label>
            <textarea v-model="form.uncategorizedText" rows="3" class="w-full border rounded px-3 py-2 text-sm mt-1"></textarea>
          </div>
        </div>

        <div class="flex gap-2">
          <button @click="saveDraft" :disabled="evSaving"
            class="border text-sm px-4 py-2 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {{ evSaving ? 'Saving...' : 'Save draft' }}
          </button>
          <button @click="submitEvidence" :disabled="evSubmitting || !isSubmittable(selected)"
            class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {{ evSubmitting ? 'Submitting...' : 'Submit to provider' }}
          </button>
          <p v-if="!isSubmittable(selected)" class="text-xs text-gray-500 self-center">
            Evidence can only be submitted while the dispute is open or under review.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
