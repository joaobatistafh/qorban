// api/notificar-solicitacao.js
// Chamado PELO SITE logo depois de inserir uma linha em `solicitacoes_compra`.
// Busca os dados completos da solicitação e manda uma mensagem pro
// Administrador (ID Telegram Administrador, configurado em Configuração)
// com botões inline de Aprovar/Não aprovar — os mesmos botões que aparecem
// quando a solicitação vem do próprio Telegram (comando /solicitar).
//
// POST body: { solicitacaoId: uuid }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE;

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
  return r.json();
}
function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json());
}
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
    const { solicitacaoId } = req.body || {};
    if (!solicitacaoId) { res.status(400).json({ error: 'solicitacaoId é obrigatório' }); return; }

    const rows = await sb(`solicitacoes_compra?id=eq.${solicitacaoId}&select=*`);
    const s = rows[0];
    if (!s) { res.status(404).json({ error: 'solicitação não encontrada' }); return; }

    const globalRows = await sb('sistema_global?id=eq.global&select=dados');
    const adminId = globalRows[0] && globalRows[0].dados && globalRows[0].dados.telegramAdminId;
    if (!adminId) { res.status(200).json({ ok: false, motivo: 'ID Telegram Administrador não configurado' }); return; }

    const texto = [
      `🛒 <b>Nova solicitação de compra</b> (${s.origem === 'telegram' ? 'via Telegram' : 'via site'})`,
      `🏗️ Obra: ${escapeHtml(s.projeto_nome || '')}`,
      `🏷️ Tipo: ${escapeHtml(s.tipo || '')}`,
      s.orc_label ? `📋 Item: ${escapeHtml(s.orc_label)}` : null,
      `📝 ${escapeHtml(s.descricao || '')}`,
      `📦 Quantidade: ${fmtMoney(s.quantidade)} ${escapeHtml(s.unidade || '')}`
    ].filter(Boolean).join('\n');

    await tg('sendMessage', {
      chat_id: adminId,
      text: texto,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Aprovar', callback_data: `aprovarsol:${s.id}:sim` },
          { text: '❌ Não aprovar', callback_data: `aprovarsol:${s.id}:nao` }
        ]]
      }
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Erro no notificar-solicitacao:', err);
    res.status(500).json({ error: err.message });
  }
};
