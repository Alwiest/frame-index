(() => {
  const status = document.querySelector('#status');
  const form = document.querySelector('#open-frame');
  const submit = form.querySelector('button');
  const keyPattern = /^#([a-f0-9]{64})$/i;

  async function openFrame(hex) {
    status.textContent = 'Загружаю историю…';
    form.hidden = true;
    submit.disabled = true;
    const assetUrls = new Map();

    try {
      if (!globalThis.crypto?.subtle) {
        status.textContent = 'Этот браузер не умеет открыть историю. Открой исходную ссылку в Safari.';
        return;
      }

      const rawKey = Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
      const response = await fetch('snapshot.bin?v=115060aa924a');
      if (!response.ok) throw new Error('Snapshot unavailable');

      const encrypted = new Uint8Array(await response.arrayBuffer());
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: encrypted.subarray(0, 12) },
        key,
        encrypted.subarray(12),
      );

      const manifestLength = new DataView(plain).getUint32(0);
      const bytes = new Uint8Array(plain, 4 + manifestLength);
      const decoder = new TextDecoder();
      const manifest = JSON.parse(decoder.decode(new Uint8Array(plain, 4, manifestLength)));
      const sources = new Map();

      for (const { path, offset, length, type } of manifest) {
        if (!path.startsWith('assets/')) continue;
        const contents = bytes.subarray(offset, offset + length);
        assetUrls.set(path, URL.createObjectURL(new Blob([contents], { type })));
      }

      for (const { path, offset, length } of manifest) {
        if (path.startsWith('assets/')) continue;
        const source = decoder.decode(bytes.subarray(offset, offset + length));
        sources.set(path, source.replace(/(?:\.\/)?assets\/[\w.-]+/g, (asset) => {
          return assetUrls.get(asset.replace(/^\.\//, '')) ?? asset;
        }));
      }

      // Mount the story directly. Only media assets need object URLs.
      const story = new DOMParser().parseFromString(sources.get('index.html'), 'text/html');
      const scripts = [...story.head.querySelectorAll('script[src]')].map((script) => {
        script.remove();
        return sources.get(script.getAttribute('src'));
      });

      for (const link of story.head.querySelectorAll('link[rel="stylesheet"]')) {
        const style = story.createElement('style');
        style.textContent = sources.get(link.getAttribute('href'));
        link.replaceWith(style);
      }

      document.documentElement.lang = story.documentElement.lang;
      document.head.replaceChildren(...story.head.childNodes);
      const referrer = document.createElement('meta');
      referrer.name = 'referrer';
      referrer.content = 'no-referrer';
      document.head.prepend(referrer);
      document.body.replaceChildren(...story.body.childNodes);

      for (const source of scripts) {
        const script = document.createElement('script');
        script.textContent = source;
        document.head.append(script);
      }
    } catch {
      for (const url of assetUrls.values()) URL.revokeObjectURL(url);
      status.textContent = 'История не загрузилась. Попробуй вставить исходную ссылку ещё раз или открыть её в Safari.';
      form.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let match;
    try {
      match = keyPattern.exec(new URL(form.elements.link.value.trim()).hash);
    } catch {
      // The form accepts a complete link.
    }

    if (match) {
      openFrame(match[1]);
    } else {
      status.textContent = 'Нужна полная ссылка. Скопируй её прямо из сообщения в Telegram.';
    }
  });

  const match = keyPattern.exec(location.hash);
  if (match) {
    openFrame(match[1]);
  } else {
    status.textContent = 'Скопируй ссылку прямо из сообщения в Telegram и вставь сюда.';
    form.hidden = false;
  }
})();
