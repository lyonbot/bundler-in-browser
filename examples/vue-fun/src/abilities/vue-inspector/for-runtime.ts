import { createWorkerDispatcher, createWorkerHandler, makePromise, type ImperativePromiseEx } from "yon-utils"
import { type InspectorRuntimeApi, type InspectorEditorApi } from "./constants"
import { createApp, h, reactive, shallowReadonly, shallowRef, watchPostEffect } from "vue"
import Overlay from "./runtime/Overlay.vue"
import { getInspectorDataFromElement, toPickResultNodes, toPickResultNodesWithAncestors, type InspectorDataFromElement } from "./runtime/utils"

// ----------------------------------------------
// these apis can be remote-invoked by editor

export const inspectorRuntimeApi: InspectorRuntimeApi = {
  selectElementByClick,
  selectElementBySelector,
  queryElementRect,
}

// ----------------------------------------------
// #region runtime

const state = reactive({
  isCapturing: false,
  hoveringElement: null as HTMLElement | null,
  hoveringInfo: null as InspectorDataFromElement | null,
  selectElementByClick,
  selectingPromise: shallowRef<undefined | ImperativePromiseEx<Awaited<ReturnType<InspectorRuntimeApi['selectElementByClick']>>>>(),
})
export const inspectorState = shallowReadonly(state)  // exposed for ../../preview-runtime/*

const appContainer = document.createElement('div')
document.body.appendChild(appContainer)
createApp({
  mounted() {
    watchPostEffect(() => {
      inspectorEditorApi.setHoveringNode(
        state.isCapturing
          ? toPickResultNodes(state.hoveringElement, state.hoveringInfo)[0]
          : null
      )
    })
  },
  render() {
    return [
      state.isCapturing && h(Overlay, { element: state.hoveringElement, info: state.hoveringInfo }),
    ]
  },
}).mount(appContainer)

async function selectElementBySelector(selector: string | HTMLElement) {
  const el = typeof selector === 'string' ? document.querySelector(selector) as HTMLElement : selector
  const nodes = toPickResultNodesWithAncestors(el)
  state.isCapturing = false
  state.hoveringElement = el
  state.hoveringInfo = nodes[0]?.loc

  state.selectingPromise?.resolve({ nodes })
  return { nodes }
}

async function selectElementByClick() {
  if (state.selectingPromise) return state.selectingPromise  // already selecting

  state.isCapturing = true
  state.hoveringElement = null
  state.hoveringInfo = null

  const promise = state.selectingPromise = makePromise()

  const handleMouseMove = (e: MouseEvent | PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    let element = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    let info: InspectorDataFromElement | null = null

    while (element) {
      info = getInspectorDataFromElement(element)
      if (info) break // found!

      element = element.parentElement;
    }

    if (element !== state.hoveringElement) {
      state.hoveringElement = element
      state.hoveringInfo = info
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

    const nodes = toPickResultNodesWithAncestors(state.hoveringElement)
    promise.resolve({
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
    state.selectingPromise = undefined // next time is fresh new picking
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

async function queryElementRect(selector: string) {
  const el = typeof selector === 'string' ? document.querySelector(selector) as HTMLElement : selector
  const rect = el?.getBoundingClientRect()
  if (!rect) return null

  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

// #endregion

// ----------------------------------------------
// #region communication

export const inspectorEditorApi = createWorkerDispatcher<InspectorEditorApi>(
  (payload, transferable) => inspectorEditorPort?.postMessage(payload, transferable)
)

let inspectorEditorPort: MessagePort | undefined  // write editor action & recv inspector action
export function setInspectorEditorApiPort(port: MessagePort | undefined) {
  inspectorEditorPort?.close() // close prev
  inspectorEditorPort = port
  if (inspectorEditorPort) {
    const handleRuntimeActions = createWorkerHandler(inspectorRuntimeApi);
    inspectorEditorPort.onmessage = e => handleRuntimeActions(e.data);
    inspectorEditorPort.start();
  }
}

// #endregion