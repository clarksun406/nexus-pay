<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const token = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

onMounted(() => {
  token.value = (route.query.token as string) || ''
  if (!token.value) error.value = 'Missing reset token in the link.'
})

async function submit() {
  error.value = ''
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/api/v1/auth/reset-password', {
      token: token.value,
      password: password.value,
    })
    auth.setAuth(data.user, data.accessToken, data.refreshToken, data.memberships)
    router.push('/overview')
  } catch (err: any) {
    error.value = err.response?.data?.detail || 'Failed to reset password.'
  } finally { loading.value = false }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="w-full max-w-md">
      <div class="bg-white rounded-lg shadow-sm border p-8">
        <h1 class="text-2xl font-bold text-center mb-1">NexusPay</h1>
        <p class="text-sm text-gray-500 text-center mb-6">Choose a new password</p>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-4 py-3 mb-4">
          {{ error }}
        </div>

        <form @submit.prevent="submit" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">New password</label>
            <input v-model="password" type="password" required placeholder="••••••••"
                   class="w-full border rounded-md px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Confirm password</label>
            <input v-model="confirmPassword" type="password" required placeholder="••••••••"
                   class="w-full border rounded-md px-3 py-2 text-sm" />
          </div>
          <button type="submit" :disabled="loading || !token"
                  class="w-full bg-indigo-600 text-white rounded-md py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {{ loading ? 'Resetting...' : 'Reset password' }}
          </button>
        </form>

        <p class="text-sm text-center mt-4 text-gray-500">
          <router-link to="/login" class="text-indigo-600 hover:underline">Back to sign in</router-link>
        </p>
      </div>
    </div>
  </div>
</template>
