import DOMPurify from 'dompurify';
import * as css from 'css-tree';
const tags =
  'div section main article header footer h1 h2 h3 p span strong em small label input button select option ul ol li table thead tbody tr th td details summary br hr svg path circle rect line polyline polygon text g'.split(
    ' ',
  );
const attrs =
  'id class title role aria-label aria-pressed aria-hidden type value min max step checked disabled selected for viewBox d points cx cy r x y x1 x2 y1 y2 width height fill stroke stroke-width'.split(
    ' ',
  );
export function safeHTML(s) {
  const clean = DOMPurify.sanitize(s, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: attrs,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const t = document.createElement('template');
  t.innerHTML = clean;
  if (t.content.querySelectorAll('*').length > 600) throw Error('Zu viele Elemente');
  for (const e of t.content.querySelectorAll('*')) {
    for (const a of [...e.attributes]) {
      if (/url\s*\(|[<>\\]/i.test(a.value)) e.removeAttribute(a.name);
    }
    if (e.tagName === 'INPUT' && !['range', 'number', 'text', 'checkbox', 'radio'].includes(e.type))
      e.type = 'text';
  }
  return t.innerHTML;
}
export function safeCSS(s) {
  try {
    const a = css.parse(s);
    css.walk(a, {
      enter(n, item, list) {
        if (n.type === 'Atrule' || n.type === 'Raw') {
          if (list) list.remove(item);
          return css.walk.skip;
        }
        if (n.type === 'Declaration') {
          let bad = false;
          css.walk(n.value, (k) => {
            if (
              k.type === 'Url' ||
              k.type === 'Raw' ||
              (k.type === 'Function' &&
                ![
                  'rgb',
                  'rgba',
                  'hsl',
                  'hsla',
                  'calc',
                  'min',
                  'max',
                  'clamp',
                  'repeat',
                  'minmax',
                ].includes(k.name.toLowerCase()))
            )
              bad = true;
          });
          if (
            bad ||
            n.property.startsWith('--') ||
            [
              'position',
              'z-index',
              'behavior',
              'content',
              'cursor',
              'filter',
              'backdrop-filter',
            ].includes(n.property.toLowerCase())
          )
            list.remove(item);
        }
      },
    });
    return css.generate(a).replace(/</g, '');
  } catch {
    return '';
  }
}
