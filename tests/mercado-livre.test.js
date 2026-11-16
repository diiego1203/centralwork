import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {onRequest} from '../functions/api/mercado-livre/[[action]].js';

test('OAuth do Mercado Livre valida administração e state, cifra credenciais e consulta a loja', async t => {
  const origin = 'https://example.pages.dev';
  const base = origin + '/api/mercado-livre/';
  const env = {CW_SUPABASE_SECRET_KEY: 'sb_secret_fake_only_for_local_tests'};
  let row;
  let challenge;
  let exchangeCalls = 0;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/cw_workspace')) {
      return Response.json(options.headers.authorization === 'Bearer admin' ? [{id: 1}] : []);
    }
    if (url.pathname.endsWith('/cw_mercado_livre')) {
      if (options.method === 'POST') row = JSON.parse(options.body);
      return Response.json(row ? [row] : []);
    }
    if (url.pathname === '/oauth/token') {
      exchangeCalls++;
      assert.equal(options.body.get('client_secret'), 'my-app-private-secret');
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), challenge);
      return Response.json({access_token: 'seller-token', refresh_token: 'refresh-token', expires_in: 21600});
    }
    assert.equal(options.headers.Authorization, 'Bearer seller-token');
    if (url.pathname === '/users/me') return Response.json({id: 123, site_id: 'MLB', nickname: 'Vendedor', seller_reputation: {level_id: '5_green'}});
    if (url.pathname.endsWith('/items/search')) return Response.json({paging: {total: 7}});
    if (url.pathname === '/orders/search') {
      assert.equal(url.searchParams.get('seller'), '123');
      return Response.json({paging: {total: 21}, results: [{id: 42, buyer: {id: 432}, status: 'paid'}]});
    }
    throw Error('Rota de teste inesperada: ' + url.pathname);
  });

  const run = (path, init = {}, config = env) => onRequest({request: new Request(base + path, init), env: config});
  const admin = {Authorization: 'Bearer admin'};
  assert.equal((await run('status', {}, {})).status, 503);
  assert.equal((await run('status')).status, 401);
  assert.equal((await run('status', {headers: {Authorization: 'Bearer outsider'}})).status, 403);
  const connect = await run('connect', {
    method: 'POST',
    headers: {...admin, Origin: origin},
    body: JSON.stringify({clientId: '12345', clientSecret: 'my-app-private-secret'})
  });
  assert.equal(connect.status, 200);
  const authorization = new URL((await connect.json()).url);
  assert.equal(authorization.origin, 'https://auth.mercadolivre.com.br');
  assert.equal(authorization.searchParams.get('redirect_uri'), base + 'callback');
  challenge = authorization.searchParams.get('code_challenge');
  const headers = {Cookie: connect.headers.get('Set-Cookie').split(';')[0]};
  const mismatch = await run('callback?code=example&state=wrong', {headers});
  assert.equal(mismatch.headers.get('Location'), '/?mercado_livre=erro');
  assert.equal(exchangeCalls, 0);
  const state = authorization.searchParams.get('state');
  const valid = await run('callback?code=example&state=' + state, {headers});
  assert.equal(valid.headers.get('Location'), '/?mercado_livre=conectado');
  assert.equal(exchangeCalls, 1);
  assert.doesNotMatch(JSON.stringify(row), /seller-token|refresh-token|my-app-private-secret/);
  const replay = await run('callback?code=example&state=' + state, {headers});
  assert.equal(replay.headers.get('Location'), '/?mercado_livre=erro');
  assert.equal(exchangeCalls, 1);
  const report = await (await run('overview', {headers: admin})).json();
  assert.equal(report.activeListings, 7);
  assert.equal(report.orders30, 21);
  assert.equal(report.reputation, '5_green');
  assert.equal(report.lastOrders[0].buyer, undefined);
});
