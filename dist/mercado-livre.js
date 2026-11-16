import {accessToken} from './cloud.js';

const root = '/api/mercado-livre/';

async function call(action, data) {
  const response = await fetch(root + action, {
    method: data ? 'POST' : 'GET',
    headers: {Authorization: 'Bearer ' + await accessToken(), ...(data && {'Content-Type': 'application/json'})},
    body: data && JSON.stringify(data),
    cache: 'no-store'
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || 'A integração ainda não está disponível nesta publicação.');
  return result;
}

export async function openMercadoLivre(modal, esc) {
  const redirect = location.origin + root + 'callback';
  modal('Mercado Livre', `<div class="pad">
      <p>No DevCenter, crie o aplicativo, cadastre a URL abaixo como <strong>Redirect URI</strong> e habilite PKCE. Depois copie as duas credenciais para este painel.</p>
      <label>URL de retorno<input readonly value="${esc(redirect)}"></label>
      <p id="meli-status" role="status">Consultando conexão…</p>
      <form id="meli-connect" hidden autocomplete="off">
        <label>Client ID / App ID<input name="clientId" inputmode="numeric" maxlength="32" required></label>
        <label>Client Secret<input name="clientSecret" type="password" autocomplete="new-password" maxlength="200" required></label>
        <button type="submit" class="btn primary">Autorizar loja</button>
      </form>
      <button id="meli-reconnect" type="button" class="btn" hidden>Autorizar novamente</button>
      <div id="meli-overview"></div>
    </div>`);
  const dialog = document.querySelector('#modal');
  const status = dialog.querySelector('#meli-status');
  const form = dialog.querySelector('#meli-connect');
  const retry = dialog.querySelector('#meli-reconnect');
  const overview = dialog.querySelector('#meli-overview');

  async function connect(data, button) {
    button.disabled = true;
    try {
      const target = new URL((await call('connect', data)).url);
      if (target.origin !== 'https://auth.mercadolivre.com.br') throw new Error('Endereço de autorização inválido.');
      location.assign(target.href);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    event.stopPropagation();
    const data = Object.fromEntries(new FormData(form));
    form.elements.clientSecret.value = '';
    void connect(data, form.querySelector('button'));
  });
  retry.addEventListener('click', () => void connect({reuse: true}, retry));

  try {
    const {account} = await call('status');
    if (!account) {
      status.textContent = 'Cole o Client ID e o Client Secret do DevCenter. Ao clicar em Autorizar loja, você irá ao Mercado Livre para confirmar o acesso.';
      form.hidden = false;
      return;
    }
    status.textContent = 'Loja conectada: ' + account.name;
    retry.hidden = false;
    const report = await call('overview');
    const date = value => value ? new Date(value).toLocaleDateString('pt-BR') : '—';
    const currency = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(value) : '—';
    overview.innerHTML = `<h3>Visão da loja</h3>
      <p>Anúncios ativos: <strong>${esc(report.activeListings ?? 'Indisponível')}</strong></p>
      <p>Pedidos encontrados nos últimos 30 dias: <strong>${esc(report.orders30 ?? 'Indisponível')}</strong></p>
      <p>Nível de reputação: <strong>${esc(report.reputation ?? 'Indisponível')}</strong></p>
      ${report.failed.length ? `<p>Consultas indisponíveis: ${esc(report.failed.join(', '))}.</p>` : ''}
      ${report.lastOrders.length ? `<h3>Últimos pedidos</h3><ul>${report.lastOrders.map(order => `<li>#${esc(order.id)} · ${esc(date(order.date))} · ${esc(order.status)} · ${esc(order.currency === 'BRL' ? currency(order.amount) : order.currency ?? '—')}</li>`).join('')}</ul>` : ''}`;
  } catch (error) {
    status.textContent = error.message;
  }
}
