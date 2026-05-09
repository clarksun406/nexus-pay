<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div class="space-y-6 max-w-2xl">
    <h1 class="text-2xl font-semibold">Merchant Settings</h1>
    <div class="bg-white rounded-lg border p-6 space-y-4">
      <div>
        <label class="text-xs text-gray-500">Merchant ID</label>
        <input :value="auth.activeMerchantId" readonly class="w-full bg-gray-50 border rounded px-3 py-2 text-sm font-mono mt-1" />
      </div>
      <div>
        <label class="text-xs text-gray-500">Organization ID</label>
        <input :value="auth.activeOrgId" readonly class="w-full bg-gray-50 border rounded px-3 py-2 text-sm font-mono mt-1" />
      </div>
    </div>
  </div>
</template>
