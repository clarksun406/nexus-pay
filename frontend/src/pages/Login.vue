<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const mfaCode = ref('')
const error = ref('')
const loading = ref(false)
const mfaSession = ref<string | null>(null)

async function handleLogin() {
  error.value = ''
  loading.value = true
  try {
    const { data } = await api.post('/api/v1/auth/login', {
      email: email.value,
      password: password.value,
    })
    if (data.mfaRequired) {
      mfaSession.value = data.mfaSessionToken
    } else {
      auth.setAuth(data.user, data.accessToken, data.refreshToken, data.memberships)
      router.push('/overview')
    }
  } catch (err: any) {
    error.value = err.response?.data?.detail || 'Login failed'
  } finally {
    loading.value = false
  }
}

async function handleMfaVerify() {
  error.value = ''
  loading.value = true
  try {
    const { data } = await api.post('/api/v1/auth/mfa/verify', {
      mfaSessionToken: mfaSession.value,
      code: mfaCode.value,
    })
    auth.setAuth(data.user, data.accessToken, data.refreshToken, data.memberships)
    router.push('/overview')
  } catch (err: any) {
    error.value = err.response?.data?.detail || 'Invalid MFA code'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-md">
      <div class="bg-white rounded-lg shadow-sm border p-8">
        <h1 class="text-2xl font-bold text-center mb-1">NexusPay</h1>
        <p class="text-sm text-gray-500 text-center mb-6">Sign in to your merchant dashboard</p>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3 mb-4">
          {{ error }}
        </div>

        <!-- MFA Step -->
        <form v-if="mfaSession" @submit.prevent="handleMfaVerify" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">MFA Code</label>
            <input
              v-model="mfaCode"
              type="text"
              placeholder="Enter 6-digit code"
              class="w-full border rounded-md px-3 py-2 text-sm"
              maxlength="6"
              autofocus
            />
          </div>
          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {{ loading ? 'Verifying...' : 'Verify' }}
          </button>
        </form>

        <!-- Login Form -->
        <form v-else @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">Email</label>
            <input
              v-model="email"
              type="email"
              placeholder="you@example.com"
              class="w-full border rounded-md px-3 py-2 text-sm"
              required
            />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Password</label>
            <input
              v-model="password"
              type="password"
              placeholder="••••••••"
              class="w-full border rounded-md px-3 py-2 text-sm"
              required
            />
          </div>
          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {{ loading ? 'Signing in...' : 'Sign In' }}
          </button>
        </form>

        <p class="text-sm text-center mt-4 text-gray-500">
          <router-link to="/forgot-password" class="text-indigo-600 hover:underline">Forgot password?</router-link>
        </p>
        <p class="text-sm text-center mt-2 text-gray-500">
          Don't have an account?
          <router-link to="/register" class="text-indigo-600 hover:underline">Register</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
