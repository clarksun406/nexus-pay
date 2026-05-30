<script setup lang="ts">
import { ref } from 'vue'
import api from '@/lib/api'

const email = ref('')
const submitted = ref(false)
const loading = ref(false)

async function submit() {
  if (!email.value) return
  loading.value = true
  try {
    await api.post('/api/v1/auth/forgot-password', { email: email.value })
  } catch { /* always show success — endpoint always returns 204 */ }
  submitted.value = true
  loading.value = false
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-md">
      <div class="bg-white rounded-lg shadow-sm border p-8">
        <h1 class="text-2xl font-bold text-center mb-1">NexusPay</h1>
        <p class="text-sm text-gray-500 text-center mb-6">Reset your password</p>

        <div v-if="submitted" class="bg-green-50 border border-green-200 text-green-700 text-sm rounded px-4 py-3 mb-4">
          If an account exists for <strong>{{ email }}</strong>, we've sent a password reset link. Check your inbox.
        </div>

        <form v-else @submit.prevent="submit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Email</label>
            <input v-model="email" type="email" required placeholder="you@example.com"
                   class="w-full border rounded-md px-3 py-2 text-sm" />
          </div>
          <button type="submit" :disabled="loading || !email"
                  class="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {{ loading ? 'Sending...' : 'Send reset link' }}
          </button>
        </form>

        <p class="text-sm text-center mt-4 text-gray-500">
          <router-link to="/login" class="text-indigo-600 hover:underline">Back to sign in</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
