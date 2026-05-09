<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const mfaEnabled = ref(false)
const showSetup = ref(false)
const secret = ref('')
const qrCode = ref('')
const confirmCode = ref('')
const backupCodes = ref<string[]>([])
const disableCode = ref('')

async function checkMfa() {
  try {
    const { data } = await api.get('/api/v1/auth/mfa/status')
    mfaEnabled.value = data.mfaEnabled
  } catch {}
}

async function setupMfa() {
  try {
    const { data } = await api.post('/api/v1/auth/mfa/setup')
    secret.value = data.secret
    qrCode.value = data.qrCode
    showSetup.value = true
  } catch {}
}

async function confirmMfa() {
  try {
    const { data } = await api.post('/api/v1/auth/mfa/confirm', { code: confirmCode.value })
    backupCodes.value = data.backupCodes
    mfaEnabled.value = true
    showSetup.value = false
  } catch {}
}

async function disableMfa() {
  try {
    await api.delete('/api/v1/auth/mfa', { data: { code: disableCode.value } })
    mfaEnabled.value = false
    disableCode.value = ''
  } catch {}
}

onMounted(checkMfa)
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <h1 class="text-2xl font-semibold">Security Settings</h1>

    <div class="bg-white rounded-lg border p-6 space-y-4">
      <h2 class="font-medium">Multi-Factor Authentication</h2>

      <div v-if="mfaEnabled && !backupCodes.length" class="space-y-3">
        <p class="text-sm text-green-700">MFA is enabled</p>
        <div class="flex gap-2">
          <input v-model="disableCode" placeholder="Enter TOTP code to disable" class="flex-1 border rounded px-3 py-2 text-sm" />
          <button @click="disableMfa" class="bg-red-600 text-white text-sm px-4 py-2 rounded-md hover:bg-red-700">Disable MFA</button>
        </div>
      </div>

      <div v-else-if="!mfaEnabled && !showSetup" class="space-y-3">
        <p class="text-sm text-gray-500">Add an extra layer of security to your account</p>
        <button @click="setupMfa" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Enable MFA</button>
      </div>

      <div v-if="showSetup" class="space-y-4">
        <p class="text-sm text-gray-500">Scan this QR code with your authenticator app, then enter the code below.</p>
        <div class="bg-gray-50 rounded p-4">
          <p class="text-xs text-gray-500 mb-1">Secret (manual entry):</p>
          <code class="text-sm font-mono">{{ secret }}</code>
        </div>
        <div class="flex gap-2">
          <input v-model="confirmCode" placeholder="Enter 6-digit code" maxlength="6" class="flex-1 border rounded px-3 py-2 text-sm" />
          <button @click="confirmMfa" class="bg-indigo-600 text-white text-sm px-4 py-2 rounded-md hover:bg-indigo-700">Confirm</button>
        </div>
      </div>

      <div v-if="backupCodes.length" class="space-y-3">
        <h3 class="font-medium text-green-700">MFA Enabled! Save your backup codes:</h3>
        <div class="bg-gray-50 rounded p-4 grid grid-cols-2 gap-2">
          <code v-for="code in backupCodes" :key="code" class="text-sm font-mono">{{ code }}</code>
        </div>
        <p class="text-xs text-red-500">These codes are shown only once. Store them securely.</p>
      </div>
    </div>
  </div>
</template>
