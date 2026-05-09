<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const connectors = ref<any[]>([])
const showCreate = ref(false)
const form = ref({ provider: 'STRIPE', label: '', mode: 'TEST', isPrimary: false, weight: 1, secretKey: '' })

async function fetchConnectors() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/connectors`)
    connectors.value = data
  } catch { connectors.value = [] }
}

async function createConnector() {
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/connectors`, {
      provider: form.value.provider,
      label: form.value.label,
      mode: form.value.mode,
      isPrimary: form.value.isPrimary,
      weight: form.value.weight,
      credentials: { secretKey: form.value.secretKey },
    })
    showCreate.value = false
    form.value = { provider: 'STRIPE', label: '', mode: 'TEST', isPrimary: false, weight: 1, secretKey: '' }
    fetchConnectors()
  } catch {}
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
      <div class="grid grid-cols-2 gap-4">
        <div><label class="text-xs text-gray-500">Provider</label>
          <select v-model="form.provider" class="w-full border rounded px-3 py-2 text-sm mt-1">
            <option>STRIPE</option><option>SQUARE</option><option>BRAINTREE</option>
          </select>
        </div>
        <div><label class="text-xs text-gray-500">Label</label><input v-model="form.label" placeholder="My Stripe" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Mode</label>
          <select v-model="form.mode" class="w-full border rounded px-3 py-2 text-sm mt-1"><option>TEST</option><option>LIVE</option></select>
        </div>
        <div><label class="text-xs text-gray-500">Weight</label><input v-model.number="form.weight" type="number" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div class="col-span-2"><label class="text-xs text-gray-500">Secret Key</label><input v-model="form.secretKey" type="password" placeholder="sk_test_..." class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
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
          <p class="text-sm text-gray-500 mt-1">{{ c.provider }} · Weight: {{ c.weight }}</p>
        </div>
        <button @click="deleteConnector(c.id)" class="text-red-500 hover:text-red-700 text-sm">Delete</button>
      </div>
      <div v-if="!connectors.length" class="text-center py-12 text-gray-400">No connectors configured</div>
    </div>
  </div>
</template>
