<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const members = ref<any[]>([])

const showInvite = ref(false)
const inviting = ref(false)
const inviteError = ref('')
const form = ref({ email: '', role: 'VIEWER' })
const lastInvite = ref<{ email: string; inviteUrl: string } | null>(null)
const copied = ref(false)

const roles = ['ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER']

async function fetchMembers() {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/members`)
    members.value = data
  } catch { members.value = [] }
}

async function sendInvite() {
  inviteError.value = ''
  inviting.value = true
  try {
    const { data } = await api.post(`/api/v1/merchants/${auth.activeMerchantId}/members/invite`, {
      email: form.value.email,
      role: form.value.role,
    })
    lastInvite.value = { email: data.email, inviteUrl: data.inviteUrl }
    form.value.email = ''
    copied.value = false
    await fetchMembers()
  } catch (err: any) {
    inviteError.value = err.response?.data?.detail || 'Failed to send invite'
  } finally {
    inviting.value = false
  }
}

async function copyInviteUrl() {
  if (!lastInvite.value) return
  try {
    await navigator.clipboard.writeText(lastInvite.value.inviteUrl)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {}
}

async function updateRole(member: any, role: string) {
  if (role === member.role) return
  try {
    await api.put(`/api/v1/merchants/${auth.activeMerchantId}/members/${member.id}`, { role })
    await fetchMembers()
  } catch {}
}

async function removeMember(member: any) {
  if (!confirm(`Remove ${member.email} from this merchant?`)) return
  try {
    await api.delete(`/api/v1/merchants/${auth.activeMerchantId}/members/${member.id}`)
    await fetchMembers()
  } catch {}
}

onMounted(fetchMembers)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Team Members</h1>
      <button @click="showInvite = !showInvite" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">
        {{ showInvite ? 'Cancel' : '+ Invite Member' }}
      </button>
    </div>

    <div v-if="showInvite" class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">Invite a new member</h2>
      <div v-if="inviteError" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-2">{{ inviteError }}</div>
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex-1 min-w-[220px]">
          <label class="text-xs text-gray-500">Email</label>
          <input v-model="form.email" type="email" placeholder="teammate@example.com" class="w-full border rounded px-3 py-2 text-sm mt-1" />
        </div>
        <div>
          <label class="text-xs text-gray-500">Role</label>
          <select v-model="form.role" class="border rounded px-3 py-2 text-sm mt-1">
            <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
          </select>
        </div>
        <button @click="sendInvite" :disabled="inviting || !form.email" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50">
          {{ inviting ? 'Sending...' : 'Send Invite' }}
        </button>
      </div>

      <div v-if="lastInvite" class="bg-green-50 border border-green-200 rounded p-4 text-sm">
        <p class="text-green-800 mb-2">Invitation created for <strong>{{ lastInvite.email }}</strong>. Share this link so they can set a password and join:</p>
        <div class="flex items-center gap-2">
          <code class="flex-1 bg-white border rounded px-2 py-1 text-xs truncate">{{ lastInvite.inviteUrl }}</code>
          <button @click="copyInviteUrl" class="text-indigo-600 text-xs hover:underline whitespace-nowrap">{{ copied ? 'Copied!' : 'Copy' }}</button>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-lg border">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-gray-500 text-left">
            <th class="px-6 py-3">Email</th>
            <th class="px-6 py-3">Role</th>
            <th class="px-6 py-3">Status</th>
            <th class="px-6 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in members" :key="m.id" class="border-b last:border-0">
            <td class="px-6 py-3">{{ m.email }}</td>
            <td class="px-6 py-3">
              <select v-if="m.role !== 'OWNER'" :value="m.role" @change="updateRole(m, ($event.target as HTMLSelectElement).value)"
                class="text-xs border rounded px-2 py-1 bg-indigo-50 text-indigo-700 font-medium">
                <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
              </select>
              <span v-else class="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">OWNER</span>
            </td>
            <td class="px-6 py-3">
              <span class="text-xs px-2 py-0.5 rounded-full"
                :class="m.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'">
                {{ m.status }}
              </span>
            </td>
            <td class="px-6 py-3 text-right">
              <button v-if="m.role !== 'OWNER'" @click="removeMember(m)" class="text-red-500 hover:text-red-700 text-xs">Remove</button>
            </td>
          </tr>
          <tr v-if="!members.length"><td colspan="4" class="px-6 py-8 text-center text-gray-400">No members</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
