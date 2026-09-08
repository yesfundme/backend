const { createClient } = require('@supabase/supabase-js');

// Service-role key is used because this is a trusted backend context.
// Never expose SUPABASE_SERVICE_KEY to the frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

module.exports = supabase;
