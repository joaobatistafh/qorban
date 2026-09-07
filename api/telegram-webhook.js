// api/telegram-webhook.js
// Webhook do bot @NotasQorbanBot — recebe atualizações do Telegram, conduz o
// fluxo (obra → tipo → item do orçamento → forma de pagamento → parcelas →
// banco → foto da nota) e grava o resultado em `compras_pendentes` no
// Supabase, já completo, pro app só importar.
//
// Variáveis de ambiente necessárias (configurar na Vercel):
//   TELEGRAM_BOT_TOKEN     -> token do BotFather
//   SUPABASE_URL           -> URL do projeto Supabase
//   SUPABASE_SERVICE_ROLE  -> service role key (NÃO é a publishable/anon key)
//   ANTHROPIC_API_KEY      -> chave da API da Anthropic (para ler a nota fiscal)

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE;
const TIPOS_COMPRA = ['Material', 'Mão de obra', 'Equipamento', 'Extra'];
const FORMAS_PAGTO = ['PIX', 'Cartão de crédito', 'Cartão de débito', 'Espécie'];

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(200).send('ok'); return; }
    const update = req.body;

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
    res.status(200).send('ok');
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(200).send('ok'); // sempre 200 pro Telegram não ficar reenviando
  }
};

/* ---------------- Telegram helpers ---------------- */
async function tg(method, body) {
  const r = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}
function sendText(chatId, text, keyboard) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: keyboard });
}
function answerCallback(id, text) {
  return tg('answerCallbackQuery', { callback_query_id: id, text: text || '' });
}
function inlineKeyboard(rows) { return { inline_keyboard: rows }; }

/* ---------------- Supabase helpers (REST, sem SDK) ---------------- */
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
function getSession(chatId) {
  return sb(`bot_sessions?chat_id=eq.${chatId}&select=*`).then(rows => rows[0] || null);
}
function saveSession(chatId, patch) {
  const body = { chat_id: chatId, atualizado_em: new Date().toISOString(), ...patch };
  return sb('bot_sessions', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body)
  });
}
function clearSession(chatId) {
  return sb(`bot_sessions?chat_id=eq.${chatId}`, { method: 'DELETE', prefer: 'return=minimal' });
}
function listProjetos() {
  return sb('projetos?select=id,nome&order=nome.asc');
}
async function getOrcamentoDoProjeto(projetoId) {
  const rows = await sb(`projetos?id=eq.${projetoId}&select=dados`);
  const dados = rows[0] && rows[0].dados;
  return (dados && dados.orcamento) || [];
}
async function getBancosDoSistema() {
  const rows = await sb('sistema_global?id=eq.global&select=dados');
  const dados = rows[0] && rows[0].dados;
  return (dados && dados.bancos) || [];
}
function contaBancariaLabel(b) { return `${b.nome} — ${b.banco}`; }

/* ---------------- Fluxo principal ---------------- */
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (text === '/start' || text === '/nova_compra' || text === '/novacompra') {
    await clearSession(chatId);
    const projetos = await listProjetos();
    if (!projetos.length) return sendText(chatId, 'Nenhuma obra cadastrada no sistema ainda.');
    await saveSession(chatId, { step: 'aguardando_obra' });
    const rows = projetos.map(p => [{ text: p.nome, callback_data: `obra:${p.id}` }]);
    return sendText(chatId, '🏗️ Qual obra é essa compra?', inlineKeyboard(rows));
  }

  const session = await getSession(chatId);
  if (!session) {
    return sendText(chatId, 'Manda /nova_compra para começar a lançar uma compra.');
  }

  if (session.step === 'aguardando_busca_item' && text) {
    const orcamento = await getOrcamentoDoProjeto(session.projeto_id);
    const termo = text.toLowerCase();
    const achados = orcamento
      .filter(o => o.level === 'subitem') // só os itens "folha", que é o nível que recebe custo
      .filter(o => (o.nome || '').toLowerCase().includes(termo) || String(o.numero || '').includes(termo))
      .slice(0, 8);
    if (!achados.length) {
      return sendText(chatId, 'Não achei nenhum item do orçamento com esse termo. Tenta outra palavra:');
    }
    await saveSession(chatId, { step: 'aguardando_escolha_item', itens_encontrados: achados });
    const rows = achados.map(o => [{ text: `${o.numero || ''} ${truncar(o.nome || '', 50)}`.trim(), callback_data: `item:${o.id}` }]);
    return sendText(chatId, 'Encontrei estes itens — qual deles?', inlineKeyboard(rows));
  }

  if (session.step === 'aguardando_parcelas' && text) {
    const n = parseInt(text.replace(/\D/g, ''), 10);
    if (!n || n < 1) return sendText(chatId, 'Manda só o número de parcelas (ex: 3):');
    await saveSession(chatId, { parcelas: n });
    return irParaEscolhaBanco(chatId, session);
  }

  if (session.step === 'aguardando_foto' && msg.photo) {
    return processarFoto(chatId, msg, session);
  }

  if (session.step === 'aguardando_foto' && !msg.photo) {
    return sendText(chatId, '📷 Ainda preciso da foto da nota fiscal pra continuar.');
  }

  return sendText(chatId, 'Manda /nova_compra pra começar do zero.');
}

async function irParaEscolhaBanco(chatId, session) {
  const bancos = await getBancosDoSistema();
  await saveSession(chatId, { step: 'aguardando_banco' });
  if (!bancos.length) {
    await saveSession(chatId, { banco: '', step: 'aguardando_foto' });
    return sendText(chatId, 'Nenhuma conta bancária cadastrada no sistema — vou deixar o campo Banco em branco.\n\n📷 Agora manda a foto da nota fiscal.');
  }
  const rows = bancos.map(b => [{ text: contaBancariaLabel(b), callback_data: `banco:${b.id}` }]);
  rows.push([{ text: 'Não informar', callback_data: 'banco:none' }]);
  return sendText(chatId, 'De qual conta saiu (ou vai sair) o pagamento?', inlineKeyboard(rows));
}

async function handleCallback(cq) {
  const chatId = cq.message.chat.id;
  const data = cq.data || '';
  const [action, value] = data.split(/:(.+)/).filter(Boolean);
  await answerCallback(cq.id);

  const session = await getSession(chatId);
  if (!session) return sendText(chatId, 'Sessão expirada. Manda /nova_compra de novo.');

  if (action === 'obra') {
    const projetos = await listProjetos();
    const p = projetos.find(x => String(x.id) === value);
    await saveSession(chatId, { projeto_id: value, projeto_nome: p ? p.nome : '', step: 'aguardando_tipo' });
    const rows = TIPOS_COMPRA.map(t => [{ text: t, callback_data: `tipo:${t}` }]);
    return sendText(chatId, `Obra: <b>${escapeHtml(p ? p.nome : '')}</b>\n\nQual o tipo da compra?`, inlineKeyboard(rows));
  }

  if (action === 'tipo') {
    await saveSession(chatId, { tipo: value, step: 'aguardando_busca_item' });
    return sendText(chatId, `Tipo: <b>${escapeHtml(value)}</b>\n\nAgora digita um pedaço do nome (ou número) do item do orçamento que essa compra se refere:`);
  }

  if (action === 'item') {
    const encontrados = session.itens_encontrados || [];
    const item = encontrados.find(o => String(o.id) === value);
    const label = item ? `${item.numero || ''} ${item.nome || ''}`.trim() : value;
    await saveSession(chatId, { orc_id: value, orc_label: label, step: 'aguardando_forma_pagto', itens_encontrados: null });
    const rows = FORMAS_PAGTO.map(f => [{ text: f, callback_data: `forma:${f}` }]);
    return sendText(chatId, `Item: <b>${escapeHtml(label)}</b>\n\nComo foi (ou vai ser) pago?`, inlineKeyboard(rows));
  }

  if (action === 'forma') {
    await saveSession(chatId, { forma_pagto: value, parcelas: 1 });
    if (value === 'Cartão de crédito') {
      await saveSession(chatId, { step: 'aguardando_parcelas' });
      return sendText(chatId, 'Em quantas parcelas? (manda só o número, ex: 3)');
    }
    return irParaEscolhaBanco(chatId, session);
  }

  if (action === 'banco') {
    if (value === 'none') {
      await saveSession(chatId, { banco: '', step: 'aguardando_foto' });
    } else {
      const bancos = await getBancosDoSistema();
      const b = bancos.find(x => String(x.id) === value);
      await saveSession(chatId, { banco: b ? contaBancariaLabel(b) : '', step: 'aguardando_foto' });
    }
    return sendText(chatId, '📷 Agora manda a foto da nota fiscal.');
  }

  if (action === 'confirmar') {
    if (value === 'sim') return gravarCompraPendente(chatId, session);
    if (value === 'refazer_foto') {
      await saveSession(chatId, { step: 'aguardando_foto', extraido: null, foto_path: null });
      return sendText(chatId, '📷 Sem problema, manda a foto de novo.');
    }
  }

  return null;
}

/* ---------------- Foto → leitura da nota ---------------- */
async function processarFoto(chatId, msg, session) {
  await sendText(chatId, '🔎 Lendo a nota fiscal, um momento...');

  const photo = msg.photo[msg.photo.length - 1]; // maior resolução
  const fileInfo = await tg('getFile', { file_id: photo.file_id });
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

  const imgResp = await fetch(fileUrl);
  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
  const base64 = imgBuffer.toString('base64');

  // Sobe a foto pro Storage do Supabase
  const storagePath = `${session.projeto_id}/${Date.now()}.jpg`;
  await fetch(`${SUPABASE_URL}/storage/v1/object/notas-fiscais/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'image/jpeg'
    },
    body: imgBuffer
  });

  // Pede pro Claude extrair os dados estruturados da nota
  const extraido = await lerNotaComClaude(base64);

  await saveSession(chatId, { step: 'aguardando_confirmacao', extraido, foto_path: storagePath });

  const resumo = [
    `🏗️ Obra: <b>${escapeHtml(session.projeto_nome)}</b>`,
    `🏷️ Tipo: <b>${escapeHtml(session.tipo)}</b>`,
    `📋 Item: <b>${escapeHtml(session.orc_label || '—')}</b>`,
    `💳 Pagamento: <b>${escapeHtml(session.forma_pagto || '—')}${session.forma_pagto === 'Cartão de crédito' ? ` (${session.parcelas}x)` : ''}</b>`,
    `🏦 Banco: <b>${escapeHtml(session.banco || '—')}</b>`,
    ``,
    `🏪 Loja: ${escapeHtml(extraido.loja || '—')}`,
    `💰 Valor: R$ ${fmtMoney(extraido.valor_total)}`,
    `📅 Data: ${extraido.data || '—'}`,
    `🧾 Nº nota: ${extraido.numero_nota || '—'}`,
    `📝 ${escapeHtml(extraido.descricao || '—')}`
  ].join('\n');

  return sendText(chatId, `${resumo}\n\nConfere se está certo:`, inlineKeyboard([
    [{ text: '✅ Confirmar e lançar', callback_data: 'confirmar:sim' }],
    [{ text: '📷 Tirar foto de novo', callback_data: 'confirmar:refazer_foto' }]
  ]));
}

async function lerNotaComClaude(base64Image) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
          { type: 'text', text: 'Extraia os dados desta nota fiscal/cupom fiscal brasileiro. Responda APENAS um JSON válido, sem markdown, sem texto antes ou depois, no formato: {"loja": string, "valor_total": number, "data": "YYYY-MM-DD" ou null, "numero_nota": string ou null, "descricao": string (resumo curto do que foi comprado, ex: "Cimento e areia")}. Se não conseguir ler algum campo, use null.' }
        ]
      }]
    })
  });
  const data = await r.json();
  const textBlock = (data.content || []).find(c => c.type === 'text');
  let raw = textBlock ? textBlock.text : '{}';
  raw = raw.replace(/```json|```/g, '').trim();
  try { return JSON.parse(raw); }
  catch { return { loja: null, valor_total: null, data: null, numero_nota: null, descricao: null }; }
}

/* ---------------- Gravação final ---------------- */
async function gravarCompraPendente(chatId, session) {
  const ex = session.extraido || {};
  await sb('compras_pendentes', {
    method: 'POST',
    body: JSON.stringify({
      projeto_id: session.projeto_id,
      projeto_nome: session.projeto_nome,
      tipo: session.tipo,
      orc_id: session.orc_id,
      orc_label: session.orc_label,
      forma_pagto: session.forma_pagto || 'PIX',
      parcelas: session.parcelas || 1,
      banco: session.banco || '',
      loja: ex.loja,
      valor_total: ex.valor_total,
      data_nota: ex.data,
      numero_nota: ex.numero_nota,
      descricao: ex.descricao,
      foto_path: session.foto_path,
      telegram_user: chatId
    })
  });
  await clearSession(chatId);
  return sendText(chatId, '✅ Compra registrada! Ela vai aparecer no Qorban Controle na próxima vez que você abrir essa obra, na aba de Compras.\n\nManda /nova_compra pra lançar outra.');
}

/* ---------------- utils ---------------- */
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function truncar(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
