<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format } from 'date-fns'
import api from '@/lib/api'

const auth = useAuthStore()
const logs = ref<any[]>([])
const loading = ref(true)

async function fetchLogs() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/logs?size=100`)
    logs.value = data.content || []
  } catch { logs.value = [] }
  finally { loading.value = false }
}

onMounted(fetchLogs)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Gateway Logs</h1>
    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">Time</th>
            <th class="px-6 py-3">Method</th>
            <th class="px-6 py-3">Path</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3">Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id" class="border-b last:border-0">
            <td class="px-6 py-3 text-gray-500 text-xs">{{ l.createdAt ? format(new Date(l.createdAt), 'MMM d, HH:mm:ss') : '' }}</td>
            <td class="px-6 py-3 font-mono text-xs">{{ l.method }}</td>
            <td class="px-6 py-3 font-mono text-xs max-w-xs truncate">{{ l.path }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="l.responseStatus < 400 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                {{ l.responseStatus }}
              </span>
            </td>
            <td class="px-6 py-3 text-gray-500 text-xs">{{ l.durationMs }}ms</td>
          </tr>
          <tr v-if="!logs.length"><td colspan="5" class="px-6 py-8 text-center text-gray-400">No logs</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
