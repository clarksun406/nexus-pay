<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const rules = ref<any[]>([])
const showCreate = ref(false)
const form = ref({ priority: 1, targetProvider: 'STRIPE', weight: 1, enabled: true, currencies: '', amountMin: '', amountMax: '' })

async function fetchRules() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/routing-rules`)
    rules.value = data
  } catch { rules.value = [] }
}

async function createRule() {
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/routing-rules`, {
      priority: form.value.priority,
      targetProvider: form.value.targetProvider,
      weight: form.value.weight,
      enabled: form.value.enabled,
      currencies: form.value.currencies ? form.value.currencies.split(',').map(s => s.trim()) : undefined,
      amountMin: form.value.amountMin ? parseInt(form.value.amountMin) : undefined,
      amountMax: form.value.amountMax ? parseInt(form.value.amountMax) : undefined,
    })
    showCreate.value = false
    fetchRules()
  } catch {}
}

async function deleteRule(id: string) {
  if (!confirm('Delete this rule?')) return
  try {
    await api.delete(`/api/v1/merchants/${auth.activeMerchantId}/routing-rules/${id}`)
    fetchRules()
  } catch {}
}

onMounted(fetchRules)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Routing Rules</h1>
      <button @click="showCreate = !showCreate" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">
        {{ showCreate ? 'Cancel' : '+ Add Rule' }}
      </button>
    </div>

    <div v-if="showCreate" class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">New Routing Rule</h2>
      <div class="grid grid-cols-3 gap-4">
        <div><label class="text-xs text-gray-500">Priority</label><input v-model.number="form.priority" type="number" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Provider</label>
          <select v-model="form.targetProvider" class="w-full border rounded px-3 py-2 text-sm mt-1">
            <option>STRIPE</option><option>SQUARE</option><option>BRAINTREE</option>
          </select>
        </div>
        <div><label class="text-xs text-gray-500">Weight</label><input v-model.number="form.weight" type="number" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Currencies (comma-separated)</label><input v-model="form.currencies" placeholder="USD,EUR" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Min Amount</label><input v-model="form.amountMin" type="number" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Max Amount</label><input v-model="form.amountMax" type="number" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
      </div>
      <button @click="createRule" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Create Rule</button>
    </div>

    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">Priority</th>
            <th class="px-6 py-3">Provider</th>
            <th class="px-6 py-3">Weight</th>
            <th class="px-6 py-3">Currencies</th>
            <th class="px-6 py-3">Enabled</th>
            <th class="px-6 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rules" :key="r.id" class="border-b last:border-0">
            <td class="px-6 py-3">{{ r.priority }}</td>
            <td class="px-6 py-3">{{ r.targetProvider }}</td>
            <td class="px-6 py-3">{{ r.weight }}</td>
            <td class="px-6 py-3">{{ r.currencies?.join(', ') || 'All' }}</td>
            <td class="px-6 py-3">
              <span :class="r.enabled ? 'text-green-600' : 'text-gray-400'">{{ r.enabled ? 'Yes' : 'No' }}</span>
            </td>
            <td class="px-6 py-3">
              <button @click="deleteRule(r.id)" class="text-red-500 hover:text-red-700 text-xs">Delete</button>
            </td>
          </tr>
          <tr v-if="!rules.length"><td colspan="6" class="px-6 py-8 text-center text-gray-400">No routing rules</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
