<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  LayoutDashboard, CreditCard, RotateCcw, GitBranch,
  Key, Webhook, FileText, Users, Settings, ChevronRight, Plug, Link2, Zap, ShieldCheck,
} from 'lucide-vue-next'

const route = useRoute()
const auth = useAuthStore()

interface NavItem {
  href?: string
  label: string
  icon: any
  children?: NavItem[]
}

const nav: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/refunds', label: 'Refunds', icon: RotateCcw },
  { href: '/routing/rules', label: 'Routing Rules', icon: GitBranch },
  { href: '/connectors', label: 'Connectors', icon: Plug },
  { href: '/payment-links', label: 'Payment Links', icon: Link2 },
  {
    label: 'Developers', icon: Key,
    children: [
      { href: '/developers/quickstart', label: 'Quickstart', icon: Zap },
      { href: '/developers/api-keys', label: 'API Keys', icon: Key },
      { href: '/developers/webhooks', label: 'Webhooks', icon: Webhook },
      { href: '/developers/logs', label: 'Logs', icon: FileText },
    ],
  },
  { href: '/team', label: 'Team', icon: Users },
  {
    label: 'Settings', icon: Settings,
    children: [
      { href: '/settings/merchant', label: 'Merchant', icon: Settings },
      { href: '/settings/security', label: 'Security', icon: ShieldCheck },
    ],
  },
]

const openSections = ref<Record<string, boolean>>({
  Developers: route.path.startsWith('/developers'),
  Settings: route.path.startsWith('/settings'),
})

function toggle(label: string) {
  openSections.value[label] = !openSections.value[label]
}

function isActive(href: string) {
  return route.path.startsWith(href)
}
</script>

<template>
  <aside class="w-60 shrink-0 border-r bg-white flex flex-col h-full">
    <div class="px-6 py-5 border-b">
      <span class="font-semibold text-lg tracking-tight">NexusPay</span>
    </div>

    <!-- Merchant Switcher -->
    <div class="border-b px-4 py-3">
      <select
        v-if="auth.merchants.length"
        class="w-full text-sm border rounded px-2 py-1.5 bg-white"
        :value="auth.activeMerchantId"
        @change="auth.setActiveMerchant(auth.activeOrgId!, ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="m in auth.merchants" :key="m.merchantId" :value="m.merchantId">
          {{ m.merchantName }}
        </option>
      </select>
      <div class="flex items-center gap-2 mt-2">
        <button
          @click="auth.toggleMode()"
          class="text-xs px-2 py-0.5 rounded-full font-medium"
          :class="auth.mode === 'TEST' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'"
        >
          {{ auth.mode }}
        </button>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto py-4 px-3">
      <template v-for="item in nav" :key="item.label">
        <div v-if="item.children" class="mb-1">
          <button
            @click="toggle(item.label)"
            class="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider hover:text-gray-700 transition-colors"
          >
            <component :is="item.icon" class="w-4 h-4" />
            {{ item.label }}
            <ChevronRight class="w-3 h-3 ml-auto transition-transform" :class="{ 'rotate-90': openSections[item.label] }" />
          </button>
          <div v-if="openSections[item.label]">
            <router-link
              v-for="child in item.children"
              :key="child.href"
              :to="child.href!"
              class="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors pl-6"
              :class="isActive(child.href!) ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'"
            >
              <component :is="child.icon" class="w-4 h-4" />
              {{ child.label }}
              <ChevronRight v-if="isActive(child.href!)" class="w-3 h-3 ml-auto" />
            </router-link>
          </div>
        </div>
        <router-link
          v-else
          :to="item.href!"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors mb-0.5"
          :class="isActive(item.href!) ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'"
        >
          <component :is="item.icon" class="w-4 h-4" />
          {{ item.label }}
          <ChevronRight v-if="isActive(item.href!)" class="w-3 h-3 ml-auto" />
        </router-link>
      </template>
    </nav>
  </aside>
</template>
