const express = require('express');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const supabase = require('../config/supabase');
const paystack = require('../config/paystack');

const router = express.Router();

async function getPlatformFeeSettings() {
  const { data } = await supabase.from('platform_settings').select('*');
  const map = {};
  (data || []).forEach((row) => { map[row.key] = row.value; });
  return {
    percent: Number(map.platform_fee_percent || 0),
    flat: Number(map.platform_fee_flat || 0)
  };
}

function computeFee(amount, { percent, flat }) {
  const fee = Math.round((amount * percent) / 100 + flat);
  return Math.max(0, Math.min(fee, amount)); // fee can never exceed the amount
}

// POST /api/payments/initialize
// body: { campaign_id, amount, method: 'mpesa' | 'card', phone (mpesa only),
//         callback_url (card only), supporter_name, message, show_name_publicly,
//         is_anonymous, items: [{ support_item_id, name, quantity, unit_price }] }
router.post('/initialize', async (req, res) => {
  try {
    const {
      campaign_id, amount, method, phone, callback_url, supporter_name, message,
      show_name_publicly, is_anonymous, items
    } = req.body;

    const paymentMethod = method === 'card' ? 'card' : 'mpesa';

    const numericAmount = Number(amount);
    if (!campaign_id || !numericAmount || numericAmount < 1) {
      return res.status(400).json({ error: 'A valid campaign and amount are required' });
    }
    if (paymentMethod === 'mpesa' && !phone) {
      return res.status(400).json({ error: 'An M-Pesa phone number is required' });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, status')
      .eq('id', campaign_id)
      .maybeSingle();

    if (!campaign || campaign.status !== 'active') {
      return res.status(404).json({ error: 'Campaign is not available for support right now' });
    }

    const feeSettings = await getPlatformFeeSettings();
    const platform_fee = computeFee(numericAmount, feeSettings);
    const net_amount = numericAmount - platform_fee;
    const payment_reference = `FUNDME-${Date.now()}-${nanoid(8)}`;

    // Paystack's charge/transaction APIs require an email even though
    // supporters only give a phone number for M-Pesa. Card supporters may not
    // give either, so fall back to a reference-based placeholder for card.
    let supporterEmail;
    let paystackPhone;
    if (paymentMethod === 'mpesa') {
      const phoneDigits = String(phone).replace(/\D/g, '');
      supporterEmail = `${phoneDigits}@gmail.com`;

      // Paystack expects Kenyan mobile money numbers in international format
      // (2547XXXXXXXX / 2541XXXXXXXX), but supporters naturally type the
      // local 07XX/01XX format. Normalize whatever they enter.
      function toPaystackPhone(raw) {
        let digits = String(raw).replace(/\D/g, '');
        if (digits.startsWith('0')) digits = '254' + digits.slice(1);
        else if (digits.startsWith('7') || digits.startsWith('1')) digits = '254' + digits;
        return `+${digits}`;
      }
      paystackPhone = toPaystackPhone(phone);
    } else {
      supporterEmail = `${payment_reference.toLowerCase()}@fundme.co.ke`;
    }

    const { data: payment, error } = await supabase
      .from('payments')
      .insert({
        campaign_id,
        supporter_name: is_anonymous ? null : supporter_name || null,
        supporter_message: message || null,
        show_name_publicly: !!show_name_publicly && !is_anonymous,
        is_anonymous: !!is_anonymous,
        amount: numericAmount,
        platform_fee,
        net_amount,
        currency: 'KES',
        payment_reference,
        payment_method: paymentMethod,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;

    if (Array.isArray(items) && items.length) {
      const rows = items
        .filter((it) => it.quantity > 0)
        .map((it) => ({
          payment_id: payment.id,
          support_item_id: it.support_item_id || null,
          quantity: it.quantity,
          unit_price: it.unit_price,
          subtotal: it.quantity * it.unit_price
        }));
      if (rows.length) await supabase.from('payment_items').insert(rows);
    }

    if (paymentMethod === 'mpesa') {
      // Trigger the Paystack M-Pesa (mobile money) STK push.
      const chargeResponse = await paystack.post('/charge', {
        amount: Math.round(numericAmount * 100),
        email: supporterEmail,
        currency: 'KES',
        mobile_money: { phone: paystackPhone, provider: 'mpesa' },
        reference: payment_reference,
        metadata: { campaign_id, payment_id: payment.id }
      });

      return res.json({
        method: 'mpesa',
        reference: payment_reference,
        status: chargeResponse.data?.data?.status || 'pending',
        display_text: chargeResponse.data?.data?.display_text ||
          'Check your phone and enter your M-Pesa PIN to complete this support.'
      });
    }

    // Card payment: Paystack's standard hosted checkout. The supporter is
    // redirected to authorization_url to enter card details, then Paystack
    // sends them back to callback_url. The webhook (not this response, and
    // not the redirect) is still the only thing that ever marks the payment
    // successful.
    const initResponse = await paystack.post('/transaction/initialize', {
      amount: Math.round(numericAmount * 100),
      email: supporterEmail,
      currency: 'KES',
      reference: payment_reference,
      callback_url: callback_url || undefined,
      metadata: { campaign_id, payment_id: payment.id }
    });

    res.json({
      method: 'card',
      reference: payment_reference,
      authorization_url: initResponse.data?.data?.authorization_url
    });
  } catch (err) {
    const paystackError = err.response?.data;
    console.error('Initialize payment error:', paystackError || err.message);
    res.status(500).json({
      error: paystackError?.message || 'Could not start the M-Pesa payment. Please try again.'
    });
  }
});

// GET /api/payments/:reference/status
// Used by the frontend to poll while the supporter completes the M-Pesa prompt.
// This never marks a payment successful by itself - it only reports what the
// webhook (the source of truth) has already recorded.
router.get('/:reference/status', async (req, res) => {
  const { data: payment } = await supabase
    .from('payments')
    .select('status, amount, currency')
    .eq('payment_reference', req.params.reference)
    .maybeSingle();

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

// POST /api/payments/webhook
// Paystack webhook - the only place a payment is ever marked successful.
// Must be mounted with express.raw() so the signature can be verified against
// the exact raw request body (see server.js).
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-paystack-signature'];
    const expected = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(req.body) // raw Buffer
      .digest('hex');

    if (signature !== expected) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString('utf8'));
    res.sendStatus(200); // acknowledge immediately, Paystack retries otherwise

    if (event.event !== 'charge.success') return;

    const reference = event.data.reference;

    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_reference', reference)
      .maybeSingle();

    if (!payment) return;
    if (payment.status === 'successful') return; // duplicate webhook - already processed

    await supabase
      .from('payments')
      .update({ status: 'successful' })
      .eq('id', payment.id)
      .eq('status', 'pending'); // guards against a race between two webhook deliveries

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('amount_collected')
      .eq('id', payment.campaign_id)
      .single();

    await supabase
      .from('campaigns')
      .update({ amount_collected: Number(campaign.amount_collected) + Number(payment.net_amount) })
      .eq('id', payment.campaign_id);
  } catch (err) {
    console.error('Webhook error:', err);
    // response already sent above
  }
});

module.exports = router;
