<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/lib/api'

const auth = useAuthStore()
const keys = ref<any[]>([])

onMounted(async () => {
  try {
    const { data } = await api.get(`/api/v1/merchants/${auth.activeMerchantId}/api-keys`)
    keys.value = data
  } catch {}
})

const sk = keys.value.find((k: any) => k.type === 'SECRET' && k.mode === auth.mode)
const pk = keys.value.find((k: any) => k.type === 'PUBLISHABLE' && k.mode === auth.mode)
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <h1 class="text-2xl font-semibold">Quickstart</h1>

    <div class="bg-white rounded-lg border p-6 space-y-6">
      <h2 class="text-lg font-medium">1. Install the SDK</h2>
      <pre class="bg-gray-900 text-gray-100 rounded p-4 text-sm overflow-x-auto">npm install @nexuspay/server</pre>

      <h2 class="text-lg font-medium">2. Create a Payment Intent</h2>
      <pre class="bg-gray-900 text-gray-100 rounded p-4 text-sm overflow-x-auto">import { NexusPay } from '@nexuspay/server';

const nexuspay = new NexusPay('{{ sk?.plaintextKey || "sk_test_xxx" }}');

const intent = await nexuspay.paymentIntents.create({
  amount: 2000,       // $20.00 in cents
  currency: 'usd',
  idempotencyKey: 'order-123',
});

// Confirm with a payment method
const result = await nexuspay.paymentIntents.confirm(intent.id, {
  paymentMethodId: 'pm_xxx',
});

console.log(result.status); // SUCCEEDED</pre>

      <h2 class="text-lg font-medium">3. Create a Payment Link</h2>
      <pre class="bg-gray-900 text-gray-100 rounded p-4 text-sm overflow-x-auto">const link = await nexuspay.paymentLinks.create({
  title: 'Order #123',
  amount: 4200,
  currency: 'usd',
});

// Send link.payUrl to your customer
console.log(link.payUrl);</pre>

      <h2 class="text-lg font-medium">4. Embed the Checkout</h2>
      <pre class="bg-gray-900 text-gray-100 rounded p-4 text-sm overflow-x-auto">&lt;script src="/gateway-sdk.min.js"&gt;&lt;/script&gt;
&lt;div id="payment-form"&gt;&lt;/div&gt;

&lt;script&gt;
  const gw = new GatewayEmbedded('{{ pk?.plaintextKey || "pk_test_xxx" }}', {
    baseUrl: '{{ "http://localhost:3001" }}',
  });
  await gw.mount('#payment-form');

  gw.on('token', async ({ gatewayToken }) => {
    // Send to your server to confirm
    await fetch('/pay', {
      method: 'POST',
      body: JSON.stringify({ gatewayToken, amount: 2000, currency: 'usd' }),
    });
  });
&lt;/script&gt;</pre>
    </div>
  </div>
</template>
