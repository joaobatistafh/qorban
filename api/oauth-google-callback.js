// api/oauth-google-callback.js
// O Google chama esta URL depois que o usuário autoriza (ou nega) o acesso.
// Troca o "code" por tokens, descobre o e-mail conectado, salva tudo em
// `integracoes_google` e manda o navegador de volta pra aba Configuração.

const { salvarConexao, TENANT_PADRAO } = require('./_google-drive');

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

module.exports = async (req, res) => {
  const voltarPara = '/?';
  try {
    const { code, state, error } = req.query || {};
    if (error) {
      res.writeHead(302, { Location: `${voltarPara}drive=negado#configuracao` });
      res.end();
      return;
    }

    const cookies = parseCookies(req.headers.cookie);
    if (!state || state !== cookies.g_oauth_state) {
      res.writeHead(302, { Location: `${voltarPara}drive=erro_state#configuracao` });
      res.end();
      return;
    }
    if (!code) {
      res.writeHead(302, { Location: `${voltarPara}drive=sem_code#configuracao` });
      res.end();
      return;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(JSON.stringify(tokens));
    if (!tokens.refresh_token) {
      // Acontece se o usuário já tinha conectado antes e o Google não reemitiu
      // um refresh_token novo. Como pedimos prompt=consent isso não deveria
      // ocorrer, mas por segurança avisamos em vez de salvar dado incompleto.
      res.writeHead(302, { Location: `${voltarPara}drive=sem_refresh_token#configuracao` });
      res.end();
      return;
    }

    // Descobre o e-mail da conta conectada (só pra mostrar na interface)
    let email = null;
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const info = await infoRes.json();
      email = info.email || null;
    } catch (e) { /* não é crítico se falhar */ }

    await salvarConexao(TENANT_PADRAO, {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      token_expira_em: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      conectado_email: email,
      conectado_em: new Date().toISOString(),
      root_folder_id: null // será criada na primeira foto enviada
    });

    res.setHeader('Set-Cookie', 'g_oauth_state=; Path=/; Max-Age=0');
    res.writeHead(302, { Location: `${voltarPara}drive=conectado#configuracao` });
    res.end();
  } catch (err) {
    console.error('Erro no oauth-google-callback:', err);
    res.writeHead(302, { Location: `${voltarPara}drive=erro#configuracao` });
    res.end();
  }
};
