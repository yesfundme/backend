const express = require('express');
const { nanoid } = require('nanoid');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

async function uniqueSlug(title) {
  const base = slugify(title) || 'campaign';
  let slug = base;
  let attempt = 0;
  while (true) {
    const { data } = await supabase.from('campaigns').select('id').eq('public_slug', slug).maybeSingle();
    if (!data) return slug;
    attempt += 1;
    slug = `${base}-${nanoid(5).toLowerCase()}`;
    if (attempt > 5) return `${base}-${Date.now()}`;
  }
}

// POST /api/campaigns - create a campaign (auth required)
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      title, description, category, target_amount,
      image_url, beneficiary_name, phone_number, location, extra_info
    } = req.body;

    const validCategories = ['funeral', 'wedding', 'hospital', 'campaign', 'birthday', 'food'];
    if (!title || !category || !validCategories.includes(category)) {
      return res.status(400).json({ error: 'Title and a valid category are required' });
    }

    const public_slug = await uniqueSlug(title);

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        user_id: req.user.id,
        title,
        description,
        category,
        target_amount: Number(target_amount) || 0,
        image_url,
        beneficiary_name,
        phone_number,
        location,
        extra_info,
        public_slug
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ campaign, url: `/campaign/${campaign.public_slug}` });
  } catch (err) {
    console.error('Create campaign error:', err);
    res.status(500).json({ error: 'Could not create campaign. Please try again.' });
  }
});

// GET /api/campaigns/mine - campaigns owned by the logged-in user
router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Could not load campaigns' });
  res.json({ campaigns: data });
});

// GET /api/campaigns/search?q=&category=
router.get('/search', async (req, res) => {
  const { q, category } = req.query;
  let query = supabase.from('campaigns').select('*').eq('status', 'active');

  if (q) query = query.or(`title.ilike.%${q}%,beneficiary_name.ilike.%${q}%`);
  if (category) query = query.eq('category', category);

  const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: 'Search failed' });
  res.json({ campaigns: data });
});

// GET /api/campaigns/:slug - public campaign page data
router.get('/:slug', async (req, res) => {
  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('public_slug', req.params.slug)
    .maybeSingle();

  if (error || !campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { count } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'successful');

  const { data: items } = await supabase
    .from('support_items')
    .select('*')
    .eq('active', true)
    .order('price', { ascending: false });

  res.json({ campaign, supporters_count: count || 0, support_items: items || [] });
});

// POST /api/campaigns/:slug/report - flag a campaign for admin review
router.post('/:slug/report', async (req, res) => {
  const { reason, reporter_email } = req.body;
  if (!reason) return res.status(400).json({ error: 'Please describe the issue' });

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('public_slug', req.params.slug)
    .maybeSingle();

  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const { error } = await supabase
    .from('campaign_reports')
    .insert({ campaign_id: campaign.id, reason, reporter_email: reporter_email || null });

  if (error) return res.status(500).json({ error: 'Could not submit report' });
  res.status(201).json({ success: true });
});

module.exports = router;
