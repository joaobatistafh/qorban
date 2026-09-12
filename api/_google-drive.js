// api/_google-drive.js
// Helper compartilhado pra falar com a API do Google Drive.
//
// Diferente da primeira versão (que usava uma conta de serviço só sua), esta
// usa OAuth por cliente: cada empresa conecta o PRÓPRIO Google, em Configuração,
// e as fotos ficam guardadas no Drive dela — não no seu. Isso é o que permite o
// sistema funcionar sozinho pra qualquer cliente novo, sem você compartilhar
// pasta nenhuma manualmente.
//
// Os tokens ficam na tabela `integracoes_google` (Supabase), uma linha por
// empresa. Como o sistema ainda não tem multi-empresa/login, por enquanto toda
// linha usa empresa_id = 'default' — é só isso que vai precisar mudar quando
// a base multi-empresa entrar (trocar 'default' pelo id real da empresa logada).
//
// Variáveis de ambiente necessárias:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REDIRECT_URI   (ex: https://seu-dominio.vercel.app/api/oauth-google-callback)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE (já usadas pelo resto do backend)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file email';
const TENANT_PADRAO = 'default'; // ponto único a trocar quando existir multi-empresa de verdade

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...(opts.headers || {})
    }
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Supabase ${path}: ${r.status} ${t}`); }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : null;
}

async function getConexao(empresaId = TENANT_PADRAO) {
  const rows = await sb(`integracoes_google?empresa_id=eq.${empresaId}&select=*`);
  return rows[0] || null;
}

async function salvarConexao(empresaId, patch) {
  return sb('integracoes_google', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ empresa_id: empresaId, atualizado_em: new Date().toISOString(), ...patch })
  });
}

async function removerConexao(empresaId = TENANT_PADRAO) {
  return sb(`integracoes_google?empresa_id=eq.${empresaId}`, { method: 'DELETE', prefer: 'return=minimal' });
}

// Troca um refresh_token por um access_token novo (o access_token dura ~1h).
async function refreshAccessToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Falha ao renovar token do Google: ${JSON.stringify(data)}`);
  return data; // { access_token, expires_in, ... }
}

// Devolve um access_token válido pra essa empresa, renovando se preciso.
async function getAccessToken(empresaId = TENANT_PADRAO) {
  const conexao = await getConexao(empresaId);
  if (!conexao || !conexao.refresh_token) {
    throw new Error('DRIVE_NAO_CONECTADO');
  }
  const expiraEm = conexao.token_expira_em ? new Date(conexao.token_expira_em).getTime() : 0;
  if (conexao.access_token && expiraEm > Date.now() + 60000) {
    return conexao.access_token;
  }
  const novo = await refreshAccessToken(conexao.refresh_token);
  const expiraEmNovo = new Date(Date.now() + novo.expires_in * 1000).toISOString();
  await salvarConexao(empresaId, { access_token: novo.access_token, token_expira_em: expiraEmNovo });
  return novo.access_token;
}

async function driveFetch(empresaId, path, opts = {}) {
  const token = await getAccessToken(empresaId);
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Drive API ${path}: ${r.status} ${t}`); }
  return r;
}

// Busca uma subpasta pelo nome dentro de um parent; cria se não existir. Idempotente.
async function ensureFolder(empresaId, parentId, name) {
  const q = encodeURIComponent(`'${parentId}' in parents and name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await driveFetch(empresaId, `files?q=${q}&fields=files(id,name)&spaces=drive`);
  const found = await searchRes.json();
  if (found.files && found.files.length) return found.files[0].id;

  const createRes = await driveFetch(empresaId, 'files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  const created = await createRes.json();
  return created.id;
}

// Garante a cadeia "Sistema de obra (root, criado no Drive do próprio cliente) /
// NomeDaObra / NomeDaSubpasta" e devolve o ID final da subpasta. A raiz é criada
// (uma vez) direto na conta conectada — o cliente não precisa compartilhar nada
// com ninguém. Usado tanto pro Diário de obra quanto pras Notas fiscais.
async function ensureProjectSubfolder(projectName, subfolderName, empresaId = TENANT_PADRAO) {
  const conexao = await getConexao(empresaId);
  if (!conexao) throw new Error('DRIVE_NAO_CONECTADO');

  let rootId = conexao.root_folder_id;
  if (!rootId) {
    const createRes = await driveFetch(empresaId, 'files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sistema de obra', mimeType: 'application/vnd.google-apps.folder' })
    });
    const created = await createRes.json();
    rootId = created.id;
    await salvarConexao(empresaId, { root_folder_id: rootId });
  }

  const projectFolderId = await ensureFolder(empresaId, rootId, projectName || '(obra sem nome)');
  const subfolderId = await ensureFolder(empresaId, projectFolderId, subfolderName);
  return subfolderId;
}

// Faz upload de um arquivo (Buffer) pra uma pasta, com o nome já formatado.
async function uploadFile(parentId, fileName, mimeType, buffer, empresaId = TENANT_PADRAO) {
  const token = await getAccessToken(empresaId);
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: fileName, parents: [parentId] })], { type: 'application/json' }));
  form.append('file', new Blob([buffer], { type: mimeType }), fileName);

  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Falha no upload pro Drive: ${JSON.stringify(data)}`);
  return data; // { id, name, webViewLink }
}

// Renomeia um arquivo já existente no Drive (usado quando o usuário edita a
// legenda de uma foto depois de já ter enviado).
async function renameFile(fileId, newName, empresaId = TENANT_PADRAO) {
  const token = await getAccessToken(empresaId);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Falha ao renomear no Drive: ${JSON.stringify(data)}`);
  return data;
}

// Baixa os bytes de um arquivo (usado pra exibir fotos no site e embutir no PDF).
async function getFileMedia(fileId, empresaId = TENANT_PADRAO) {
  const token = await getAccessToken(empresaId);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) { const t = await r.text(); throw new Error(`Drive getFileMedia: ${r.status} ${t}`); }
  return r;
}

// Deixa um nome de arquivo seguro pro Drive/sistemas de arquivo em geral.
function sanitizeFileName(nome) {
  return String(nome || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

module.exports = {
  TENANT_PADRAO, DRIVE_SCOPE,
  getConexao, salvarConexao, removerConexao,
  ensureFolder, ensureProjectSubfolder, uploadFile, renameFile, getFileMedia, getAccessToken, sanitizeFileName
};
