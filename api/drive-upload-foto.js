// api/drive-upload-foto.js
// Chamado PELO SITE (aba Diário de obra) quando o usuário anexa uma foto a um
// registro do dia. Garante a pasta "Sistema de obra / NomeDaObra / Diário de obra"
// no Google Drive (criando o que faltar) e sobe a foto já renomeada no padrão
// "AAAA-MM-DD - Legenda.ext".
//
// POST body: { projectName, dataISO, legenda, fileBase64, mimeType, fileName }

const { ensureProjectSubfolder, uploadFile, sanitizeFileName } = require('./_google-drive');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif'
};

function extensaoDe(mimeType, fileName) {
  if (EXT_BY_MIME[mimeType]) return EXT_BY_MIME[mimeType];
  const m = /\.[a-zA-Z0-9]+$/.exec(fileName || '');
  return m ? m[0].toLowerCase() : '.jpg';
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
    const { projectName, dataISO, legenda, fileBase64, mimeType, fileName } = req.body || {};
    if (!fileBase64 || !dataISO) { res.status(400).json({ error: 'dataISO e fileBase64 são obrigatórios' }); return; }

    const folderId = await ensureProjectSubfolder(projectName, 'Diário de obra');
    const ext = extensaoDe(mimeType, fileName);
    const nomeFinal = `${dataISO} - ${sanitizeFileName(legenda) || 'sem legenda'}${ext}`;

    const buffer = Buffer.from(fileBase64, 'base64');
    const uploaded = await uploadFile(folderId, nomeFinal, mimeType || 'image/jpeg', buffer);

    res.status(200).json({
      ok: true,
      fileId: uploaded.id,
      fileName: uploaded.name,
      viewUrl: `https://drive.google.com/file/d/${uploaded.id}/view`
    });
  } catch (err) {
    console.error('Erro no drive-upload-foto:', err);
    if (err.message === 'DRIVE_NAO_CONECTADO') {
      res.status(409).json({ error: 'DRIVE_NAO_CONECTADO', mensagem: 'O Google Drive ainda não foi conectado. Vá em Configuração e clique em "Conectar Google Drive".' });
      return;
    }
    res.status(500).json({ error: err.message });
  }
};
