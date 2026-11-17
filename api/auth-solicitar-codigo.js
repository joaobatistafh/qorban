// api/auth-solicitar-codigo.js
// Primeiro acesso / "Esqueceu a senha": envia um código de verificação por e-mail,
// mas SOMENTE se o e-mail estiver cadastrado (tabela admins ou menu Acessos).
// A resposta é sempre a mesma, exista o e-mail ou não (não revela quem é cadastrado).
//
// POST /api/auth-solicitar-codigo   { "email": "pessoa@empresa.com" }
//
// Variáveis de ambiente (Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE
// Opcional: SUPABASE_PUBLISHABLE_KEY (se não existir, usa a mesma chave pública do app)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_psFslciJm9QIZTBkCiF77Q_SxA0hTaA';

const RESPOSTA = { ok: true, mensagem: 'Se este e-mail estiver cadastrado, enviamos um código de verificação.' };

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
  });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status}`);
  return r.json();
}

async function emailAutorizado(email) {
  const admins = await rest(`admins?select=email&email=ilike.${encodeURIComponent(email)}`);
  if (admins.some(a => String(a.email).toLowerCase() === email)) return true;
  const rows = await rest('sistema_global?id=eq.global&select=dados');
  const colabs = (rows[0] && rows[0].dados && rows[0].dados.colaboradores) || [];
  return colabs.some(c => String(c.email || '').trim().toLowerCase() === email);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      res.status(400).json({ error: 'E-mail inválido.' }); return;
    }

    if (await emailAutorizado(email)) {
      // Garante que o usuário exista no Supabase Auth (cadastro só acontece por aqui, nunca direto do navegador).
      const cr = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, email_confirm: true }),
      });
      if (!cr.ok && cr.status !== 422) { // 422 = já existe
        console.error('auth-solicitar-codigo: criar usuário', cr.status, await cr.text());
      }
      // Dispara o e-mail com o código (o template do Supabase precisa conter {{ .Token }}).
      const otp = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
        method: 'POST',
        headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, create_user: false }),
      });
      if (!otp.ok) console.error('auth-solicitar-codigo: enviar código', otp.status, await otp.text());
    }
    res.status(200).json(RESPOSTA);
  } catch (err) {
    console.error('auth-solicitar-codigo:', err);
    res.status(200).json(RESPOSTA); // mesma resposta mesmo em erro: não vaza informação
  }
};
