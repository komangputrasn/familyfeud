// Live connection to the game server, shared by the board, admin and presenter pages.
// Reconnects on its own; the server sends a full state snapshot on every connect.

export function connect({ role, getPin = () => '', onState, onStatus, onAuthFail, onError }) {
  let ws = null;
  let attempts = 0;
  let authFailed = false;
  let timer = null;

  function open() {
    clearTimeout(timer);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws?role=${role}&pin=${encodeURIComponent(getPin())}`);
    ws = socket;

    socket.onopen = () => {
      attempts = 0;
      onStatus?.(true);
    };

    socket.onmessage = (e) => {
      let message;
      try {
        message = JSON.parse(e.data);
      } catch {
        return;
      }
      if (message.type === 'state') onState?.(message);
      else if (message.type === 'error') onError?.(message.message);
      else if (message.type === 'auth' && !message.ok) {
        authFailed = true;
        onAuthFail?.();
      }
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      onStatus?.(false);
      if (authFailed) return;
      timer = setTimeout(open, Math.min(4000, 400 * 2 ** attempts++));
    };
  }

  open();

  return {
    send(action, payload = {}) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action, payload }));
      else onError?.('Not connected to the game server.');
    },
    retry() {
      authFailed = false;
      attempts = 0;
      open();
    },
  };
}

// PIN prompt for the admin and presenter pages. Expects the #pin-gate markup in the page.
export function pinGate() {
  const gate = document.querySelector('#pin-gate');
  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const note = gate.querySelector('.pin-note');
  let onSubmit = () => {};

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    localStorage.setItem('game-pin', input.value.trim());
    gate.hidden = true;
    onSubmit();
  });

  return {
    get: () => localStorage.getItem('game-pin') || '',
    ask(callback) {
      onSubmit = callback;
      note.hidden = !localStorage.getItem('game-pin');
      gate.hidden = false;
      input.value = '';
      input.focus();
    },
  };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
