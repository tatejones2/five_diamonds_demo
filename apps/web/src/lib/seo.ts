import { useEffect } from 'react';

const SITE = '5 Diamonds Tournament Baseball';

function setMeta(attr: 'name' | 'property', key: string, value: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (value === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

/** Per-page title, description, canonical and robots (spec §12 SEO; private areas noindex). */
export function useSeo({ title, description, noindex }: { title?: string; description?: string; noindex?: boolean }) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE}` : SITE;
    if (description) {
      setMeta('name', 'description', description);
      setMeta('property', 'og:description', description);
    }
    setMeta('property', 'og:title', title ?? SITE);
    setMeta('property', 'og:type', 'website');
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : null);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = `${window.location.origin}${window.location.pathname}`;
  }, [title, description, noindex]);
}
