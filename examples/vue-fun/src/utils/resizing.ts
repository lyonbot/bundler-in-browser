import { clamp } from "lodash-es";
import { toValue, type MaybeRefOrGetter, type Ref } from "vue";
import { startMouseMove } from "yon-utils";

/**
 * create a resize handler for `pointerdown` event
 * 
 * the element shall have style `touch-action: none`
 */
export function createResizeHandler(configs: Array<{
  axis: 'x' | 'y'
  ref: Ref<number>,
  min: MaybeRefOrGetter<number>,
  max: MaybeRefOrGetter<number>,
  scale?: MaybeRefOrGetter<number>,
  reversed?: boolean
}>) {
  return (e: PointerEvent) => {
    const vals = configs.map(d => d.ref.value)

    e.preventDefault()
    startMouseMove({
      initialEvent: e,
      onMove: (e) => {
        for (let i = 0; i < configs.length; i++) {
          const cfg = configs[i]
          let d = cfg.axis === 'x' ? e.deltaX : e.deltaY
          if (cfg.reversed) d = -d
          d *= toValue(cfg.scale) ?? 1
          const val = clamp(vals[i] + d, toValue(cfg.min), toValue(cfg.max))
          configs[i].ref.value = val
        }
      }
    })
  }
}
