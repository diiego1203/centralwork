import {login, logout, setPassword} from './cloud.js';

const allowed = /^(tiago|jarbes|viviane)$/;
const root = document.querySelector('#app');
let installEvent;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
});

function offerPasswordSave(username, password) {
  if (!window.PasswordCredential || typeof navigator.credentials?.store !== 'function') return;
  try {
    const credential = new window.PasswordCredential({id: username, password});
    navigator.credentials.store(credential).catch(() => {});
  } catch {
    // Browsers without this API can recognize the form's autocomplete fields.
  }
}

export function showAccess(onReady) {
  let temporaryPassword = '';
  let step = 'username';
  let busy = false;

  root.innerHTML = `<main class="cw-access"><section class="panel cw-access-card">
    <img src="./icon.svg" width="54" height="54" alt="">
    <h1>CentralWork</h1>
    <h2 id="cw-access-title">Acesso da equipe</h2>
    <form id="cw-access-form" method="post" aria-labelledby="cw-access-title">
      <label>Usuário<input id="cw-username" name="username" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <fieldset id="cw-password-step" hidden disabled>
        <label for="cw-password" id="cw-password-label">Senha ou senha temporária</label>
        <div class="cw-password-row">
          <input id="cw-password" name="password" type="password" required autocomplete="current-password">
          <button class="btn" type="button" data-reveal="cw-password" aria-controls="cw-password">Mostrar</button>
        </div>
      </fieldset>
      <fieldset id="cw-confirm-step" hidden disabled>
        <label for="cw-confirm">Confirme a senha</label>
        <div class="cw-password-row">
          <input id="cw-confirm" name="confirm" type="password" required autocomplete="new-password" minlength="12">
          <button class="btn" type="button" data-reveal="cw-confirm" aria-controls="cw-confirm">Mostrar</button>
        </div>
      </fieldset>
      <p role="alert" class="error"></p>
      <button class="btn primary" type="submit">Continuar</button>
      <button class="btn" type="button" id="cw-back" hidden>Voltar</button>
    </form>
    <button class="btn" type="button" id="cw-install">Instalar aplicativo</button>
    <p id="cw-install-help" hidden>No iPhone, abra no Safari e toque em Compartilhar → Adicionar à Tela de Início. No Android, abra no Chrome e use o menu → Instalar aplicativo.</p>
  </section></main>`;

  const form = root.querySelector('#cw-access-form');
  const usernameInput = form.elements.username;
  const passwordInput = form.elements.password;
  const confirmation = form.elements.confirm;
  const passwordStep = form.querySelector('#cw-password-step');
  const confirmStep = form.querySelector('#cw-confirm-step');
  const passwordLabel = form.querySelector('#cw-password-label');
  const title = root.querySelector('#cw-access-title');
  const alert = form.querySelector('[role="alert"]');
  const submit = form.querySelector('[type="submit"]');
  const back = form.querySelector('#cw-back');
  const reveals = [...form.querySelectorAll('[data-reveal]')];

  function setVisibility(button, visible) {
    const input = button.dataset.reveal === passwordInput.id ? passwordInput : confirmation;
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Ocultar' : 'Mostrar';
    const field = input === confirmation ? 'confirmação da senha' : 'senha';
    button.setAttribute('aria-label', `${button.textContent} ${field}`);
  }

  for (const button of reveals) {
    setVisibility(button, false);
    button.onclick = () => {
      const input = button.dataset.reveal === passwordInput.id ? passwordInput : confirmation;
      setVisibility(button, input.type === 'password');
    };
  }

  function changeStep(next) {
    step = next;
    const first = next === 'username';
    const setup = next === 'setup';
    title.textContent = first ? 'Acesso da equipe' : setup ? 'Crie sua senha' : 'Digite sua senha';
    usernameInput.readOnly = setup;
    passwordStep.hidden = passwordStep.disabled = first;
    confirmStep.hidden = confirmStep.disabled = !setup;
    passwordLabel.textContent = setup ? 'Nova senha' : 'Senha ou senha temporária';
    passwordInput.autocomplete = setup ? 'new-password' : 'current-password';
    if (setup) passwordInput.minLength = 12;
    else passwordInput.removeAttribute('minlength');
    if (first || setup) passwordInput.value = '';
    confirmation.value = '';
    for (const button of reveals) setVisibility(button, false);
    submit.textContent = first ? 'Continuar' : setup ? 'Ativar acesso' : 'Entrar';
    back.hidden = first;
    alert.textContent = '';
    (first ? usernameInput : passwordInput).focus();
  }

  root.querySelector('#cw-install').onclick = async () => {
    if (installEvent) {
      await installEvent.prompt();
      installEvent = null;
    } else root.querySelector('#cw-install-help').hidden = false;
  };
  back.onclick = async () => {
    if (busy) return;
    busy = true;
    submit.disabled = back.disabled = true;
    try {
      await logout();
      temporaryPassword = '';
      changeStep('username');
    } finally {
      busy = false;
      submit.disabled = back.disabled = false;
    }
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const username = usernameInput.value.trim().toLowerCase();
    if (!allowed.test(username)) {
      alert.textContent = 'Usuário não autorizado.';
      usernameInput.focus();
      return;
    }
    usernameInput.value = username;
    if (step === 'username') {
      changeStep('password');
      return;
    }
    const password = passwordInput.value;
    const setup = step === 'setup';
    for (const button of reveals) setVisibility(button, false);
    busy = true;
    submit.disabled = back.disabled = true;
    alert.textContent = '';
    try {
      if (setup) {
        if (password.length < 12 || password === temporaryPassword || password !== confirmation.value) {
          throw new Error('Use uma senha nova com pelo menos 12 caracteres e confirme o mesmo valor.');
        }
        await setPassword(password);
        temporaryPassword = '';
      } else {
        const admin = await login(username, password);
        if (admin.password_setup_required) {
          temporaryPassword = password;
          changeStep('setup');
          return;
        }
      }
      try {
        await onReady(username);
      } catch (error) {
        if (setup) {
          changeStep('password');
          throw new Error('Senha definida. Entre com a nova senha para abrir o painel.');
        }
        throw error;
      }
      offerPasswordSave(username, password);
    } catch (error) {
      alert.textContent = error.message;
    } finally {
      busy = false;
      submit.disabled = back.disabled = false;
    }
  });
  changeStep('username');
}
