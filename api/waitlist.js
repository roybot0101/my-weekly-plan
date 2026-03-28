import { createClient } from '@supabase/supabase-js';

const WAITLIST_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === 'object') return body;
  return {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  }

  const body = parseBody(req.body);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const source =
    typeof body.source === 'string' && body.source.trim()
      ? body.source.trim().slice(0, 80)
      : 'marketing-landing';

  if (!WAITLIST_EMAIL_REGEX.test(email)) {
    return res.status(400).json({ ok: false, error: 'A valid email is required.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: 'Missing server configuration.' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error } = await supabase.from('waitlist_contacts').upsert(
    {
      email,
      opted_in: true,
      source,
    },
    { onConflict: 'email' },
  );

  if (error) {
    return res.status(500).json({ ok: false, error: error.message || 'Failed to join waitlist.' });
  }

  return res.status(200).json({ ok: true });
}
