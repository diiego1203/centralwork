import {login, logout, setPassword} from './cloud.js';

const allowed = /^(tiago|jarbes|viviane)$/;
const root = document.querySelector('#app');
let installEvent;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
});

export function showAccess(onReady) {
  let username = '';
  let temporaryPassword = '';
  let step = 'username';
  let busy = false;

  function draw() {
    const first = step === 'username';
    const setup = step === 'setup';
    root.innerHTML = `<main class="cw-access"><section class="panel cw-access-card">
      <img src="./icon.svg" width="54" height="54" alt="">
      <h1>CentralWork</h1>
      <h2>${first ? 'Acesso da equipe' : setup ? 'Crie sua senha' : 'Digite sua senha'}</h2>
      <form id="cw-access-form">
        ${first
          ? '<label>Usuário<input name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>'
          : `<input name="username" value="${username}" autocomplete="username" hidden><p>${username}</p><label>${setup ? 'Nova senha' : 'Senha ou senha temporária'}<input name="password" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" ${setup ? 'minlength="12"' : ''}></label>`}
        ${setup ? '<label>Confirme a senha<input name="confirm" type="password" required autocomplete="new-password" minlength="12"></label>' : ''}
        <p role="alert" class="error"></p>
        <button class="btn primary" type="submit">${first ? 'Continuar' : setup ? 'Ativar acesso' : 'Entrar'}</button>
        ${first ? '' : '<button class="btn" type="button" id="cw-back">Voltar</button>'}
      </form>
      <button class="btn" type="button" id="cw-install">Instalar aplicativo</button>
      <p id="cw-install-help" hidden>No iPhone, abra no Safari e toque em Compartilhar → Adicionar à Tela de Início. No Android, abra no Chrome e use o menu → Instalar aplicativo.</p>
    </section></main>`;
    const form = document.querySelector('#cw-access-form');
    const alert = form.querySelector('[role="alert"]');
    document.querySelector('#cw-install').onclick = async () => {
      if (installEvent) {
        await installEvent.prompt();
        installEvent = null;
      } else document.querySelector('#cw-install-help').hidden = false;
    };
    const back = document.querySelector('#cw-back');
    if (back) back.onclick = async () => {
      if (busy) return;
      await logout();
      temporaryPassword = '';
      step = 'username';
      draw();
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      const fields = new FormData(form);
      busy = true;
      form.querySelector('button[type="submit"]').disabled = true;
      alert.textContent = '';
      try {
        if (first) {
          username = String(fields.get('username')).trim().toLowerCase();
          if (!allowed.test(username)) throw new Error('Usuário não autorizado.');
          step = 'password';
          draw();
          return;
        }
        const password = String(fields.get('password'));
        if (setup) {
          if (password.length < 12 || password === temporaryPassword || password !== fields.get('confirm')) {
            throw new Error('Use uma senha nova com pelo menos 12 caracteres e confirme o mesmo valor.');
          }
          await setPassword(password);
          temporaryPassword = '';
        } else {
          const admin = await login(username, password);
          if (admin.password_setup_required) {
            temporaryPassword = password;
            step = 'setup';
            draw();
            return;
          }
        }
        await onReady(username);
      } catch (error) {
        alert.textContent = error.message;
      } finally {
        busy = false;
        form.querySelector('button[type="submit"]').disabled = false;
      }
    });
    form.querySelector(first ? '[name="username"]' : '[name="password"]').focus();
  }

  draw();
}
