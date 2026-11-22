(async () => {
  const match = /^#([a-f0-9]{64})$/.exec(location.hash);
  if (!match) return;

  const status = document.querySelector('#status');
  status.textContent = 'Opening…';
  try {
    const hex = match[1];
    const rawKey = Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const response = await fetch('snapshot.bin');
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
    const urls = new Map();

    function register(path, type, contents) {
      const url = URL.createObjectURL(new Blob([contents], { type }));
      urls.set(path, url);
      return url;
    }

    function resolveAssets(source) {
      return source.replace(/(?:\.\/)?assets\/[\w.-]+/g, (path) => {
        return urls.get(path.replace(/^\.\//, '')) ?? path;
      });
    }

    for (const { path, offset, length, type } of manifest) {
      if (path.startsWith('assets/')) register(path, type, bytes.subarray(offset, offset + length));
    }

    let documentSource;
    for (const { path, offset, length, type } of manifest) {
      if (path.startsWith('assets/')) continue;
      const source = resolveAssets(decoder.decode(bytes.subarray(offset, offset + length)));
      if (path === 'index.html') documentSource = source;
      else register(path, type, source);
    }

    const page = documentSource.replace(/(src|href)="([\w.-]+\.(?:css|js))"/g, (attribute, name, path) => {
      return urls.has(path) ? `${name}="${urls.get(path)}"` : attribute;
    });
    const frame = document.createElement('iframe');
    frame.title = 'Frame';
    frame.setAttribute('allow', 'autoplay');
    frame.src = register('index.html', 'text/html;charset=utf-8', page);
    document.body.replaceChildren(frame);
  } catch {
    status.textContent = 'Frame unavailable. Check your link.';
  }
})();
