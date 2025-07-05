import { ATTR_KEY, KEY_PROPS_DATA, type InspectorRuntimeApi } from "../constants"

/**
 * for runtime, try to get the `data-v-inspector` attribute from an element.
 */
export function getInspectorDataFromElement(el: any, raw?: false): InspectorDataFromElement | null
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

export interface InspectorDataFromElement {
    start: { line: number, column: number },
    end: { line: number, column: number },
    source: string,
}

function getComponentData(el: any) {
    const ctxVNode = el?.__vnode?.ctx?.vnode
    if (ctxVNode?.el === el)
        return ctxVNode?.props?.[KEY_PROPS_DATA]
}

/**
 * generate the format for communicating between editor
 * 
 * @param info - optional, if not set, will call `getInspectorDataFromElement(el)` to retrieve
 */
export function toPickResultNode(el: HTMLElement | null | undefined, info = getInspectorDataFromElement(el)): InspectorRuntimeApi.PickResultNode | null {
    if (!el || !info) return null
    const { left, top, width, height } = el.getBoundingClientRect()

    return {
        rect: { left, top, width, height },
        type: 'node',
        loc: {
            start: { line: info.start.line, column: info.start.column },
            end: { line: info.end.line, column: info.end.column },
            source: info.source,
        },
    }
}