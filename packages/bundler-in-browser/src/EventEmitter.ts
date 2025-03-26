import { TypedEmitter, type DefaultListener, type ListenerSignature } from 'tiny-typed-emitter';

export class EventEmitter<L extends ListenerSignature<L> = DefaultListener> extends TypedEmitter<L> {
  /**
   * Like `on(event, cb)` but returns a function to unsubscribe from the event
   * 
   * @param event The event to subscribe to
   * @param listener The listener to call when the event is emitted
   * @returns A function to unsubscribe from the event
   */
  subscribe<U extends keyof L>(event: U, listener: L[U]): (() => void) {
    this.on(event, listener)
    return () => this.off(event, listener)
  }
}
