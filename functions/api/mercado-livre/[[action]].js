import { project, publishableKey } from '../../../dist/cloud.js';

const api = 'https://api.mercadolibre.com';
const route = '/api/mercado-livre/';
const cookieName = '__Host-cw_meli';
const encoder = new TextEncoder();

class Failure extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const headers = {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'};
const reply = (body, status = 200, extra = {}) => Response.json(body, {status, headers: {...headers, ...extra}});
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const bytes = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const sha = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));

async function cipher(secret) {
  const key = await crypto.subtle.importKey('raw', await sha('centralwork:mercado-livre:v1:' + secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    async seal(value, purpose) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: encoder.encode(purpose)}, key, encoder.encode(JSON.stringify(value)));
      return b64(iv) + '.' + b64(new Uint8Array(data));
    },
    async open(value, purpose) {
      const [iv, data] = value.split('.');
      const result = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(purpose)}, key, bytes(data));
      return JSON.parse(new TextDecoder().decode(result));
    }
  };
}

async function request(url, options = {}) {
  return fetch(url, {...options, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000)});
}

async function requireAdmin(req) {
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Failure('Entre no CentralWork para continuar.', 401);
  // The workspace is already protected by the active-administrator RLS policy.
  const res = await request(project + '/rest/v1/cw_workspace?id=eq.1&select=id', {
    headers: {apikey: publishableKey, authorization}
  });
  if (!res.ok || (await res.json()).length !== 1) throw new Failure('Acesso restrito à administração.', 403);
}

function storage(secret, box) {
  const endpoint = project + '/rest/v1/cw_mercado_livre';
  const dbHeaders = {apikey: secret, 'Content-Type': 'application/json', Prefer: 'return=representation'};
  async function read(url, options) {
    const res = await request(url, {headers: dbHeaders, ...options});
    if (!res.ok) {
      if (res.status === 409) throw new Failure('A conexão mudou. Abra o painel e tente de novo.', 409);
      throw new Failure('O armazenamento da integração está indisponível.', 503);
    }
    return res.json();
  }
  return {
    async load() {
      const [row] = await read(endpoint + '?id=eq.1&select=revision,encrypted');
      if (!row) return {revision: 0, data: {}};
      return {revision: row.revision, data: await box.open(row.encrypted, 'storage')};
    },
    async save(revision, data) {
      const row = {encrypted: await box.seal(data, 'storage'), revision: revision + 1};
      const rows = await (revision
        ? read(endpoint + '?id=eq.1&revision=eq.' + revision, {method: 'PATCH', body: JSON.stringify(row)})
        : read(endpoint, {method: 'POST', body: JSON.stringify({...row, id: 1})}));
      if (rows.length !== 1) throw new Failure('A conexão mudou. Abra o painel e tente de novo.', 409);
    }
  };
}

async function exchange(config, fields) {
  const res = await request(api + '/oauth/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({...fields, client_id: config.clientId, client_secret: config.clientSecret})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token || !data.refresh_token || !(Number(data.expires_in) > 0)) {
    throw new Failure('O Mercado Livre recusou a autorização. Confira o aplicativo e a URL de retorno.', 502);
  }
  return {access: data.access_token, refresh: data.refresh_token, until: Date.now() + Number(data.expires_in) * 1000};
}

async function meli(path, token) {
  const res = await request(api + path, {headers: {Authorization: 'Bearer ' + token}});
  if (!res.ok) throw new Failure('Consulta ao Mercado Livre indisponível (HTTP ' + res.status + ').', 502);
  return res.json();
}

async function seller(token) {
  const me = await meli('/users/me', token);
  if (me.site_id !== 'MLB' || !/^\d+$/.test(String(me.id))) throw new Failure('Autorize a conta vendedora do Mercado Livre Brasil.');
  return {id: String(me.id), name: String(me.nickname ?? me.id)};
}

async function currentToken(store, record) {
  const {data, revision} = record;
  if (data.refreshStarted) {
    throw new Failure(Date.now() - data.refreshStarted > 30000
      ? 'A renovação ficou incompleta. Autorize a loja novamente.'
      : 'A renovação está em andamento. Tente novamente em instantes.', 409);
  }
  if (data.token.until > Date.now() + 60000) return data.token.access;
  // Claim the refresh before using the single-use refresh token.
  await store.save(revision, {...data, refreshStarted: Date.now()});
  try {
    const token = await exchange(data.config, {grant_type: 'refresh_token', refresh_token: data.token.refresh});
    await store.save(revision + 1, {...data, token});
    return token.access;
  } catch {
    throw new Failure('A renovação não pôde ser confirmada. Autorize a loja novamente.', 502);
  }
}

const flowCookie = value => cookieName + '=' + value + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + (value ? 600 : 0);
const callbackLocation = outcome => new Response(null, {status: 303, headers: {
  ...headers, Location: '/?mercado_livre=' + outcome, 'Set-Cookie': flowCookie('')
}});

async function callback(req, url, box, store, redirectUri) {
  try {
    const value = req.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-cw_meli=([^;]+)/)?.[1];
    const flow = value && await box.open(value, 'oauth');
    const code = url.searchParams.get('code');
    if (!flow || !code || flow.expires < Date.now() || flow.state !== url.searchParams.get('state') || flow.redirectUri !== redirectUri) return callbackLocation('erro');
    const {revision, data} = await store.load();
    if (revision !== flow.revision) return callbackLocation('erro');
    const token = await exchange(flow.config, {grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: flow.verifier});
    const account = await seller(token.access);
    if (data.account && data.account.id !== account.id) return callbackLocation('outra_loja');
    await store.save(revision, {config: flow.config, account, token});
    return callbackLocation('conectado');
  } catch {
    return callbackLocation('erro');
  }
}

async function overview(store, record) {
  const token = await currentToken(store, record);
  const id = record.data.account.id;
  const queryTime = new Date();
  const since = new Date(queryTime.getTime() - 30 * 86400000).toISOString();
  const orderQuery = new URLSearchParams({seller: id, limit: '5', sort: 'date_desc', 'order.date_created.from': since, 'order.date_created.to': queryTime.toISOString()});
  const [info, items, orders] = await Promise.allSettled([
    meli('/users/me', token),
    meli('/users/' + id + '/items/search?status=active&limit=1', token),
    meli('/orders/search?' + orderQuery, token)
  ]);
  const result = entry => entry.status === 'fulfilled' ? entry.value : null;
  const orderData = result(orders);
  return {
    account: record.data.account,
    reputation: result(info)?.seller_reputation?.level_id ?? null,
    activeListings: result(items)?.paging?.total ?? null,
    orders30: orderData?.paging?.total ?? null,
    lastOrders: (orderData?.results ?? []).map(({id, date_created, status, total_amount, currency_id}) => ({
      id, date: date_created, status, amount: total_amount, currency: currency_id
    })),
    failed: [info, items, orders].flatMap((entry, i) => entry.status === 'rejected' ? [['reputação', 'anúncios', 'pedidos'][i]] : [])
  };
}

export async function onRequest({request: req, env}) {
  const url = new URL(req.url);
  const action = url.pathname.slice(route.length);
  const redirectUri = url.origin + route + 'callback';
  const secret = env.CW_SUPABASE_SECRET_KEY;
  if (url.protocol !== 'https:') return reply({error: 'A integração requer HTTPS.'}, 400);
  if (!secret?.startsWith('sb_secret_')) return reply({error: 'O servidor ainda precisa da configuração da integração.'}, 503);
  try {
    const box = await cipher(secret);
    const store = storage(secret, box);
    if (action === 'callback' && req.method === 'GET') return callback(req, url, box, store, redirectUri);
    await requireAdmin(req);
    const record = await store.load();
    if (req.method === 'GET' && action === 'status') return reply({account: record.data.account ?? null, redirectUri});
    if (req.method === 'GET' && action === 'overview' && record.data.account) return reply(await overview(store, record));
    if (req.method === 'POST' && action === 'connect') {
      if (req.headers.get('Origin') !== url.origin) throw new Failure('Origem da solicitação inválida.', 403);
      const body = await req.json().catch(() => ({}));
      const config = body.reuse === true ? record.data.config : {clientId: String(body.clientId ?? '').trim(), clientSecret: String(body.clientSecret ?? '').trim()};
      if (!config || !/^\d{1,32}$/.test(config.clientId) || !/^[^\s]{8,200}$/.test(config.clientSecret)) throw new Failure('Confira o Client ID e o Client Secret.');
      const state = random();
      const verifier = random();
      const flow = await box.seal({config, verifier, state, redirectUri, revision: record.revision, expires: Date.now() + 600000}, 'oauth');
      const query = new URLSearchParams({response_type: 'code', client_id: config.clientId, redirect_uri: redirectUri, state, code_challenge: b64(await sha(verifier)), code_challenge_method: 'S256', scope: 'read write offline_access'});
      return reply({url: 'https://auth.mercadolivre.com.br/authorization?' + query}, 200, {'Set-Cookie': flowCookie(flow)});
    }
    return reply({error: 'Operação indisponível.'}, 404);
  } catch (error) {
    return reply({error: error instanceof Failure ? error.message : 'A integração não respondeu. Tente novamente.'}, error instanceof Failure ? error.status : 502);
  }
}
