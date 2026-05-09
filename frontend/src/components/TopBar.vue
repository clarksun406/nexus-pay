<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { LogOut, User } from 'lucide-vue-next'

const router = useRouter()
const auth = useAuthStore()

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <header class="h-14 border-b bg-white flex items-center justify-between px-6">
    <div class="text-sm text-gray-500">
      Merchant Dashboard
    </div>
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2 text-sm">
        <User class="w-4 h-4 text-gray-400" />
        <span>{{ auth.user?.email }}</span>
      </div>
      <button @click="handleLogout" class="text-gray-400 hover:text-gray-600 transition-colors">
        <LogOut class="w-4 h-4" />
      </button>
    </div>
  </header>
</template>
