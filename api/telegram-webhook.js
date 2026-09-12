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
const { ensureProjectSubfolder, uploadFile, sanitizeFileName } = require('./_google-drive');

module.exports = async (req, res) => {
  let update;
  try {
    if (req.method !== 'POST') { res.status(200).send('ok'); return; }
    update = req.body;

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
    res.status(200).send('ok');
  } catch (err) {
    console.error('Erro no webhook:', err);
    const chatId = update && (update.message?.chat?.id || update.callback_query?.message?.chat?.id);
    if (chatId) {
      try { await sendText(chatId, `⚠️ Deu um erro aqui: ${err.message}\n\nManda /nova pra tentar de novo.`); }
      catch (e) { console.error('Falha ao avisar erro:', e); }
    }
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
async function getConfigGlobal() {
  const rows = await sb('sistema_global?id=eq.global&select=dados');
  return (rows[0] && rows[0].dados) || {};
}
function contaBancariaLabel(b) { return `${b.nome} — ${b.banco}`; }

/* ---------------- Fluxo principal ---------------- */
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  if (text === '/start' || text === '/nova' || text === '/nova_compra' || text === '/novacompra') {
    await clearSession(chatId);
    const projetos = await listProjetos();
    if (!projetos.length) return sendText(chatId, 'Nenhuma obra cadastrada no sistema ainda.');
    await saveSession(chatId, { step: 'aguardando_obra', modo: 'compra' });
    const rows = projetos.map(p => [{ text: p.nome, callback_data: `obra:${p.id}` }]);
    return sendText(chatId, '🏗️ Qual obra é essa compra?', inlineKeyboard(rows));
  }

  if (text === '/solicitar') {
    await clearSession(chatId);
    const projetos = await listProjetos();
    if (!projetos.length) return sendText(chatId, 'Nenhuma obra cadastrada no sistema ainda.');
    await saveSession(chatId, { step: 'aguardando_obra', modo: 'solicitacao' });
    const rows = projetos.map(p => [{ text: p.nome, callback_data: `obra:${p.id}` }]);
    return sendText(chatId, '🛒 Solicitar compra — qual obra?', inlineKeyboard(rows));
  }

  const session = await getSession(chatId);
  if (!session) {
    return sendText(chatId, 'Manda /nova para lançar uma compra, ou /solicitar para pedir autorização de uma compra.');
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

  if (session.step === 'sol_aguardando_busca_item' && text) {
    if (text.trim().toLowerCase() === 'pular') {
      await saveSession(chatId, { orc_id: null, orc_label: '', step: 'sol_aguardando_descricao' });
      return sendText(chatId, 'Descreva o que precisa ser comprado:');
    }
    const orcamento = await getOrcamentoDoProjeto(session.projeto_id);
    const termo = text.toLowerCase();
    const achados = orcamento
      .filter(o => o.level === 'subitem')
      .filter(o => (o.nome || '').toLowerCase().includes(termo) || String(o.numero || '').includes(termo))
      .slice(0, 8);
    if (!achados.length) {
      return sendText(chatId, 'Não achei nenhum item do orçamento com esse termo. Tenta outra palavra (ou manda "pular" se não quiser vincular a um item específico):');
    }
    await saveSession(chatId, { step: 'sol_aguardando_escolha_item', itens_encontrados: achados });
    const rows = achados.map(o => [{ text: `${o.numero || ''} ${truncar(o.nome || '', 50)}`.trim(), callback_data: `solitem:${o.id}` }]);
    rows.push([{ text: 'Não vincular a um item específico', callback_data: 'solitem:none' }]);
    return sendText(chatId, 'Encontrei estes itens — qual deles?', inlineKeyboard(rows));
  }

  if (session.step === 'sol_aguardando_descricao' && text) {
    await saveSession(chatId, { descricao: text, step: 'sol_aguardando_quantidade' });
    return sendText(chatId, 'Quantidade? (manda só o número, ex: 10)');
  }

  if (session.step === 'sol_aguardando_quantidade' && text) {
    const n = parseFloat(text.replace(',', '.'));
    if (!n || n <= 0) return sendText(chatId, 'Manda só um número (ex: 10 ou 2.5):');
    await saveSession(chatId, { quantidade: n, step: 'sol_aguardando_unidade' });
    return sendText(chatId, 'Unidade? (ex: sc, m³, un, kg)');
  }

  if (session.step === 'sol_aguardando_unidade' && text) {
    await saveSession(chatId, { unidade: text, step: 'sol_aguardando_confirmacao' });
    const s = await getSession(chatId);
    const resumo = [
      `🏗️ Obra: <b>${escapeHtml(s.projeto_nome)}</b>`,
      `🏷️ Tipo: <b>${escapeHtml(s.tipo)}</b>`,
      s.orc_label ? `📋 Item: <b>${escapeHtml(s.orc_label)}</b>` : null,
      `📝 ${escapeHtml(s.descricao)}`,
      `📦 Quantidade: ${s.quantidade} ${escapeHtml(s.unidade)}`
    ].filter(Boolean).join('\n');
    return sendText(chatId, `${resumo}\n\nConfirma o envio pro administrador?`, inlineKeyboard([
      [{ text: '✅ Enviar solicitação', callback_data: 'confirmarsol:sim' }],
      [{ text: '❌ Cancelar', callback_data: 'confirmarsol:cancelar' }]
    ]));
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

  return sendText(chatId, 'Manda /nova pra lançar uma compra, ou /solicitar pra pedir autorização.');
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

  // 'aprovarsol' não depende de sessão — o admin pode tocar no botão a qualquer momento,
  // mesmo sem ter uma conversa em andamento com o bot.
  if (action === 'aprovarsol') return processarAprovacao(chatId, value);

  const session = await getSession(chatId);
  if (!session) return sendText(chatId, 'Sessão expirada. Manda /nova ou /solicitar de novo.');

  if (action === 'obra') {
    const projetos = await listProjetos();
    const p = projetos.find(x => String(x.id) === value);
    const modo = session.modo || 'compra';
    if (modo === 'solicitacao') {
      await saveSession(chatId, { projeto_id: value, projeto_nome: p ? p.nome : '', step: 'sol_aguardando_tipo' });
    } else {
      await saveSession(chatId, { projeto_id: value, projeto_nome: p ? p.nome : '', step: 'aguardando_tipo' });
    }
    const rows = TIPOS_COMPRA.map(t => [{ text: t, callback_data: `tipo:${t}` }]);
    return sendText(chatId, `Obra: <b>${escapeHtml(p ? p.nome : '')}</b>\n\nQual o tipo?`, inlineKeyboard(rows));
  }

  if (action === 'tipo') {
    if (session.step === 'sol_aguardando_tipo') {
      await saveSession(chatId, { tipo: value, step: 'sol_aguardando_busca_item' });
      return sendText(chatId, `Tipo: <b>${escapeHtml(value)}</b>\n\nDigita um pedaço do nome (ou número) do item do orçamento — ou manda "pular" se não quiser vincular a um item específico:`);
    }
    await saveSession(chatId, { tipo: value, step: 'aguardando_busca_item' });
    return sendText(chatId, `Tipo: <b>${escapeHtml(value)}</b>\n\nAgora digita um pedaço do nome (ou número) do item do orçamento que essa compra se refere:`);
  }

  if (action === 'solitem') {
    if (value === 'none') {
      await saveSession(chatId, { orc_id: null, orc_label: '', step: 'sol_aguardando_descricao', itens_encontrados: null });
    } else {
      const encontrados = session.itens_encontrados || [];
      const item = encontrados.find(o => String(o.id) === value);
      const label = item ? `${item.numero || ''} ${item.nome || ''}`.trim() : value;
      await saveSession(chatId, { orc_id: value, orc_label: label, step: 'sol_aguardando_descricao', itens_encontrados: null });
    }
    return sendText(chatId, 'Descreva o que precisa ser comprado:');
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
    return sendText(chatId, '📷 Agora manda a foto da nota fiscal. Se a nota tiver mais de uma folha, manda uma foto de cada vez — eu vou perguntando se tem mais.');
  }

  if (action === 'maispag') {
    if (value === 'sim') return sendText(chatId, '📷 Manda a foto da próxima folha.');
    if (value === 'nao') return mostrarResumoFinal(chatId, session);
  }

  if (action === 'confirmar') {
    if (value === 'sim') return gravarComprasPendentes(chatId, session);
    if (value === 'cancelar') {
      await clearSession(chatId);
      return sendText(chatId, 'Lançamento cancelado. Manda /nova pra começar de novo.');
    }
  }

  if (action === 'confirmarsol') {
    if (value === 'sim') return gravarSolicitacaoTelegram(chatId, session);
    if (value === 'cancelar') {
      await clearSession(chatId);
      return sendText(chatId, 'Solicitação cancelada. Manda /solicitar pra começar de novo.');
    }
  }

  return null;
}

/* ---------------- Solicitação de compra (fluxo /solicitar) ---------------- */
async function gravarSolicitacaoTelegram(chatId, session) {
  const s = await getSession(chatId);
  const inserted = await sb('solicitacoes_compra', {
    method: 'POST',
    body: JSON.stringify([{
      projeto_id: s.projeto_id,
      projeto_nome: s.projeto_nome,
      orc_id: s.orc_id,
      orc_label: s.orc_label,
      tipo: s.tipo,
      descricao: s.descricao,
      quantidade: s.quantidade,
      unidade: s.unidade,
      status: 'pendente',
      origem: 'telegram',
      telegram_user: String(chatId)
    }])
  });
  await clearSession(chatId);
  const nova = inserted && inserted[0];
  if (nova) await notificarAdminSolicitacao(nova);
  return sendText(chatId, '✅ Solicitação enviada! Assim que o administrador responder, eu te aviso por aqui.\n\nManda /nova pra lançar uma compra, ou /solicitar pra pedir outra autorização.');
}

async function notificarAdminSolicitacao(s) {
  const cfg = await getConfigGlobal();
  const adminId = cfg.telegramAdminId;
  if (!adminId) return; // não configurado ainda em Configuração
  const texto = [
    `🛒 <b>Nova solicitação de compra</b> (via Telegram)`,
    `🏗️ Obra: ${escapeHtml(s.projeto_nome || '')}`,
    `🏷️ Tipo: ${escapeHtml(s.tipo || '')}`,
    s.orc_label ? `📋 Item: ${escapeHtml(s.orc_label)}` : null,
    `📝 ${escapeHtml(s.descricao || '')}`,
    `📦 Quantidade: ${s.quantidade} ${escapeHtml(s.unidade || '')}`
  ].filter(Boolean).join('\n');
  return sendText(adminId, texto, inlineKeyboard([[
    { text: '✅ Aprovar', callback_data: `aprovarsol:${s.id}:sim` },
    { text: '❌ Não aprovar', callback_data: `aprovarsol:${s.id}:nao` }
  ]]));
}

async function processarAprovacao(adminChatId, value) {
  const [solId, decisao] = (value || '').split(':');
  const rows = await sb(`solicitacoes_compra?id=eq.${solId}&select=*`);
  const s = rows[0];
  if (!s) return sendText(adminChatId, 'Não encontrei mais essa solicitação (pode já ter sido excluída).');
  if (s.status !== 'pendente') {
    return sendText(adminChatId, `Essa solicitação já tinha sido marcada como "${s.status}" antes.`);
  }
  const novoStatus = decisao === 'sim' ? 'aprovada' : 'nao_aprovada';
  await sb(`solicitacoes_compra?id=eq.${solId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: novoStatus, respondido_em: new Date().toISOString() })
  });

  const resumoItem = `${escapeHtml(s.descricao || '')} — ${s.quantidade} ${escapeHtml(s.unidade || '')} (${escapeHtml(s.tipo || '')})${s.orc_label ? ' · ' + escapeHtml(s.orc_label) : ''} · Obra: ${escapeHtml(s.projeto_nome || '')}`;
  await sendText(adminChatId, `${novoStatus === 'aprovada' ? '✅ Marcado como Aprovada' : '❌ Marcado como Não aprovada'}.\n\n${resumoItem}`);

  const cfg = await getConfigGlobal();
  if (cfg.telegramComprasId) {
    await sendText(cfg.telegramComprasId, `${novoStatus === 'aprovada' ? '✅ Compra aprovada' : '❌ Compra não aprovada'}: ${resumoItem}`);
  }
  if (s.origem === 'telegram' && s.telegram_user && String(s.telegram_user) !== String(adminChatId)) {
    await sendText(s.telegram_user, `${novoStatus === 'aprovada' ? '✅ Sua solicitação foi aprovada!' : '❌ Sua solicitação não foi aprovada.'}\n\n${resumoItem}`);
  }
}

/* ---------------- Foto → leitura da nota (suporta várias folhas e vários itens) ---------------- */
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

  // Pede pro Claude extrair os itens desta folha
  const lida = await lerNotaComClaude(base64);

  const headerAnterior = session.extraido || {};
  const headerNovo = {
    loja: headerAnterior.loja || lida.loja || null,
    data: headerAnterior.data || lida.data || null,
    numero_nota: headerAnterior.numero_nota || lida.numero_nota || null
  };
  const itensAcumulados = (session.itens_extraidos || []).concat(lida.itens || []);
  const fotosAcumuladas = (session.fotos || []).concat([storagePath]);

  await saveSession(chatId, { extraido: headerNovo, itens_extraidos: itensAcumulados, fotos: fotosAcumuladas, foto_path: storagePath });

  const itensDestaFolha = (lida.itens || []).map(it => `• ${escapeHtml(it.descricao || 'item')} — R$ ${fmtMoney(it.valor_total)}`).join('\n') || '(nenhum item identificado nessa folha)';
  const totalAteAgora = itensAcumulados.reduce((s, it) => s + (Number(it.valor_total) || 0), 0);

  const msgFolha = [
    `📄 Itens identificados nesta folha:`,
    itensDestaFolha,
    ``,
    `Total acumulado da nota até agora: <b>R$ ${fmtMoney(totalAteAgora)}</b> (${itensAcumulados.length} item(ns))`,
    ``,
    `Essa nota tem mais alguma folha?`
  ].join('\n');

  return sendText(chatId, msgFolha, inlineKeyboard([
    [{ text: '📄 Sim, mandar próxima folha', callback_data: 'maispag:sim' }],
    [{ text: '✅ Não, é só isso', callback_data: 'maispag:nao' }]
  ]));
}

async function mostrarResumoFinal(chatId, session) {
  const s = await getSession(chatId); // pega a versão mais atualizada
  const itens = s.itens_extraidos || [];
  const header = s.extraido || {};
  await saveSession(chatId, { step: 'aguardando_confirmacao' });

  const totalGeral = itens.reduce((sum, it) => sum + (Number(it.valor_total) || 0), 0);
  const listaItens = itens.map(it => `• ${escapeHtml(it.descricao || 'item')} — R$ ${fmtMoney(it.valor_total)}`).join('\n') || '(nenhum item)';

  const resumo = [
    `🏗️ Obra: <b>${escapeHtml(s.projeto_nome)}</b>`,
    `🏷️ Tipo: <b>${escapeHtml(s.tipo)}</b>`,
    `📋 Item do orçamento: <b>${escapeHtml(s.orc_label || '—')}</b>`,
    `💳 Pagamento: <b>${escapeHtml(s.forma_pagto || '—')}${s.forma_pagto === 'Cartão de crédito' ? ` (${s.parcelas}x)` : ''}</b>`,
    `🏦 Banco: <b>${escapeHtml(s.banco || '—')}</b>`,
    ``,
    `🏪 Loja: ${escapeHtml(header.loja || '—')}`,
    `📅 Data: ${header.data || '—'}`,
    `🧾 Nº nota: ${escapeHtml(header.numero_nota || '—')}`,
    `📎 ${(s.fotos || []).length} folha(s) fotografada(s)`,
    ``,
    `<b>Itens (${itens.length}):</b>`,
    listaItens,
    ``,
    `💰 <b>Total da nota: R$ ${fmtMoney(totalGeral)}</b>`
  ].join('\n');

  return sendText(chatId, `${resumo}\n\nCada item acima vai virar uma compra separada no sistema, todas com o mesmo número de nota. Confirma?`, inlineKeyboard([
    [{ text: '✅ Confirmar e lançar', callback_data: 'confirmar:sim' }],
    [{ text: '❌ Cancelar', callback_data: 'confirmar:cancelar' }]
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
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
          { type: 'text', text: 'Esta imagem é uma folha de uma nota fiscal/cupom fiscal brasileiro (pode ser só uma das folhas, se a nota tiver mais de uma). Responda APENAS um JSON válido, sem markdown, sem texto antes ou depois, neste formato: {"loja": string ou null, "data": "YYYY-MM-DD" ou null, "numero_nota": string ou null, "itens": [{"descricao": string curto, "quantidade": number ou null, "valor_unitario": number ou null, "valor_total": number}]}. Liste em "itens" CADA produto/serviço discriminado nesta folha, um por linha do cupom/nota — não agrupe. Se a folha não tiver itens discriminados (ex: só o cabeçalho ou só o totalizador), retorne "itens": []. Se não conseguir ler algum campo, use null.' }
        ]
      }]
    })
  });
  const data = await r.json();
  const textBlock = (data.content || []).find(c => c.type === 'text');
  let raw = textBlock ? textBlock.text : '{}';
  raw = raw.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.itens)) parsed.itens = [];
    parsed.itens = parsed.itens.map(it => ({
      descricao: it.descricao || 'Item',
      quantidade: it.quantidade || 1,
      valor_unitario: it.valor_unitario != null ? it.valor_unitario : it.valor_total,
      valor_total: Number(it.valor_total) || 0
    }));
    return parsed;
  } catch {
    return { loja: null, data: null, numero_nota: null, itens: [] };
  }
}

/* ---------------- Gravação final (uma linha por item) ---------------- */
async function gravarComprasPendentes(chatId, session) {
  const s = await getSession(chatId);
  const header = s.extraido || {};
  const itens = s.itens_extraidos || [];
  if (!itens.length) {
    await clearSession(chatId);
    return sendText(chatId, 'Não identifiquei nenhum item nas fotos enviadas, então não lancei nada. Manda /nova pra tentar de novo.');
  }
  const linhas = itens.map(it => ({
    projeto_id: s.projeto_id,
    projeto_nome: s.projeto_nome,
    tipo: s.tipo,
    orc_id: s.orc_id,
    orc_label: s.orc_label,
    forma_pagto: s.forma_pagto || 'PIX',
    parcelas: s.parcelas || 1,
    banco: s.banco || '',
    loja: header.loja,
    valor_total: it.valor_total,
    quantidade: it.quantidade || 1,
    valor_unitario: it.valor_unitario != null ? it.valor_unitario : it.valor_total,
    data_nota: header.data,
    numero_nota: header.numero_nota,
    descricao: it.descricao,
    foto_path: (s.fotos || [])[0] || null,
    fotos: s.fotos || [],
    telegram_user: chatId
  }));
  await sb('compras_pendentes', { method: 'POST', body: JSON.stringify(linhas) });
  await clearSession(chatId);

  // Sobe as fotos da nota pro Google Drive também (Sistema de obra / Obra / Notas
  // fiscais). Isso é um extra — se o Drive não estiver conectado ou der algum
  // erro, a compra já está registrada de qualquer forma, então não travamos o
  // fluxo por causa disso.
  try { await enviarFotosNotaParaDrive(s, header, itens); }
  catch (e) { console.error('Upload da nota pro Drive:', e); }

  return sendText(chatId, `✅ ${linhas.length} item(ns) registrado(s)! Eles vão aparecer no Qorban Controle na próxima vez que você abrir essa obra, na aba de Compras — todos com o número de nota <b>${escapeHtml(header.numero_nota || '—')}</b>.\n\nManda /nova pra lançar outra.`);
}

async function baixarFotoDoSupabase(path) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/notas-fiscais/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!r.ok) throw new Error(`Falha ao baixar foto do Supabase: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function enviarFotosNotaParaDrive(s, header, itens) {
  const fotos = s.fotos || [];
  if (!fotos.length) return;

  const resumoInsumos = truncar(itens.map(it => it.descricao).filter(Boolean).join(', ') || 'compra', 60);
  const base = sanitizeFileName(`${header.data || 'sem-data'} - ${header.loja || 'loja não identificada'} - ${s.orc_label || 'sem item vinculado'} - ${resumoInsumos}`);
  const folderId = await ensureProjectSubfolder(s.projeto_nome, 'Notas fiscais');

  for (let i = 0; i < fotos.length; i++) {
    const nome = fotos.length > 1 ? `${base} - pág ${i + 1}.jpg` : `${base}.jpg`;
    const buffer = await baixarFotoDoSupabase(fotos[i]);
    await uploadFile(folderId, nome, 'image/jpeg', buffer);
  }
}

/* ---------------- utils ---------------- */
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function truncar(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function fmtMoney(n) { return (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
