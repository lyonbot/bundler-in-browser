import { elt, makePromise, type ImperativePromiseEx } from "yon-utils"
import { KEY_PROPS_DATA, ATTR_KEY, type InspectorRuntimeApi } from "./constants"
import { createApp, h, reactive, shallowReadonly } from "vue"
import Overlay from "./runtime/Overlay.vue"

/**
 * for runtime, try to get the `data-v-inspector` attribute from an element.
 */
export function getInspectorDataFromElement(el: any, raw?: false): ParsedInspectorData | null
export function getInspectorDataFromElement(el: any, raw: true): string | null
export function getInspectorDataFromElement(el: any, raw = false) {
  let str = el?.__vnode?.props?.[KEY_PROPS_DATA] ?? getComponentData(el) ?? el?.getAttribute?.(ATTR_KEY)
  if (!str) return null
  if (raw) return str

  const loc = str.match(/:(\d+):(\d+)(?:-(\d+):(\d+))?\s*$/)
  if (!loc) return null

  const toInt = (s: string) => parseInt(s, 10)
  const [, sLine, sCol, eLine = sLine, eCol = sCol] = loc
  return {
    start: { line: toInt(sLine), column: toInt(sCol) },
    end: { line: toInt(eLine), column: toInt(eCol) },
    source: str.slice(0, loc.index),
  }
}

export interface ParsedInspectorData {
  start: { line: number, column: number },
  end: { line: number, column: number },
  source: string,
}

function getComponentData(el: any) {
  const ctxVNode = el?.__vnode?.ctx?.vnode
  if (ctxVNode?.el === el)
    return ctxVNode?.props?.[KEY_PROPS_DATA]
}

// ----------------------------------------------
// #region runtime api

let selectingPromise: undefined | ImperativePromiseEx<Awaited<ReturnType<InspectorRuntimeApi['selectElementByClick']>>>
let state = reactive({
  isCapturing: false,
  hoveringElement: null as HTMLElement | null,
  hoveringInfo: null as ParsedInspectorData | null,
  selectElementByClick,
})
const appContainer = document.createElement('div')
document.body.appendChild(appContainer)
const app = createApp({
  render() {
    return [
      state.isCapturing && h(Overlay, { element: state.hoveringElement, info: state.hoveringInfo }),
    ]
  }
}).mount(appContainer)

async function selectElementByClick() {
  if (selectingPromise) return selectingPromise  // already selecting

  state.isCapturing = true
  state.hoveringElement = null
  state.hoveringInfo = null

  const promise = selectingPromise = makePromise()

  const handleMouseMove = (e: MouseEvent | PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let element = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    while (element) {
      const data = getInspectorDataFromElement(element)
      if (!data) { element = element.parentElement; continue; }

      state.hoveringElement = element
      state.hoveringInfo = data
      break
    }
    if (!element) {
      // not picking on element
      state.hoveringElement = null
      state.hoveringInfo = null
    }
  }

  const handleMouseDown = (e: MouseEvent) => {
    if (e.button) return; // not left click
    e.preventDefault();
    e.stopPropagation();
  }

  const handleMouseUp = (e: MouseEvent) => {
    if (e.button) return; // not left click
    e.preventDefault();
    e.stopPropagation();

    const nodes: InspectorRuntimeApi.PickResultNode[] = []

    let ptr = state.hoveringElement
    while (ptr) {
      const el = ptr
      ptr = ptr.parentElement

      const { left, top, width, height } = el.getBoundingClientRect()
      const info = getInspectorDataFromElement(el)
      if (!info) continue

      nodes.push({
        rect: { left, top, width, height },
        type: 'node',
        loc: {
          start: { line: info.start.line, column: info.start.column },
          end: { line: info.end.line, column: info.end.column },
          source: info.source,
        },
      })
    }

    promise.resolve({
      clientX: e.clientX,
      clientY: e.clientY,
      nodes
    })
  }

  window.addEventListener('mousemove', handleMouseMove, true)
  window.addEventListener('pointermove', handleMouseMove, true)

  window.addEventListener('mousedown', handleMouseDown, true)
  window.addEventListener('pointerdown', handleMouseDown, true)
  window.addEventListener('click', handleMouseDown, true)

  window.addEventListener('mouseup', handleMouseUp, true)
  window.addEventListener('pointerup', handleMouseUp, true)


  promise.then(() => {
    selectingPromise = undefined // next time is fresh new picking
    state.isCapturing = false
    setTimeout(() => {
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('pointermove', handleMouseMove, true)
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('pointerdown', handleMouseDown, true)
      window.removeEventListener('click', handleMouseDown, true)
      window.removeEventListener('pointerup', handleMouseUp, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
    }, 100)
  })

  return promise
}

export const inspectorState = shallowReadonly(state)

export const inspectorRuntimeApi: InspectorRuntimeApi = {
  selectElementByClick,
}

// #endregion