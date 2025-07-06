import { KEY_PROPS_DATA, VUE_INST_RENDERED_ROOT, type InspectorRuntimeApi } from "../constants"

/**
 * for runtime, try to get the `data-v-inspector` attribute from an element.
 * 
 * this will try to get the innermost (which is usually normal HTML tag, not a component)
 */
export function getInspectorDataFromElement(el: any, raw?: false): InspectorDataFromElement | null
export function getInspectorDataFromElement(el: any, raw: true): string | null
export function getInspectorDataFromElement(el: any, raw = false): any {
    const vnode = getInnermostVNode(el)
    const str = vnode?.props?.[KEY_PROPS_DATA]
    if (raw) return str
    return parseDataStr(str)
}

function getInnermostVNode(el: any) {
    let vnode = el?.__vnode

    // ensure vnode is in the most inner component
    // use the inject `ctx.renderedRootVNode` to get the root vnode
    while (vnode?.component) vnode = vnode.component[VUE_INST_RENDERED_ROOT]
    return vnode
}

// FIXME: don't know why needed?
//
// function getComponentData(el: any) {
//     return undefined
//     const ctxVNode = el?.__vnode?.ctx?.vnode
//     if (ctxVNode?.el === el)
//         return ctxVNode?.props?.[KEY_PROPS_DATA]
// }

/**
 * @see KEY_PROPS_DATA - its comment described the format
 */
function parseDataStr(str: any): InspectorDataFromElement | null {
    if (!str || typeof str !== 'string') return null

    const loc = str.match(/:(\d+):(\d+)(?:-(\d+):(\d+))?((?:,\w+)*)$/)
    if (!loc) return null

    const toInt = (s: string) => parseInt(s, 10)
    const [, sLine, sCol, eLine = sLine, eCol = sCol, flagsRaw] = loc
    const flags = flagsRaw ? flagsRaw.slice(1).split(',') : undefined
    return {
        start: { line: toInt(sLine), column: toInt(sCol) },
        end: { line: toInt(eLine), column: toInt(eCol) },
        source: str.slice(0, loc.index),
        isRoot: !!flags?.includes('isRoot'),
    }
}

export interface InspectorDataFromElement {
    start: { line: number, column: number },
    end: { line: number, column: number },
    source: string,
    /** is component's root nodes (direct child of <template>) */
    isRoot?: boolean,
}
/**
 * generate the format for communicating between editor
 * 
 * @param info - optional, if not set, will call `getInspectorDataFromElement(el)` to retrieve
 * @returns related nodes. outer node goes last, inner node goes first
 */
export function toPickResultNodes(el: HTMLElement | null | undefined, info = getInspectorDataFromElement(el)): InspectorRuntimeApi.PickResultNode[] {
    if (!el || !info) return []

    const { left, top, width, height } = el.getBoundingClientRect()
    const results: InspectorRuntimeApi.PickResultNode[] = []

    results.push({
        rect: { left, top, width, height },
        type: 'node',
        loc: {
            start: { line: info.start.line, column: info.start.column },
            end: { line: info.end.line, column: info.end.column },
            source: info.source,
        },
    })

    // if is component's root nodes (direct child of <template>)
    // complete with its outer vnode
    if (info.isRoot) {
        let vnode = getInnermostVNode(el).ctx?.vnode
        while (vnode) {
            const parentInfo = parseDataStr(vnode.props?.[KEY_PROPS_DATA])
            if (!parentInfo) break

            results.push({
                rect: { left, top, width, height },
                type: 'component',
                loc: {
                    start: { line: parentInfo.start.line, column: parentInfo.start.column },
                    end: { line: parentInfo.end.line, column: parentInfo.end.column },
                    source: parentInfo.source,
                },
            })

            if (!parentInfo.isRoot) break  // no more recursive
            // otherwise, continue to find out its parent
            vnode = vnode.ctx?.vnode
        }
    }

    return results
}