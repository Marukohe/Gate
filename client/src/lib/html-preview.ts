import { messageUrl } from './message-url';

// Parse inside a template's inert document: original resource URLs never load in Gate's document.
// The result belongs only in an iframe with an empty sandbox, never in the app DOM.
export async function htmlPreview(text: string, endpoint: string, directory: string, signal: AbortSignal) {
  const inert = document.createElement('template').content.ownerDocument;
  const html = inert.createElement('html');
  html.innerHTML = text;
  html.querySelectorAll('script,iframe,object,embed,base,link,meta,template').forEach((node) => node.remove());
  const imageSources = new Set(['data:']);
  const fileEndpoint = new URL(endpoint, location.href);
  const images = new Map<string, Promise<string>>();
  const embedded: Promise<void>[] = [];
  for (const node of html.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'srcset', 'ping', 'autofocus'].includes(attribute.name)) node.removeAttribute(attribute.name);
    }
    if (node.tagName === 'IMG' || node.localName === 'image') {
      const attribute = node.tagName === 'IMG' ? 'src' : node.hasAttribute('href') ? 'href' : 'xlink:href';
      const url = messageUrl(node.getAttribute(attribute) ?? '', endpoint, directory);
      if (url && !url.startsWith('#')) {
        try {
          const absolute = new URL(url, location.href);
          if (['http:', 'https:', 'data:'].includes(absolute.protocol)) {
            if (absolute.origin === fileEndpoint.origin && absolute.pathname === fileEndpoint.pathname) {
              // An opaque iframe cannot use the browser's sign-in cookie. Read images in the parent first.
              if (!images.has(absolute.href) && images.size < 12) images.set(absolute.href, inlineImage(absolute.href, signal));
              embedded.push((images.get(absolute.href) ?? Promise.resolve('')).then((src) => {
                if (src) node.setAttribute(attribute, src); else node.removeAttribute(attribute);
              }));
            } else {
              node.setAttribute(attribute, absolute.href);
              if (absolute.protocol !== 'data:') imageSources.add(absolute.origin + absolute.pathname);
            }
          } else node.removeAttribute(attribute);
        } catch { node.removeAttribute(attribute); }
      } else node.removeAttribute(attribute);
    }
    // Keep in-document anchors; this is a static preview, not a nested browser.
    if (node.localName === 'a') {
      for (const attribute of ['href', 'xlink:href']) {
        if (!node.getAttribute(attribute)?.startsWith('#')) node.removeAttribute(attribute);
      }
      node.removeAttribute('target');
    }
  }
  const head = html.querySelector('head') ?? html.insertBefore(inert.createElement('head'), html.firstChild);
  const policy = inert.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = `default-src 'none'; img-src ${[...imageSources].join(' ')}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
  const viewport = inert.createElement('meta');
  viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
  head.prepend(policy, viewport);
  await Promise.all(embedded);
  return '<!doctype html>' + html.outerHTML;
}

async function inlineImage(url: string, signal: AbortSignal) {
  const maximum = 2 * 1024 * 1024;
  try {
    const response = await fetch(url, { signal, redirect: 'error' });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/.test(type) ||
        Number(response.headers.get('content-length')) > maximum) {
      await response.body?.cancel();
      return '';
    }
    const image = await response.blob();
    if (image.size > maximum) return '';
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(image);
    });
  } catch { return ''; }
}
