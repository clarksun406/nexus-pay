<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const members = ref<any[]>([])

async function fetchMembers() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/members`)
    members.value = data
  } catch { members.value = [] }
}

onMounted(fetchMembers)
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">Team Members</h1>
    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">Email</th>
            <th class="px-6 py-3">Role</th>
            <th class="px-6 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id" class="border-b last:border-0">
            <td class="px-6 py-3">{{ m.email }}</td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{{ m.role }}</span>
            </td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full"
                :class="m.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'">
                {{ m.status }}
              </span>
            </td>
          </tr>
          <tr v-if="!members.length"><td colspan="3" class="px-6 py-8 text-center text-gray-400">No members</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
