/**
 * api/start-trial.js
 * Endpoint server-side para login/trial. Substitui as chamadas diretas do
 * front-end ao Supabase (que usavam a anon key e podiam ser chamadas por
 * fora do site, sem passar por nenhuma validação).
 *
 * Faz duas coisas:
 *   1. Se o e-mail já existe no banco, retorna o status da conta (mesma
 *      lógica que já existia no index.html).
 *   2. Se é e-mail novo, verifica se o IP de quem está pedindo já recebeu
 *      um trial nas últimas 24h. Se sim, bloqueia. Se não, libera e grava
 *      o IP junto com o trial.
 *
 * Variáveis de ambiente obrigatórias no Vercel (as mesmas do api/webhook.js):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * IMPORTANTE — passo manual necessário no Supabase:
 *   A tabela "users" precisa de uma coluna nova: "trial_ip" (tipo text, pode
 *   ficar nula). Vá em Supabase → Table Editor → tabela "users" → "+ New
 *   column" → nome "trial_ip", tipo "text". Sem essa coluna o endpoint
 *   ainda funciona, mas a checagem de IP fica sempre "livre" (não bloqueia).
 *
 * Janela de bloqueio: um mesmo IP só pode gerar 1 trial novo a cada 24h.
 * Isso não é 100% à prova de burla (IP pode mudar, VPN, etc.), mas já
 * impede o caso mais comum: trocar só o e-mail e clicar de novo.
 */

var TRIAL_MS = 24 * 3600 * 1000;

function getClientIp(req) {
  var fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Supabase não configurado no servidor.');
    return res.status(500).json({ error: 'Servidor não configurado.' });
  }

  const email = (req.body && req.body.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }

  const ip = getClientIp(req);
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    /* 1 — usuário já existe? (ilike = não diferencia maiúsculas/minúsculas,
       importante porque e-mails inseridos manualmente no passado podem ter
       capitalização diferente da que o usuário digita agora) */
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(email)}&select=*`,
      { headers }
    );
    const existing = await checkResp.json();

    if (!checkResp.ok) {
      /* Supabase retornou erro (ex: schema cache desatualizado após criar
         coluna nova, credencial inválida, etc). Loga o detalhe completo
         para aparecer nos Runtime Logs da Vercel. */
      console.error('Supabase respondeu com erro na busca de usuário:', checkResp.status, JSON.stringify(existing));
      return res.status(502).json({ ok: false, reason: 'db_error' });
    }

    const user = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;

    if (user) {
      /* usuário existente — mesma lógica de validação que já existia no front */
      const active =
        user.plan === 'lifetime' ||
        ((user.plan === 'monthly' || user.plan === 'quarterly') && user.expires_at && new Date(user.expires_at) > new Date());
      const inTrial = user.plan === 'trial';

      if (!active && !inTrial) {
        return res.status(200).json({ ok: false, reason: 'expired' });
      }

      return res.status(200).json({
        ok: true,
        user: {
          email: user.email,
          name: user.name || '',
          plan: user.plan,
          expires_at: user.expires_at || null,
          trial_starts_at: user.trial_starts_at || null,
        },
      });
    }

    /* 2 — e-mail novo: checa se esse IP já pegou um trial recente */
    const ipCheckResp = await fetch(
      `${SUPABASE_URL}/rest/v1/users?trial_ip=eq.${encodeURIComponent(ip)}&plan=eq.trial&select=trial_starts_at&order=trial_starts_at.desc&limit=1`,
      { headers }
    );

    if (ipCheckResp.ok) {
      const ipRows = await ipCheckResp.json();
      if (Array.isArray(ipRows) && ipRows.length > 0 && ipRows[0].trial_starts_at) {
        const lastTrialAt = new Date(ipRows[0].trial_starts_at).getTime();
        if (Date.now() - lastTrialAt < TRIAL_MS) {
          return res.status(200).json({ ok: false, reason: 'ip_limit' });
        }
      }
    }
    /* se a query falhar (ex: coluna trial_ip ainda não existe), segue sem bloquear */

    /* 3 — libera trial novo */
    const now = Date.now();
    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        email: email,
        plan: 'trial',
        trial_starts_at: new Date(now).toISOString(),
        trial_ip: ip,
      }),
    });

    return res.status(200).json({
      ok: true,
      user: { email: email, name: '', plan: 'trial', expires_at: null, trial_starts_at: new Date(now).toISOString() },
    });
  } catch (err) {
    console.error('Erro em start-trial:', err);
    return res.status(500).json({ error: 'Erro ao processar solicitação.' });
  }
}
