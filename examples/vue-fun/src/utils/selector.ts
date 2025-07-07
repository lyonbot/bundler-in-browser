/**
 * generate a unique selector for an HTMLElement
 */
export function elToSelector(el: HTMLElement): string {
  if (!(el instanceof HTMLElement)) {
    console.warn("Input is not an HTMLElement:", el);
    return ""; // Or throw an error, depending on desired behavior for invalid input
  }

  const selectorParts: string[] = [];
  let currentEl: HTMLElement | null = el;

  while (currentEl && currentEl.nodeType === Node.ELEMENT_NODE) {
    let part = currentEl.tagName.toLowerCase();

    // Check for a unique ID
    if (currentEl.id) {
      selectorParts.unshift(`#${currentEl.id}`);
      return selectorParts.join(' '); // If an ID is found, it's unique enough, so we can stop
    }

    // Check for unique class(es)
    // This part is optional but can make selectors more readable and sometimes shorter.
    // For strictly 'nth-child' as requested, you might omit this or make it conditional.
    // Here, we'll keep it for better general-purpose uniqueness if nth-child isn't needed.
    // if (currentEl.classList.length > 0) {
    //   // Find a class that might be unique within its siblings or parent's context
    //   const uniqueClass = Array.from(currentEl.classList).find(cls => {
    //     if (currentEl?.parentNode) {
    //       return currentEl.parentNode.querySelectorAll(`${currentEl.tagName.toLowerCase()}.${cls}`).length === 1;
    //     }
    //     return false; // If no parent, class isn't unique in this context
    //   });
    //   if (uniqueClass) {
    //     part += `.${uniqueClass}`;
    //     selectorParts.unshift(part);
    //     // We don't return immediately here because multiple elements can have the same class
    //     // but still need nth-child if they share the same class under the same parent.
    //     // We continue to build the selector in case a higher-level ancestor is needed for uniqueness.
    //     currentEl = currentEl.parentElement;
    //     continue; // Go to the next parent
    //   }
    // }

    // Calculate nth-child
    if (currentEl.parentNode) {
      let index = 1;
      let sibling = currentEl.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === currentEl.tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }
      part += `:nth-of-type(${index})`; // Use nth-of-type for more robust selection based on tag
      // If you strictly want nth-child (ignoring tag type), change to :nth-child(${index})
    }

    selectorParts.unshift(part);
    currentEl = currentEl.parentElement;
  }

  return selectorParts.join(' ');
}