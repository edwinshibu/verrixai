const ALLOWED_ORIGIN = 'https://verrixai.com';

const PRICES = {
  pro_monthly:  'price_1T9lADHHwf5U84kmve42m93y',
  pro_annual:   'price_1T9lB6HHwf5U84kmXzEJv35z',
  pro2_monthly: 'price_1T9lBTHHwf5U84kmR25IuOPk',
  pro2_annual:  'price_1T9lBuHHwf5U84kmMjEgqQ9o',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  const token = authHeader.split(' ')[1];

  const { plan, billing } = req.body || {};
  const priceKey = `${plan}_${billing}`;
  const priceId  = PRICES[priceKey];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan or billing cycle' });

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

  try {
    // Verify user token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY }
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData.id) return res.status(401).json({ error: 'Unauthorised' });

    // Create Stripe checkout session
    const params = new URLSearchParams({
      'mode': 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'success_url': `https://verrixai.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url': `https://verrixai.com/?checkout=cancelled`,
      'customer_email': userData.email,
      'metadata[user_id]': userData.id,
      'metadata[plan]': plan,
      'metadata[billing]': billing,
      'subscription_data[metadata][user_id]': userData.id,
      'subscription_data[metadata][plan]': plan,
      'allow_promotion_codes': 'true',
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok) throw new Error(session.error?.message || 'Stripe error');

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
