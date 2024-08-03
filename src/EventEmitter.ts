// see https://github.com/developit/mitt/issues/191
import _mitt from 'mitt';
export const EventEmitter = _mitt as unknown as typeof _mitt.default;
