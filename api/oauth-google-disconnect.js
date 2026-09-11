// api/oauth-google-disconnect.js
// POST — usado pelo botão "Desconectar" em Configuração. Apenas apaga a
// conexão salva; não afeta os arquivos já enviados ao Drive do cliente.

const { removerConexao, TENANT_PADRAO } = require('./_google-drive');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
    await removerConexao(TENANT_PADRAO);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro no oauth-google-disconnect:', err);
    res.status(500).json({ error: err.message });
  }
};
