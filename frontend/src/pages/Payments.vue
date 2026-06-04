<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const payments = ref<any[]>([])
const loading = ref(true)
const page = ref(0)
const total = ref(0)

// Filters
const filters = ref({
  search: '',
  status: '',
  minAmount: '' as string | number,
  maxAmount: '' as string | number,
  createdFrom: '',
  createdTo: '',
})

const STATUSES = ['REQUIRES_PAYMENT_METHOD', 'REQUIRES_CONFIRMATION', 'REQUIRES_ACTION', 'PROCESSING', 'REQUIRES_CAPTURE', 'SUCCEEDED', 'FAILED', 'CANCELED']

async function fetchPayments() {
  loading.value = true
  try {
    const params: Record<string, any> = {
      page: page.value,
      size: 20,
      mode: auth.mode,
    }
    if (filters.value.search) params.search = filters.value.search
    if (filters.value.status) params.status = filters.value.status
    if (filters.value.minAmount) params.minAmount = Math.round(parseFloat(filters.value.minAmount as string) * 100)
    if (filters.value.maxAmount) params.maxAmount = Math.round(parseFloat(filters.value.maxAmount as string) * 100)
    if (filters.value.createdFrom) params.createdFrom = new Date(filters.value.createdFrom).toISOString()
    if (filters.value.createdTo) params.createdTo = new Date(filters.value.createdTo).toISOString()

    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents`, { params })
    payments.value = data.content || []
    total.value = data.totalElements || 0
  } catch {
    payments.value = []
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 0
  fetchPayments()
}

function resetFilters() {
  filters.value = { search: '', status: '', minAmount: '', maxAmount: '', createdFrom: '', createdTo: '' }
  page.value = 0
  fetchPayments()
}

const totalPages = () => Math.max(1, Math.ceil(total.value / 20))
function nextPage() { if (page.value + 1 < totalPages()) { page.value++; fetchPayments() } }
function prevPage() { if (page.value > 0) { page.value--; fetchPayments() } }

onMounted(fetchPayments)
watch(() => auth.mode, () => { page.value = 0; fetchPayments() })
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Payments</h1>
      <span class="text-sm text-gray-500">{{ total }} total</span>
    </div>

    <div class="bg-white rounded-lg border p-4 space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div class="md:col-span-2">
          <label class="text-xs text-gray-500">Search (id / order / description)</label>
          <input v-model="filters.search" @keyup.enter="applyFilters" placeholder="pi_xxx, order id…"
                 class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Status</label>
          <select v-model="filters.status" class="w-full border rounded px-3 py-2 text-sm mt-1">
            <option value="">Any</option>
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Min amount</label>
          <input v-model="filters.minAmount" type="number" step="0.01" placeholder="10.00"
                 class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Max amount</label>
          <input v-model="filters.maxAmount" type="number" step="0.01" placeholder="1000.00"
                 class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">From</label>
          <input v-model="filters.createdFrom" type="date" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">To</label>
          <input v-model="filters.createdTo" type="date" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
      </div>
      <div class="flex gap-2">
        <button @click="applyFilters" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Apply</button>
        <button @click="resetFilters" class="border text-sm px-4 py-2 rounded-md text-gray-600 hover:bg-gray-50">Reset</button>
      </div>
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
          <tr v-if="loading"><td colspan="6" class="px-6 py-8 text-center text-gray-400">Loading...</td></tr>
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
                  'bg-yellow-100 text-yellow-700': p.status === 'REQUIRES_CAPTURE' || p.status === 'REQUIRES_ACTION',
                }">{{ p.status }}</span>
            </td>
            <td class="px-6 py-3">{{ p.resolvedProvider || '—' }}</td>
            <td class="px-6 py-3 text-gray-500">{{ p.createdAt ? format(new Date(p.createdAt), 'MMM d, HH:mm') : '' }}</td>
          </tr>
          <tr v-if="!loading && !payments.length">
            <td colspan="6" class="px-6 py-8 text-center text-gray-400">No payments found</td>
          </tr>
        </tbody>
      </table>
      <div v-if="total > 20" class="flex items-center justify-between border-t px-6 py-3 text-sm">
        <span class="text-gray-500">Page {{ page + 1 }} of {{ totalPages() }}</span>
        <div class="flex gap-2">
          <button @click="prevPage" :disabled="page === 0" class="border px-3 py-1 rounded disabled:opacity-50">Prev</button>
          <button @click="nextPage" :disabled="page + 1 >= totalPages()" class="border px-3 py-1 rounded disabled:opacity-50">Next</button>
        </div>
      </div>
    </div>
  </div>
</template>
