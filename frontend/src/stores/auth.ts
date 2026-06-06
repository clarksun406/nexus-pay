import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/lib/api'

export interface AuthUser {
  id: string
  email: string
  mfaEnabled: boolean
}

export interface MerchantMembership {
  merchantId: string
  merchantName: string
  role: string
}

export interface OrgMembership {
  organizationId: string
  organizationName: string
  orgRole: string
  merchants: MerchantMembership[]
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  const memberships = ref<OrgMembership[]>([])
  const activeOrgId = ref<string | null>(null)
  const activeMerchantId = ref<string | null>(null)
  const mode = ref<'TEST' | 'LIVE'>('TEST')

  const isAuthenticated = computed(() => !!accessToken.value)

  /** Flat list of all merchants across all org memberships. */
  const merchants = computed<MerchantMembership[]>(() =>
    memberships.value.flatMap(m => m.merchants)
  )

  function setTokens(access: string, refresh: string) {
    accessToken.value = access
    refreshToken.value = refresh
  }

  function setAuth(u: AuthUser, access: string, refresh: string, mems: OrgMembership[]) {
    user.value = u
    accessToken.value = access
    refreshToken.value = refresh
    memberships.value = mems
    const firstOrg = mems[0]
    const firstMerchant = firstOrg?.merchants[0]
    activeOrgId.value = firstOrg?.organizationId ?? null
    activeMerchantId.value = firstMerchant?.merchantId ?? null
  }

  function setActiveMerchant(orgId: string, merchantId: string) {
    activeOrgId.value = orgId
    activeMerchantId.value = merchantId
  }

  function toggleMode() {
    mode.value = mode.value === 'TEST' ? 'LIVE' : 'TEST'
  }

  function logout() {
    user.value = null
    accessToken.value = null
    refreshToken.value = null
    memberships.value = []
    activeOrgId.value = null
    activeMerchantId.value = null
  }

  async function fetchMe() {
    try {
      const { data } = await api.get('/api/v1/me')
      user.value = { id: data.id, email: data.email, mfaEnabled: data.mfaEnabled }
      memberships.value = data.memberships
      if (!activeOrgId.value && data.memberships.length) {
        const firstOrg = data.memberships[0]
        const firstMerchant = firstOrg?.merchants[0]
        activeOrgId.value = firstOrg?.organizationId ?? null
        activeMerchantId.value = firstMerchant?.merchantId ?? null
      }
    } catch {
      // ignore
    }
  }

  return {
    user, accessToken, refreshToken, memberships,
    activeOrgId, activeMerchantId, mode,
    isAuthenticated, merchants,
    setTokens, setAuth, setActiveMerchant, toggleMode, logout, fetchMe,
  }
}, {
  persist: true,
})
