/*
  dom.js - Shared DOM construction helpers.
*/

export function createLink(href, text, className = 'db-link') {
  if (!href) return document.createTextNode(text || '');

  const link = document.createElement('a');
  if (className) link.className = className;
  link.href = href;
  link.textContent = text || href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}
