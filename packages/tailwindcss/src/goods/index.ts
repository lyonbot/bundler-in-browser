// @ts-nocheck

import plugin from 'tailwindcss/plugin';
import defaultConfig from 'tailwindcss/defaultConfig';
import defaultTheme from 'tailwindcss/defaultTheme';
import colors from 'tailwindcss/colors';
import preflight from 'tailwindcss/src/css/preflight.css?raw';

/** 
 * the tailwindcss preflight css (aka, css reset)
 * 
 * if you set `preflight: false` in `tailwindConfig`, you may need to use this.
 */
const preflightStr = preflight as string
export { preflightStr as preflight }

export { plugin, defaultConfig, defaultTheme, colors };
