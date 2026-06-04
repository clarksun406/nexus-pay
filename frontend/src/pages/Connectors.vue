<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

interface FormState {
  provider: 'STRIPE' | 'SQUARE' | 'BRAINTREE'
  label: string
  mode: 'TEST' | 'LIVE'
  isPrimary: boolean
  weight: number
  // Stripe
  stripeSecretKey: string
  stripePublishableKey: string
  // Square
  squareAccessToken: string
  squareLocationId: string
  squareWebhookSignatureKey: string
  // Braintree
  braintreePublicKey: string
  braintreePrivateKey: string
  braintreeMerchantAccountId: string
  // Fees
  feeFixed: string
  feePercentage: string
}

const auth = useAuthStore()
const connectors = ref<any[]>([])
const showCreate = ref(false)
const createError = ref('')

const initial = (): FormState => ({
  provider: 'STRIPE', label: '', mode: 'TEST', isPrimary: false, weight: 1,
  stripeSecretKey: '', stripePublishableKey: '',
  squareAccessToken: '', squareLocationId: '', squareWebhookSignatureKey: '',
  braintreePublicKey: '', braintreePrivateKey: '', braintreeMerchantAccountId: '',
  feeFixed: '', feePercentage: '',
})
const form = ref<FormState>(initial())

const isStripe = computed(() => form.value.provider === 'STRIPE')
const isSquare = computed(() => form.value.provider === 'SQUARE')
const isBraintree = computed(() => form.value.provider === 'BRAINTREE')

async function fetchConnectors() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/connectors`)
    connectors.value = data
  } catch { connectors.value = [] }
}

function buildBody() {
  const f = form.value
  let credentials: Record<string, string> = {}
  let providerConfig: Record<string, any> = {}
  if (f.provider === 'STRIPE') {
    credentials = { secretKey: f.stripeSecretKey }
    if (f.stripePublishableKey) providerConfig.publishableKey = f.stripePublishableKey
  } else if (f.provider === 'SQUARE') {
    credentials = { accessToken: f.squareAccessToken }
    if (f.squareLocationId) credentials.locationId = f.squareLocationId
    if (f.squareWebhookSignatureKey) credentials.webhookSignatureKey = f.squareWebhookSignatureKey
  } else if (f.provider === 'BRAINTREE') {
    credentials = { publicKey: f.braintreePublicKey, privateKey: f.braintreePrivateKey }
    if (f.braintreeMerchantAccountId) credentials.merchantAccountId = f.braintreeMerchantAccountId
  }
  const body: any = {
    provider: f.provider,
    label: f.label,
    mode: f.mode,
    isPrimary: f.isPrimary,
    weight: f.weight,
    credentials,
  }
  if (Object.keys(providerConfig).length) body.config = providerConfig
  if (f.feeFixed || f.feePercentage) {
    body.feeConfig = {
      fixed: f.feeFixed ? parseInt(f.feeFixed, 10) : 0,
      percentage: f.feePercentage ? parseFloat(f.feePercentage) : 0,
    }
  }
  return body
}

async function createConnector() {
  createError.value = ''
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/connectors`, buildBody())
    showCreate.value = false
    form.value = initial()
    fetchConnectors()
  } catch (err: any) {
    createError.value = err.response?.data?.detail || 'Failed to create connector'
  }
}

async function deleteConnector(id: string) {
  if (!confirm('Delete this connector?')) return
  try {
    await api.delete(`/api/v1/merchants/${auth.activeMerchantId}/connectors/${id}`)
    fetchConnectors()
  } catch {}
}

onMounted(fetchConnectors)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Connectors</h1>
      <button @click="showCreate = !showCreate" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">
        {{ showCreate ? 'Cancel' : '+ Add Connector' }}
      </button>
    </div>

    <div v-if="showCreate" class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">New Connector</h2>
      <div v-if="createError" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-2">{{ createError }}</div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="text-xs text-gray-500">Provider</label>
          <select v-model="form.provider" class="w-full border rounded px-3 py-2 text-sm mt-1">
            <option>STRIPE</option><option>SQUARE</option><option>BRAINTREE</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Label</label>
          <input v-model="form.label" placeholder="My Stripe" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Mode</label>
          <select v-model="form.mode" class="w-full border rounded px-3 py-2 text-sm mt-1"><option>TEST</option><option>LIVE</option></select>
        </div>
        <div>
          <label class="text-xs text-gray-500">Weight</label>
          <input v-model.number="form.weight" type="number" min="1" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <label class="col-span-2 inline-flex items-center gap-2 text-sm">
          <input type="checkbox" v-model="form.isPrimary" /> Primary connector
        </label>
      </div>

      <!-- Provider-specific credential fields -->
      <div v-if="isStripe" class="grid grid-cols-2 gap-4 pt-2 border-t">
        <div class="col-span-2">
          <label class="text-xs text-gray-500">Secret Key <span class="text-red-500">*</span></label>
          <input v-model="form.stripeSecretKey" type="password" placeholder="sk_test_..." class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div class="col-span-2">
          <label class="text-xs text-gray-500">Publishable Key (for hosted checkout)</label>
          <input v-model="form.stripePublishableKey" placeholder="pk_test_..." class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
      </div>

      <div v-if="isSquare" class="grid grid-cols-2 gap-4 pt-2 border-t">
        <div class="col-span-2">
          <label class="text-xs text-gray-500">Access Token <span class="text-red-500">*</span></label>
          <input v-model="form.squareAccessToken" type="password" placeholder="EAAAEx..." class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Location ID</label>
          <input v-model="form.squareLocationId" placeholder="LXXXXXXXXX" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Webhook Signature Key</label>
          <input v-model="form.squareWebhookSignatureKey" type="password" placeholder="for inbound webhooks" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
      </div>

      <div v-if="isBraintree" class="grid grid-cols-2 gap-4 pt-2 border-t">
        <div>
          <label class="text-xs text-gray-500">Public Key <span class="text-red-500">*</span></label>
          <input v-model="form.braintreePublicKey" placeholder="public_xxx" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Private Key <span class="text-red-500">*</span></label>
          <input v-model="form.braintreePrivateKey" type="password" placeholder="private_xxx" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div class="col-span-2">
          <label class="text-xs text-gray-500">Merchant Account ID</label>
          <input v-model="form.braintreeMerchantAccountId" placeholder="optional" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
      </div>

      <!-- Fee config (used by routing engine cost-aware selection + payouts) -->
      <div class="grid grid-cols-2 gap-4 pt-2 border-t">
        <div>
          <label class="text-xs text-gray-500">Fixed fee per transaction (in minor units)</label>
          <input v-model="form.feeFixed" type="number" placeholder="30" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Percentage fee (e.g. 2.9)</label>
          <input v-model="form.feePercentage" type="number" step="0.01" placeholder="2.9" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
      </div>

      <button @click="createConnector" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Create</button>
    </div>

    <div class="grid gap-4">
      <div v-for="c in connectors" :key="c.id" class="bg-white rounded-lg border p-6 flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="font-medium">{{ c.label }}</h3>
            <span class="text-xs px-2 py-0.5 rounded-full" :class="c.mode === 'TEST' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'">{{ c.mode }}</span>
            <span v-if="c.isPrimary" class="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Primary</span>
          </div>
          <p class="text-sm text-gray-500 mt-1">
            {{ c.provider }} · Weight: {{ c.weight }}<span v-if="c.feeConfig"> · Fee: {{ c.feeConfig.fixed || 0 }} + {{ c.feeConfig.percentage || 0 }}%</span>
          </p>
        </div>
        <button @click="deleteConnector(c.id)" class="text-red-500 hover:text-red-700 text-sm">Delete</button>
      </div>
      <div v-if="!connectors.length" class="text-center py-12 text-gray-400">No connectors configured</div>
    </div>
  </div>
</template>
