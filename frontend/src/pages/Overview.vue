<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { format, subDays } from 'date-fns'
import { Bar } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip } from 'chart.js'
import api from '@/lib/api'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip)

const auth = useAuthStore()
const payments = ref<any[]>([])
const loading = ref(true)

async function fetchPayments() {
  loading.value = true
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/payment-intents?size=200&mode=${auth.mode}`)
    payments.value = data.content || []
  } catch {
    payments.value = []
  } finally {
    loading.value = false
  }
}

const totalVolume = computed(() =>
  payments.value.filter(p => p.status === 'SUCCEEDED').reduce((sum, p) => sum + p.amount, 0)
)
const successRate = computed(() =>
  payments.value.length ? Math.round((payments.value.filter(p => p.status === 'SUCCEEDED').length / payments.value.length) * 100) : 0
)

const chartData = computed(() => {
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = subDays(new Date(), 6 - i)
    const label = format(day, 'MMM d')
    const dayStr = format(day, 'yyyy-MM-dd')
    const volume = payments.value
      .filter(p => p.status === 'SUCCEEDED' && p.createdAt?.startsWith(dayStr))
      .reduce((sum, p) => sum + p.amount / 100, 0)
    return { day: label, volume }
  })
  return {
    labels: days.map(d => d.day),
    datasets: [{
      label: 'Revenue ($)',
      data: days.map(d => d.volume),
      backgroundColor: '#818cf8',
      borderRadius: 4,
    }],
  }
})

const chartOptions = { responsive: true, maintainAspectRatio: false }

onMounted(fetchPayments)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Overview</h1>

    <div class="grid grid-cols-3 gap-4">
      <div class="bg-white rounded-lg border p-6">
        <p class="text-xs text-gray-500">Total Volume (USD)</p>
        <p class="text-2xl font-bold mt-1">${{ (totalVolume / 100).toFixed(2) }}</p>
      </div>
      <div class="bg-white rounded-lg border p-6">
        <p class="text-xs text-gray-500">Total Payments</p>
        <p class="text-2xl font-bold mt-1">{{ payments.length }}</p>
      </div>
      <div class="bg-white rounded-lg border p-6">
        <p class="text-xs text-gray-500">Success Rate</p>
        <p class="text-2xl font-bold mt-1">{{ successRate }}%</p>
      </div>
    </div>

    <div class="bg-white rounded-lg border p-6">
      <h2 class="text-sm font-medium mb-4">Revenue — Last 7 Days</h2>
      <div style="height: 220px">
        <Bar v-if="payments.length" :data="chartData" :options="chartOptions" />
        <div v-else class="flex items-center justify-center h-full text-gray-400 text-sm">No data yet</div>
      </div>
    </div>

    <div class="bg-white rounded-lg border">
      <div class="px-6 py-4 border-b">
        <h2 class="text-sm font-medium">Recent Payments</h2>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">ID</th>
            <th class="px-6 py-3">Amount</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3">Date</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in payments.slice(0, 10)" :key="p.id" class="border-b last:border-0">
            <td class="px-6 py-3 font-mono text-xs">{{ p.id?.slice(0, 8) }}...</td>
            <td class="px-6 py-3">{{ (p.amount / 100).toFixed(2) }} {{ p.currency }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="{
                  'bg-green-100 text-green-700': p.status === 'SUCCEEDED',
                  'bg-red-100 text-red-700': p.status === 'FAILED',
                  'bg-gray-100 text-gray-600': p.status === 'CANCELED',
                  'bg-blue-100 text-blue-700': p.status === 'PROCESSING',
                }">{{ p.status }}</span>
            </td>
            <td class="px-6 py-3 text-gray-500">{{ p.createdAt ? format(new Date(p.createdAt), 'MMM d, HH:mm') : '' }}</td>
          </tr>
          <tr v-if="!payments.length">
            <td colspan="4" class="px-6 py-8 text-center text-gray-400">No payments yet</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
