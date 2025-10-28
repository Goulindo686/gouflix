export default async function handler(req, res) {
  const env = {
    SUPABASE_URL:
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || null,
    SUPABASE_ANON_KEY:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      null,
    TMDB_BASE: process.env.TMDB_BASE || 'https://api.themoviedb.org/3',
    TMDB_IMG: process.env.TMDB_IMG || 'https://image.tmdb.org/t/p/w500',
    TMDB_TOKEN: process.env.TMDB_TOKEN || null,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || null,
    KEYAUTH_BUY_URL: process.env.KEYAUTH_BUY_URL || null,
  };

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(env);
}