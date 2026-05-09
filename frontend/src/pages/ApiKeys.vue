<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const keys = ref<any[]>([])
const showCreate = ref(false)
const newKeys = ref<any>(null)
const form = ref({ name: '', mode: 'TEST' })

async function fetchKeys() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/api-keys`)
    keys.value = data
  } catch { keys.value = [] }
}

async function createKey() {
  try {
    const { data } = await api.post(`/api/v1/merchants/${auth.activeMerchantId}/api-keys`, form.value)
    newKeys.value = data
    showCreate.value = false
    fetchKeys()
  } catch {}
}

async function revokeKey(id: string) {
  if (!confirm('Revoke this API key? This cannot be undone.')) return
  try {
    await api.delete(`/api/v1/merchants/${auth.activeMerchantId}/api-keys/${id}`)
    fetchKeys()
  } catch {}
}

onMounted(fetchKeys)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">API Keys</h1>
      <button @click="showCreate = !showCreate; newKeys = null" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">
        {{ showCreate ? 'Cancel' : '+ Create Key Pair' }}
      </button>
    </div>

    <div v-if="newKeys" class="bg-green-50 border border-green-200 rounded-lg p-6 space-y-3">
      <h2 class="font-medium text-green-800">Key Pair Created — Copy Now!</h2>
      <p class="text-sm text-green-700">These keys are shown only once. Store them securely.</p>
      <div>
        <label class="text-xs text-gray-500">Secret Key</label>
        <input :value="newKeys.secretKey.key" readonly class="w-full bg-white border rounded px-3 py-2 text-sm font-mono mt-1" />
      </div>
      <div>
        <label class="text-xs text-gray-500">Publishable Key</label>
        <input :value="newKeys.publishableKey.key" readonly class="w-full bg-white border rounded px-3 py-2 text-sm font-mono mt-1" />
      </div>
      <button @click="newKeys = null" class="text-sm text-green-700 underline">Dismiss</button>
    </div>

    <div v-if="showCreate" class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">New API Key Pair</h2>
      <div class="grid grid-cols-2 gap-4">
        <div><label class="text-xs text-gray-500">Name</label><input v-model="form.name" placeholder="My App" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Mode</label>
          <select v-model="form.mode" class="w-full border rounded px-3 py-2 text-sm mt-1"><option>TEST</option><option>LIVE</option></select>
        </div>
      </div>
      <button @click="createKey" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Create</button>
    </div>

    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">Name</th>
            <th class="px-6 py-3">Type</th>
            <th class="px-6 py-3">Mode</th>
            <th class="px-6 py-3">Prefix</th>
            <th class="px-6 py-3">Last Used</th>
            <th class="px-6 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="k in keys" :key="k.id" class="border-b last:border-0">
            <td class="px-6 py-3">{{ k.name }}</td>
            <td class="px-6 py-3">{{ k.type }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full" :class="k.mode === 'TEST' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'">{{ k.mode }}</span>
            </td>
            <td class="px-6 py-3 font-mono text-xs">{{ k.prefix }}...</td>
            <td class="px-6 py-3 text-gray-500">{{ k.lastUsedAt ? format(new Date(k.lastUsedAt), 'MMM d, HH:mm') : 'Never' }}</td>
            <td class="px-6 py-3">
              <button @click="revokeKey(k.id)" class="text-red-500 hover:text-red-700 text-xs">Revoke</button>
            </td>
          </tr>
          <tr v-if="!keys.length"><td colspan="6" class="px-6 py-8 text-center text-gray-400">No API keys</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
