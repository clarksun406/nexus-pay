<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-gray-50">
    <Sidebar />
    <div class="flex flex-col flex-1 overflow-hidden">
      <TopBar />
      <main class="flex-1 overflow-y-auto p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
