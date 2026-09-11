// api/oauth-google-start.js
// Chamado quando o usuário clica em "Conectar Google Drive" em Configuração.
// Redireciona pra tela de consentimento do Google. Depois de autorizar, o
// Google manda o usuário de volta pro api/oauth-google-callback.

const crypto = require('crypto');
const { DRIVE_SCOPE } = require('./_google-drive');

module.exports = async (req, res) => {
  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!clientId || !redirectUri) {
      res.status(500).send('Google OAuth não configurado (faltam GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_REDIRECT_URI).');
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    // guarda o state num cookie de curta duração pra validar no callback (proteção CSRF)
    res.setHeader('Set-Cookie', `g_oauth_state=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`);

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DRIVE_SCOPE);
    url.searchParams.set('access_type', 'offline'); // pra ganhar refresh_token
    url.searchParams.set('prompt', 'consent');       // força reemitir refresh_token mesmo se já autorizou antes
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);

    res.writeHead(302, { Location: url.toString() });
    res.end();
  } catch (err) {
    console.error('Erro no oauth-google-start:', err);
    res.status(500).send('Erro ao iniciar conexão com o Google: ' + err.message);
  }
};
