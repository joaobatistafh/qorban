// api/telegram-notify.js
// Endpoint genérico chamado PELO SITE pra mandar uma mensagem de texto simples
// pelo @NotasQorbanBot (ex: avisar o Setor de Compras que uma solicitação foi
// aprovada/não aprovada). O token do bot nunca fica exposto no front-end.
//
// POST body: { chatId: string|number, text: string }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
    const { chatId, text } = req.body || {};
    if (!chatId || !text) { res.status(400).json({ error: 'chatId e text são obrigatórios' }); return; }

    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const data = await r.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('Erro no telegram-notify:', err);
    res.status(500).json({ error: err.message });
  }
};
