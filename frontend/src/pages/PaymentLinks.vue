<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const links = ref<any[]>([])
const showCreate = ref(false)
const form = ref({ title: '', description: '', amount: '', currency: 'usd', redirectUrl: '' })

async function fetchLinks() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payment-links?mode=${auth.mode}`)
    links.value = data
  } catch { links.value = [] }
}

async function createLink() {
  try {
    await api.post(`/api/v1/merchants/${auth.activeMerchantId}/payment-links`, {
      title: form.value.title,
      description: form.value.description || undefined,
      amount: parseInt(form.value.amount),
      currency: form.value.currency,
      mode: auth.mode,
      redirectUrl: form.value.redirectUrl || undefined,
    })
    showCreate.value = false
    form.value = { title: '', description: '', amount: '', currency: 'usd', redirectUrl: '' }
    fetchLinks()
  } catch {}
}

function copyUrl(url: string) {
  navigator.clipboard.writeText(url)
}

onMounted(fetchLinks)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Payment Links</h1>
      <button @click="showCreate = !showCreate" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">
        {{ showCreate ? 'Cancel' : '+ Create Link' }}
      </button>
    </div>

    <div v-if="showCreate" class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">New Payment Link</h2>
      <div class="grid grid-cols-2 gap-4">
        <div><label class="text-xs text-gray-500">Title</label><input v-model="form.title" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Amount (cents)</label><input v-model="form.amount" type="number" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Currency</label><input v-model="form.currency" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div><label class="text-xs text-gray-500">Redirect URL</label><input v-model="form.redirectUrl" class="w-full border rounded px-3 py-2 text-sm mt-1" /></div>
        <div class="col-span-2"><label class="text-xs text-gray-500">Description</label><textarea v-model="form.description" class="w-full border rounded px-3 py-2 text-sm mt-1" rows="2"></textarea></div>
      </div>
      <button @click="createLink" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Create</button>
    </div>

    <div class="grid gap-4">
      <div v-for="l in links" :key="l.id" class="bg-white rounded-lg border p-6">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">{{ l.title }}</h3>
            <p class="text-sm text-gray-500 mt-1">{{ (l.amount / 100).toFixed(2) }} {{ l.currency.toUpperCase() }}</p>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="l.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">{{ l.status }}</span>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <input :value="l.payUrl" readonly class="flex-1 bg-gray-50 border rounded px-3 py-1.5 text-xs font-mono" />
          <button @click="copyUrl(l.payUrl)" class="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Copy</button>
        </div>
      </div>
      <div v-if="!links.length" class="text-center py-12 text-gray-400">No payment links</div>
    </div>
  </div>
</template>
