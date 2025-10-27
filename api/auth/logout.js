export default async function handler(req, res){
  try{
    res.setHeader('Set-Cookie', [
      'sid=; Max-Age=0; Path=/; SameSite=Lax'
    ]);
    return res.status(200).json({ ok:true });
  }catch(err){
    return res.status(500).json({ ok:false, error: err?.message || 'Erro em /api/auth/logout' });
  }
}