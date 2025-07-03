const insertedElements = new Set<Element>();

export function insertStyle(css: string) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  insertedElements.add(style);
  return style;
}

export function insertElement(el: Element) {
  document.body.appendChild(el);
  insertedElements.add(el);
}

export function resetInsertedElements() {
  insertedElements.forEach(el => el.remove());
  insertedElements.clear();
}
