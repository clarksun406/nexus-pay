import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/Login.vue'),
      meta: { guest: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/pages/Register.vue'),
      meta: { guest: true },
    },
    {
      path: '/accept-invite',
      name: 'accept-invite',
      component: () => import('@/pages/AcceptInvite.vue'),
      meta: { public: true },
    },
    {
      path: '/pay/:token',
      name: 'pay',
      component: () => import('@/pages/Pay.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/Dashboard.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/overview' },
        { path: 'overview', name: 'overview', component: () => import('@/pages/Overview.vue') },
        { path: 'payments', name: 'payments', component: () => import('@/pages/Payments.vue') },
        { path: 'payments/:id', name: 'payment-detail', component: () => import('@/pages/PaymentDetail.vue') },
        { path: 'refunds', name: 'refunds', component: () => import('@/pages/Refunds.vue') },
        { path: 'routing/rules', name: 'routing-rules', component: () => import('@/pages/RoutingRules.vue') },
        { path: 'connectors', name: 'connectors', component: () => import('@/pages/Connectors.vue') },
        { path: 'payment-links', name: 'payment-links', component: () => import('@/pages/PaymentLinks.vue') },
        { path: 'developers/quickstart', name: 'quickstart', component: () => import('@/pages/Quickstart.vue') },
        { path: 'developers/api-keys', name: 'api-keys', component: () => import('@/pages/ApiKeys.vue') },
        { path: 'developers/webhooks', name: 'webhooks', component: () => import('@/pages/Webhooks.vue') },
        { path: 'developers/logs', name: 'logs', component: () => import('@/pages/Logs.vue') },
        { path: 'team', name: 'team', component: () => import('@/pages/Team.vue') },
        { path: 'settings/merchant', name: 'settings-merchant', component: () => import('@/pages/SettingsMerchant.vue') },
        { path: 'settings/security', name: 'settings-security', component: () => import('@/pages/SettingsSecurity.vue') },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' }
  }
  if (to.meta.guest && auth.isAuthenticated) {
    return { name: 'overview' }
  }
})

export default router
