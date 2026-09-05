(() => {
  const card = document.getElementById('installCard');
  const button = document.getElementById('installBtn');
  const text = document.getElementById('installText');
  let deferredPrompt = null;

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone && card) {
    card.hidden = false;
    button.hidden = true;
    text.textContent = 'Installed ✓ You are using the app version.';
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    if (card) card.hidden = false;
  });

  if (button) {
    button.addEventListener('click', async () => {
      if (!deferredPrompt) {
        if (card) card.hidden = false;
        text.textContent = 'Open your browser menu and choose “Install app” or “Add to Home screen”.';
        return;
      }
      button.disabled = true;
      button.textContent = 'Installing…';
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      button.disabled = false;
      button.textContent = 'Install app';
    });
  }

  window.addEventListener('appinstalled', () => {
    if (!card) return;
    card.hidden = false;
    button.hidden = true;
    text.textContent = 'Installed ✓ You can now open it from your home screen.';
  });
})();
