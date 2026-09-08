const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function getAvailableBalance(campaignId) {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('amount_collected')
    .eq('id', campaignId)
    .single();

  const { data: reserved } = await supabase
    .from('withdrawals')
    .select('amount')
    .eq('campaign_id', campaignId)
    .in('status', ['pending', 'processing', 'paid']);

  const reservedTotal = (reserved || []).reduce((sum, w) => sum + Number(w.amount), 0);
  return Number(campaign.amount_collected) - reservedTotal;
}

// POST /api/withdrawals - request a withdrawal
router.post('/', requireAuth, async (req, res) => {
  try {
    const { campaign_id, amount, method, bank_name, account_name, account_number, mpesa_name, mpesa_phone } = req.body;
    const numericAmount = Number(amount);

    if (!campaign_id || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'A valid campaign and amount are required' });
    }
    if (!['bank', 'mpesa'].includes(method)) {
      return res.status(400).json({ error: 'Choose a withdrawal method' });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, user_id')
      .eq('id', campaign_id)
      .maybeSingle();

    if (!campaign || campaign.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only withdraw from your own campaign' });
    }

    const available = await getAvailableBalance(campaign_id);
    if (numericAmount > available) {
      return res.status(400).json({ error: `Amount exceeds your available balance of KSh ${available.toLocaleString()}` });
    }

    if (method === 'bank' && (!bank_name || !account_name || !account_number)) {
      return res.status(400).json({ error: 'Bank name, account name and account number are required' });
    }
    if (method === 'mpesa' && (!mpesa_name || !mpesa_phone)) {
      return res.status(400).json({ error: 'M-Pesa name and phone number are required' });
    }

    const { data: withdrawal, error } = await supabase
      .from('withdrawals')
      .insert({
        user_id: req.user.id,
        campaign_id,
        amount: numericAmount,
        method,
        bank_name, account_name, account_number,
        mpesa_name, mpesa_phone,
        status: 'pending'
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ withdrawal });
  } catch (err) {
    console.error('Withdrawal request error:', err);
    res.status(500).json({ error: 'Could not submit withdrawal request' });
  }
});

// GET /api/withdrawals/mine
router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('user_id', req.user.id)
    .order('requested_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load withdrawals' });
  res.json({ withdrawals: data });
});

// GET /api/withdrawals/balance/:campaignId
router.get('/balance/:campaignId', requireAuth, async (req, res) => {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('user_id, amount_collected')
    .eq('id', req.params.campaignId)
    .maybeSingle();

  if (!campaign || campaign.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const available = await getAvailableBalance(req.params.campaignId);
  res.json({ total_collected: campaign.amount_collected, available_balance: available });
});

module.exports = router;
