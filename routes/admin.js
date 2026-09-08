const express = require('express');
const supabase = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/overview - financial summary
router.get('/overview', async (req, res) => {
  const { count: totalUsers } = await supabase.from('users').select('id', { count: 'exact', head: true });
  const { count: activeCampaigns } = await supabase
    .from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active');

  const { data: campaigns } = await supabase.from('campaigns').select('amount_collected');
  const totalCollected = (campaigns || []).reduce((s, c) => s + Number(c.amount_collected), 0);

  const { data: paidWithdrawals } = await supabase.from('withdrawals').select('amount').eq('status', 'paid');
  const totalWithdrawn = (paidWithdrawals || []).reduce((s, w) => s + Number(w.amount), 0);

  const { data: pendingWithdrawals } = await supabase
    .from('withdrawals').select('amount').in('status', ['pending', 'processing']);
  const pendingTotal = (pendingWithdrawals || []).reduce((s, w) => s + Number(w.amount), 0);

  res.json({
    total_users: totalUsers || 0,
    active_campaigns: activeCampaigns || 0,
    total_collected: totalCollected,
    total_withdrawn: totalWithdrawn,
    available_campaign_balances: totalCollected - totalWithdrawn - pendingTotal,
    pending_withdrawals: pendingTotal
  });
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, full_name, email, status, created_at, campaigns(id, title, category, amount_collected, public_slug)')
    .eq('role', 'owner')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load users' });
  res.json({ users });
});

// PATCH /api/admin/users/:id/status  { status: 'active' | 'suspended' }
router.patch('/users/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const { error } = await supabase.from('users').update({ status }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Could not update user' });
  res.json({ success: true });
});

// GET /api/admin/campaigns?q=&category=&status=
router.get('/campaigns', async (req, res) => {
  const { q, category, status } = req.query;
  let query = supabase.from('campaigns').select('*, users(full_name, email)');
  if (q) query = query.ilike('title', `%${q}%`);
  if (category) query = query.eq('category', category);
  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load campaigns' });
  res.json({ campaigns: data });
});

// PATCH /api/admin/campaigns/:id  { title?, description?, target_amount?, status? }
router.patch('/campaigns/:id', async (req, res) => {
  const allowed = ['title', 'description', 'target_amount', 'status'];
  const updates = {};
  allowed.forEach((key) => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

  const { error } = await supabase.from('campaigns').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Could not update campaign' });
  res.json({ success: true });
});

// DELETE /api/admin/campaigns/:id
router.delete('/campaigns/:id', async (req, res) => {
  const { error } = await supabase.from('campaigns').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Could not delete campaign' });
  res.json({ success: true });
});

// GET /api/admin/withdrawals?status=
router.get('/withdrawals', async (req, res) => {
  const { status } = req.query;
  let query = supabase.from('withdrawals').select('*, users(full_name, email), campaigns(title, public_slug)');
  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('requested_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load withdrawals' });
  res.json({ withdrawals: data });
});

// PATCH /api/admin/withdrawals/:id/status  { status: 'processing' | 'paid' | 'failed' }
// Approving only moves a request to 'processing'. It is never auto-marked 'paid'.
router.patch('/withdrawals/:id/status', async (req, res) => {
  const { status } = req.body;
  if (!['processing', 'paid', 'failed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { error } = await supabase
    .from('withdrawals')
    .update({ status, processed_at: ['paid', 'failed'].includes(status) ? new Date().toISOString() : null })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: 'Could not update withdrawal' });
  res.json({ success: true });
});

// GET /api/admin/payments?status=
router.get('/payments', async (req, res) => {
  const { status } = req.query;
  let query = supabase.from('payments').select('*, campaigns(title, public_slug)');
  if (status) query = query.eq('status', status);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'Could not load payments' });
  res.json({ payments: data });
});

// PATCH /api/admin/settings  { platform_fee_percent?, platform_fee_flat? }
router.patch('/settings', async (req, res) => {
  const updates = [];
  if (req.body.platform_fee_percent !== undefined) {
    updates.push({ key: 'platform_fee_percent', value: String(req.body.platform_fee_percent) });
  }
  if (req.body.platform_fee_flat !== undefined) {
    updates.push({ key: 'platform_fee_flat', value: String(req.body.platform_fee_flat) });
  }
  if (!updates.length) return res.status(400).json({ error: 'No settings provided' });

  const { error } = await supabase.from('platform_settings').upsert(updates);
  if (error) return res.status(500).json({ error: 'Could not update settings' });
  res.json({ success: true });
});

// GET /api/admin/reports
router.get('/reports', async (req, res) => {
  const { data, error } = await supabase
    .from('campaign_reports')
    .select('*, campaigns(title, public_slug)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load reports' });
  res.json({ reports: data });
});

module.exports = router;
