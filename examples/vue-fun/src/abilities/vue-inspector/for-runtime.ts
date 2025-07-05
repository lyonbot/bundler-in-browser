import { KEY_PROPS_DATA, ATTR_KEY } from "./constants"

/**
 * for runtime, try to get the `data-v-inspector` attribute from an element.
 */
export function getInspectorDataFromElement(el: any) {
  return el?.__vnode?.props?.[KEY_PROPS_DATA] ?? getComponentData(el) ?? el?.getAttribute?.(ATTR_KEY)
}

function getComponentData(el: any) {
  const ctxVNode = el?.__vnode?.ctx?.vnode
  if (ctxVNode?.el === el)
    return ctxVNode?.props?.[KEY_PROPS_DATA]
}
