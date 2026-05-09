<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const merchantName = ref('')
const error = ref('')
const loading = ref(false)

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    const { data } = await api.post('/api/v1/auth/register', {
      email: email.value,
      password: password.value,
      merchantName: merchantName.value || undefined,
    })
    auth.setAuth(data.user, data.accessToken, data.refreshToken, data.memberships)
    router.push('/overview')
  } catch (err: any) {
    error.value = err.response?.data?.detail || 'Registration failed'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-md">
      <div class="bg-white rounded-lg shadow-sm border p-8">
        <h1 class="text-2xl font-bold text-center mb-1">Create Account</h1>
        <p class="text-sm text-gray-500 text-center mb-6">Set up your NexusPay merchant account</p>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3 mb-4">
          {{ error }}
        </div>

        <form @submit.prevent="handleRegister" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Email</label>
            <input v-model="email" type="email" class="w-full border rounded-md px-3 py-2 text-sm" required />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Password</label>
            <input v-model="password" type="password" class="w-full border rounded-md px-3 py-2 text-sm" minlength="8" required />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Merchant Name <span class="text-gray-400">(optional)</span></label>
            <input v-model="merchantName" type="text" placeholder="My Store" class="w-full border rounded-md px-3 py-2 text-sm" />
          </div>
          <button type="submit" :disabled="loading" class="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {{ loading ? 'Creating...' : 'Create Account' }}
          </button>
        </form>

        <p class="text-sm text-center mt-4 text-gray-500">
          Already have an account?
          <router-link to="/login" class="text-indigo-600 hover:underline">Sign in</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
