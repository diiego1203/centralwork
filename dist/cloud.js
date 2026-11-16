export const project = 'https://jbcvliihcarmbrszghcp.supabase.co';
export const publishableKey = 'sb_publishable_Lg94pvVjZtoMd9iNPBDMxQ_3_EOH4w-';
let session;

async function request(path, {method = 'GET', body, token, prefer} = {}) {
  const headers = {apikey: publishableKey};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  if (prefer) headers.Prefer = prefer;
  let response;
  try {
    response = await fetch(project + path, {
      method, headers, body: JSON.stringify(body), cache: 'no-store',
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error('Sem conexão com o banco. Confira a internet e tente novamente.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('O Supabase não confirmou a operação.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function acceptSession(data) {
  if (!data?.access_token || !data.refresh_token) throw new Error('Sessão indisponível.');
  session = {...data, expiresAt: Date.now() + Number(data.expires_in) * 1000};
}

export async function accessToken() {
  if (!session) throw new Error('Entre novamente para continuar.');
  if (session.expiresAt - Date.now() < 60000) {
    acceptSession(await request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: {refresh_token: session.refresh_token}
    }));
  }
  return session.access_token;
}

async function profile() {
  const rows = await request('/rest/v1/cw_admins?select=username,password_setup_required', {token: await accessToken()});
  if (rows?.length !== 1) throw new Error('Conta ainda não liberada no CentralWork.');
  return rows[0];
}

export async function login(username, password) {
  let data;
  try {
    data = await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: {email: username + '@centralwork.invalid', password}
    });
  } catch (error) {
    if ([400, 401, 422].includes(error.status)) throw new Error('Usuário ou senha inválidos.');
    if (error.status === 429) throw new Error('Muitas tentativas. Aguarde e tente novamente.');
    throw error;
  }
  acceptSession(data);
  const admin = await profile();
  if (admin.username !== username) throw new Error('Conta ainda não liberada no CentralWork.');
  return admin;
}

export async function setPassword(password) {
  await request('/auth/v1/user', {method: 'PUT', token: await accessToken(), body: {password}});
  const admin = await profile();
  if (admin.password_setup_required) throw new Error('O banco ainda não confirmou a ativação.');
  return admin;
}

export async function logout() {
  const token = session?.access_token;
  session = null;
  if (token) await request('/auth/v1/logout?scope=local', {method: 'POST', token}).catch(() => {});
}

export async function loadWorkspace() {
  const rows = await request('/rest/v1/cw_workspace?id=eq.1&select=revision,data', {token: await accessToken()});
  if (rows?.length !== 1) throw new Error('Acesso ao banco indisponível. Entre novamente.');
  return rows[0];
}

export async function saveWorkspace(data, revision) {
  const rows = await request('/rest/v1/cw_workspace?id=eq.1&revision=eq.' + revision + '&select=revision', {
    method: 'PATCH', token: await accessToken(), prefer: 'return=representation',
    body: {data, revision: revision + 1, updated_at: new Date().toISOString()}
  });
  if (rows?.length !== 1) throw new Error('A gravação não foi confirmada. Atualize o painel antes de repetir a alteração.');
  return rows[0].revision;
}

