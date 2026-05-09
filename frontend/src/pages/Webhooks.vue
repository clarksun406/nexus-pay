<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const endpoints = ref<any[]>([])
const showCreate = ref(false)
const form = ref({ url: '', description: '', subscribedEvents: 'payment_intent.succeeded,payment_intent.failed' })

async function fetchEndpoints() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/webhook-endpoints`)
    endpoints.value = data
  } catch { endpoints.value = [] }
}

async function createEndpoint() {
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/webhook-endpoints`, {
      url: form.value.url,
      description: form.value.description || undefined,
      subscribedEvents: form.value.subscribedEvents.split(',').map(s => s.trim()),
    })
    showCreate.value = false
    fetchEndpoints()
  } catch {}
}

async function deleteEndpoint(id: string) {
  if (!confirm('Delete this webhook endpoint?')) return
  try {
    await api.delete(`/api/v1/merchants/${auth.activeMerchantId}/webhook-endpoints/${id}`)
    fetchEndpoints()
  } catch {}
}

onMounted(fetchEndpoints)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Webhook Endpoints</h1>
      <button @click="showCreate = !showCreate" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">
        {{ showCreate ? 'Cancel' : '+ Add Endpoint' }}
      </button>
    </div>

    <div v-if="showCreate" class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">New Webhook Endpoint</h2>
      <div class="space-y-3">
        <div><label class="text-xs text-gray-500">URL</label><input v-model="form.url" placeholder="https://example.com/webhook" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Description</label><input v-model="form.description" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Events (comma-separated)</label><input v-model="form.subscribedEvents" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
      </div>
      <button @click="createEndpoint" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Create</button>
    </div>

    <div class="grid gap-4">
      <div v-for="e in endpoints" :key="e.id" class="bg-white rounded-lg border p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="font-mono text-sm">{{ e.url }}</p>
            <p v-if="e.description" class="text-sm text-gray-500 mt-1">{{ e.description }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs px-2 py-0.5 rounded-full" :class="e.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">{{ e.status }}</span>
            <button @click="deleteEndpoint(e.id)" class="text-red-500 hover:text-red-700 text-xs">Delete</button>
          </div>
        </div>
        <div class="mt-2">
          <p class="text-xs text-gray-500">Events: {{ e.subscribedEvents?.join(', ') }}</p>
          <p class="text-xs text-gray-500 mt-1">Signing Secret: <code class="bg-gray-100 px-1 rounded">{{ e.signingSecret?.slice(0, 15) }}...</code></p>
        </div>
      </div>
      <div v-if="!endpoints.length" class="text-center py-12 text-gray-400">No webhook endpoints</div>
    </div>
  </div>
</template>
