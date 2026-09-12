// api/drive-rename-foto.js
// Chamado quando o usuário edita a legenda de uma foto do Diário de obra
// depois que ela já foi enviada — o arquivo no Drive é renomeado pra
// acompanhar a legenda nova, mantendo o padrão "AAAA-MM-DD - Legenda.ext".
//
// POST body: { fileId, novoNome }

const { renameFile } = require('./_google-drive');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
    const { fileId, novoNome } = req.body || {};
    if (!fileId || !novoNome) { res.status(400).json({ error: 'fileId e novoNome são obrigatórios' }); return; }

    const data = await renameFile(fileId, novoNome);
    res.status(200).json({ ok: true, name: data.name });
  } catch (err) {
    console.error('Erro no drive-rename-foto:', err);
    if (err.message === 'DRIVE_NAO_CONECTADO') { res.status(409).json({ error: 'DRIVE_NAO_CONECTADO' }); return; }
    res.status(500).json({ error: err.message });
  }
};
