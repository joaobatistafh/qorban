// api/drive-file.js
// Serve os bytes de um arquivo do Google Drive através do nosso próprio domínio.
// Isso resolve duas coisas de uma vez:
// 1. Permite usar <img src="/api/drive-file?fileId=..."> no site mesmo com o
//    arquivo privado (nosso backend acessa com o token OAuth da empresa).
// 2. Evita problema de CORS ao embutir as fotos no PDF exportado (fetch de
//    outro domínio do Google seria bloqueado; aqui é same-origin).
//
// GET /api/drive-file?fileId=XXXX

const { getFileMedia } = require('./_google-drive');

module.exports = async (req, res) => {
  try {
    const fileId = req.query.fileId;
    if (!fileId) { res.status(400).json({ error: 'fileId é obrigatório' }); return; }

    const driveRes = await getFileMedia(fileId);
    const contentType = driveRes.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await driveRes.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(buffer);
  } catch (err) {
    console.error('Erro no drive-file:', err);
    if (err.message === 'DRIVE_NAO_CONECTADO') { res.status(409).json({ error: 'DRIVE_NAO_CONECTADO' }); return; }
    res.status(500).json({ error: err.message });
  }
};
