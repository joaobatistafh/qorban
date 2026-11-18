/* ============================================================
   auth.js — Login do Qorban Controle (Supabase Auth via REST)
   - Só e-mails cadastrados (admins ou menu Acessos) criam senha.
   - Primeiro acesso e "Esqueceu a senha": link por e-mail → nova senha.
   - "Manter conectado": sessão em localStorage com renovação automática.
   Nenhuma senha fica no código nem no banco de dados do app.
   ============================================================ */
const Auth = (function(){
  const URL_ = 'https://kbuiljbrrvdabwtdwayp.supabase.co';
  const KEY = 'sb_publishable_psFslciJm9QIZTBkCiF77Q_SxA0hTaA';
  const SKEY = 'qorban_auth_v1';
  let sess = null, timer = null, cooldownTimer = null;
  const api = { onToken: function(){}, email: ()=> sess ? sess.email : '' };

  function stored(){ try{ return JSON.parse(localStorage.getItem(SKEY) || sessionStorage.getItem(SKEY) || 'null'); }catch(e){ return null; } }
  function persist(){
    try{
      localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY);
      (sess.keep ? localStorage : sessionStorage).setItem(SKEY, JSON.stringify(sess));
    }catch(e){}
  }
  function clearStored(){ try{ localStorage.removeItem(SKEY); sessionStorage.removeItem(SKEY); }catch(e){} }

  async function gotrue(path, body, token, method){
    const r = await fetch(URL_ + '/auth/v1/' + path, {
      method: method || 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || KEY) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(()=> ({}));
    if(!r.ok) throw Object.assign(new Error(j.msg || j.error_description || j.message || 'Erro'), { status: r.status, code: j.error_code || j.code || '' });
    return j;
  }
  function toSession(j, keep){
    return {
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now()/1000) + (j.expires_in || 3600),
      email: ((j.user && j.user.email) || '').toLowerCase(), keep: !!keep,
    };
  }
  function activate(s){
    sess = s; persist(); api.onToken(s.access_token); schedule();
  }
  function schedule(){
    clearTimeout(timer);
    const ms = Math.max(5000, sess.expires_at * 1000 - Date.now() - 60000);
    timer = setTimeout(refresh, Math.min(ms, 2147000000));
  }
  async function refresh(){
    if(!sess) return false;
    try{
      const j = await gotrue('token?grant_type=refresh_token', { refresh_token: sess.refresh_token });
      const novo = toSession(j, sess.keep); if(!novo.email) novo.email = sess.email;
      activate(novo);
      return true;
    }catch(e){
      if(e.status === 400 || e.status === 401 || e.status === 403){ clearStored(); sess = null; api.onToken(null); location.reload(); }
      return false;
    }
  }
  async function meuAcesso(){
    const r = await fetch(URL_ + '/rest/v1/rpc/meu_acesso', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + sess.access_token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if(!r.ok) throw new Error('Não foi possível verificar o acesso.');
    return r.json();
  }
  async function sair(){
    try{ if(sess) await gotrue('logout', null, sess.access_token); }catch(e){}
    clearStored(); sess = null; api.onToken(null); location.reload();
  }

  /* ---------------- Interface ---------------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function setMsg(t, ok){ const m = $('authMsg'); if(m){ m.textContent = t || ''; m.className = 'auth-msg' + (ok ? ' ok' : ''); } }
  function busy(on){ document.querySelectorAll('#authBox button').forEach(b => b.disabled = on); }
  function view(html){ $('authBox').innerHTML = html + '<div id="authMsg" class="auth-msg"></div>'; }
  const MSG_SEM_ACESSO = 'Este e-mail não tem acesso ao Controle. Clientes devem usar o Portal do Cliente.';
  let avisoInicial = '';
  const MSG_CODIGO = 'Se este e-mail estiver cadastrado, enviamos um link de acesso. Confira também o spam.';

  function telaLogin(email){
    view(`<h2>Entrar</h2>
      <input type="email" id="aEmail" class="cell" placeholder="E-mail" autocomplete="username" value="${esc(email||'')}">
      <input type="password" id="aSenha" class="cell" placeholder="Senha" autocomplete="current-password">
      <label class="auth-chk"><input type="checkbox" id="aKeep" checked> Manter conectado</label>
      <button class="btn primary" id="aEntrar">Entrar</button>
      <div class="auth-links"><a id="aPrimeiro">Primeiro acesso</a><a id="aEsqueci">Esqueceu a senha?</a></div>`);
  }
  function telaPedirCodigo(modo, email){
    view(`<h2>${modo==='primeiro' ? 'Primeiro acesso' : 'Esqueceu a senha'}</h2>
      <p>Informe o e-mail cadastrado pela empresa. Enviaremos um link de acesso para você criar ${modo==='primeiro' ? 'sua senha' : 'uma nova senha'}.</p>
      <input type="email" id="aEmail" class="cell" placeholder="E-mail" autocomplete="username" value="${esc(email||'')}">
      <button class="btn primary" id="aEnviar">Enviar link</button>
      <div class="auth-links"><a id="aVoltar">Voltar ao login</a></div>`);
  }
  function telaLinkEnviado(email){
    view(`<h2>Verifique seu e-mail</h2>
      <p>Enviamos um e-mail para <b>${esc(email)}</b>. Clique em <b>"Sign in"</b> no e-mail: você volta para cá para criar a senha.</p>
      <p>O link vale por pouco tempo e só pode ser usado uma vez. Confira também o spam.</p>
      <div class="auth-links"><a id="aReenviar">Reenviar link</a><a id="aVoltar">Voltar ao login</a></div>`);
  }
  function telaNovaSenha(){
    view(`<h2>Crie sua senha</h2>
      <p>Mínimo de 8 caracteres, com letras e números.</p>
      <input type="password" id="aNova" class="cell" placeholder="Nova senha" autocomplete="new-password">
      <input type="password" id="aNova2" class="cell" placeholder="Repita a nova senha" autocomplete="new-password">
      <button class="btn primary" id="aSalvar">Salvar e entrar</button>`);
  }
  function senhaValida(s){ return s.length >= 8 && /[A-Za-z]/.test(s) && /\d/.test(s); }

  async function pedirCodigo(email){
    const r = await fetch('/api/auth-solicitar-codigo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    if(r.status === 400) throw new Error('Informe um e-mail válido.');
    if(!r.ok) throw new Error('Não foi possível enviar o link agora. Tente novamente.');
  }

  function loginFlow(opts){
    opts = opts || {};
    return new Promise(resolve => {
      const overlay = $('authOverlay');
      overlay.style.display = 'flex';
      let pendente = opts.pendente || null; // sessão criada pelo link do e-mail, ainda sem senha definida
      let emailAtual = '';

      async function concluir(s){
        activate(s);
        let acesso;
        try{ acesso = await meuAcesso(); }catch(e){ setMsg('Não foi possível verificar seu acesso. Tente novamente.'); return false; }
        if(!acesso.equipe){
          try{ await gotrue('logout', null, s.access_token); }catch(e){}
          clearStored(); sess = null; api.onToken(null);
          telaLogin(s.email); setMsg(MSG_SEM_ACESSO);
          return false;
        }
        overlay.style.display = 'none';
        resolve({ email: s.email, admin: !!acesso.admin });
        return true;
      }
      function iniciarCooldown(){
        const a = $('aReenviar'); if(!a) return;
        let n = 60; a.style.pointerEvents = 'none'; a.style.opacity = '.5';
        clearInterval(cooldownTimer);
        cooldownTimer = setInterval(()=>{ n--; a.textContent = n > 0 ? `Reenviar link (${n}s)` : 'Reenviar link'; if(n <= 0){ clearInterval(cooldownTimer); a.style.pointerEvents = ''; a.style.opacity = ''; } }, 1000);
      }

      overlay.onclick = async ev => {
        const id = ev.target.id;
        if(!id) return;
        const email = () => ($('aEmail') ? $('aEmail').value.trim().toLowerCase() : emailAtual);
        if(id === 'aPrimeiro'){ telaPedirCodigo('primeiro', email()); return; }
        if(id === 'aEsqueci'){ telaPedirCodigo('esqueci', email()); return; }
        if(id === 'aVoltar'){ telaLogin(email()); return; }
        try{
          if(id === 'aEntrar'){
            const e = email(), p = $('aSenha').value;
            if(!e || !p){ setMsg('Preencha e-mail e senha.'); return; }
            busy(true);
            try{
              const j = await gotrue('token?grant_type=password', { email: e, password: p });
              const ok = await concluir(toSession(j, $('aKeep').checked));
              if(!ok){ busy(false); }
            }catch(err){
              busy(false);
              setMsg(err.status === 400 ? 'E-mail ou senha incorretos.' : (err.status === 429 ? 'Muitas tentativas. Aguarde um pouco.' : 'Não foi possível entrar. Tente novamente.'));
            }
          }
          if(id === 'aEnviar' || id === 'aReenviar'){
            const e = email(); if(!e){ setMsg('Informe o e-mail.'); return; }
            busy(true); emailAtual = e;
            await pedirCodigo(e);
            telaLinkEnviado(e); setMsg(MSG_CODIGO, true); iniciarCooldown();
          }
          if(id === 'aSalvar'){
            const n1 = $('aNova').value, n2 = $('aNova2').value;
            if(!senhaValida(n1)){ setMsg('A senha precisa de 8+ caracteres, com letras e números.'); return; }
            if(n1 !== n2){ setMsg('As senhas não conferem.'); return; }
            busy(true);
            try{
              await gotrue('user', { password: n1 }, pendente.access_token, 'PUT');
              const ok = await concluir(toSession(pendente, true));
              if(!ok){ busy(false); }
            }catch(err){ busy(false); setMsg(err.message && err.message.length < 140 ? err.message : 'Não foi possível salvar a senha.'); }
          }
        }catch(err){ busy(false); setMsg(err.message || 'Erro inesperado.'); }
      };
      overlay.onkeydown = ev => {
        if(ev.key !== 'Enter') return;
        const b = overlay.querySelector('#aEntrar, #aEnviar, #aVerificar, #aSalvar'); if(b) b.click();
      };
      if(pendente) telaNovaSenha(); else telaLogin('');
      if(avisoInicial){ setMsg(avisoInicial); avisoInicial = ''; }
    });
  }

  /* O e-mail do Supabase traz um link que volta para o site com a sessão no endereço (#access_token=...). */
  function lerLinkDoEmail(){
    const h = (location.hash || '').replace(/^#/, '');
    if(!h || (h.indexOf('access_token=') < 0 && h.indexOf('error=') < 0)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search);
    if(p.get('error')) return { erro: p.get('error_code') === 'otp_expired' ? 'Link expirado ou já usado. Peça um novo link.' : 'Link inválido. Peça um novo link.' };
    if(p.get('access_token') && p.get('refresh_token')){
      return { session: { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'),
        expires_at: parseInt(p.get('expires_at'), 10) || Math.floor(Date.now()/1000) + (parseInt(p.get('expires_in'), 10) || 3600) } };
    }
    return null;
  }
  api._lerLink = lerLinkDoEmail;

  /* Ponto de entrada: devolve {email, admin} só depois de autenticado E autorizado. */
  api.require = async function(){
    const link = lerLinkDoEmail();
    if(link && link.session){
      try{
        const u = await gotrue('user', null, link.session.access_token, 'GET');
        return loginFlow({ pendente: Object.assign({}, link.session, { user: u }) });
      }catch(e){ avisoInicial = 'Link expirado ou já usado. Peça um novo link.'; }
    } else if(link && link.erro){ avisoInicial = link.erro; }
    const s = stored();
    if(s && s.refresh_token){
      sess = s;
      if(s.expires_at * 1000 - Date.now() < 30000){ if(!(await refresh())) sess = null; }
      else { api.onToken(s.access_token); schedule(); }
    }
    if(sess){
      try{
        const a = await meuAcesso();
        if(a.equipe) return { email: sess.email, admin: !!a.admin };
        try{ await gotrue('logout', null, sess.access_token); }catch(e){}
        clearStored(); sess = null; api.onToken(null); avisoInicial = MSG_SEM_ACESSO;
      }catch(e){ /* sem rede/erro: cai no login */ }
    }
    return loginFlow();
  };
  api.logout = sair;
  api.refresh = refresh;
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden && sess && sess.expires_at * 1000 - Date.now() < 60000) refresh();
  });
  return api;
})();
