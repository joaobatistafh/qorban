// api/oauth-google-status.js
// GET — usado pela aba Configuração pra saber se o Google Drive já está
// conectado e com qual e-mail, sem expor nenhum token pro navegador.

const { getConexao, TENANT_PADRAO } = require('./_google-drive');

module.exports = async (req, res) => {
  try {
    const conexao = await getConexao(TENANT_PADRAO);
    if (!conexao || !conexao.refresh_token) {
      res.status(200).json({ conectado: false });
      return;
    }
    res.status(200).json({ conectado: true, email: conexao.conectado_email || null, conectadoEm: conexao.conectado_em || null });
  } catch (err) {
    console.error('Erro no oauth-google-status:', err);
    res.status(500).json({ error: err.message });
  }
};
