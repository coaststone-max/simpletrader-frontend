/**
 * /api/config — returns public Supabase credentials for the frontend.
 * SUPABASE_URL and SUPABASE_ANON_KEY are set in Vercel → Settings → Environment Variables.
 * These are safe to expose (anon key + RLS protect data per user).
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_ANON_KEY || '',
  });
}
