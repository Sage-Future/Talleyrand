import { FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * The app's tooltips. Any element carrying `data-tooltip="…"` gets one; this
 * layer is mounted once at the root and watches the pointer for all of them.
 *
 * Native `title` tooltips were replaced by this because the browser owns their
 * delay (about a second) and nothing in CSS or JS can shorten it.
 *
 * Hit-testing on pointer move — rather than listening for hover on each
 * trigger — keeps one listener for the whole app and, more importantly, still
 * works on disabled buttons, which suppress the hover events a per-trigger
 * listener would need yet often carry the tooltip explaining why they are off.
 */

/** Wait before the first tooltip of a run appears. */
const SHOW_DELAY_MS = 200;
/**
 * Once a tooltip has been shown, its neighbours appear with no delay at all
 * for this long. This is what makes a toolbar feel responsive: you pay the
 * delay once, then the row reads instantly as you sweep across it.
 */
const WARM_WINDOW_MS = 1000;
/** Gap between the trigger and the tooltip. */
const OFFSET_PX = 8;
/** Keeps the tooltip clear of the viewport edges. */
const EDGE_MARGIN_PX = 8;

const SELECTOR = '[data-tooltip]';
const TOOLTIP_ID = 'app-tooltip';

interface Active {
  el: HTMLElement;
  text: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

export const TooltipLayer: FC = () => {
  const [active, setActive] = useState<Active | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // Mutable bookkeeping the document listeners read without re-subscribing.
  const activeRef = useRef<Active | null>(null);
  const pendingRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hiddenAtRef = useRef(0);
  // The trigger the pointer pressed on: stays quiet until the pointer moves off
  // it, so a tooltip does not pop back up over the thing you just clicked.
  const pressedRef = useRef<HTMLElement | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const cancelPending = () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      pendingRef.current = null;
    };

    const hide = () => {
      cancelPending();
      if (!activeRef.current) return;
      activeRef.current = null;
      hiddenAtRef.current = Date.now();
      setActive(null);
    };

    const show = (el: HTMLElement, text: string) => {
      activeRef.current = { el, text };
      setActive({ el, text });
    };

    const target = (el: HTMLElement | null) => {
      if (pressedRef.current) {
        if (el === pressedRef.current) return;
        pressedRef.current = null;
      }
      // Guarded on `el`: leaving a trigger for empty space gives null, which
      // must fall through to the hide below rather than match a null pending.
      if (el && (el === activeRef.current?.el || el === pendingRef.current)) return;

      cancelPending();
      const text = el?.getAttribute('data-tooltip');
      if (!el || !text) {
        hide();
        return;
      }

      // Instant while a tooltip is up or just came down, delayed otherwise.
      if (activeRef.current || Date.now() - hiddenAtRef.current < WARM_WINDOW_MS) {
        hide();
        show(el, text);
        return;
      }
      pendingRef.current = el;
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        pendingRef.current = null;
        if (el.isConnected) show(el, text);
      }, SHOW_DELAY_MS);
    };

    const readPoint = () => {
      frameRef.current = null;
      const point = pointRef.current;
      if (!point) return;
      const hit = document.elementFromPoint(point.x, point.y);
      target(hit ? (hit.closest(SELECTOR) as HTMLElement | null) : null);
    };

    const onPointerMove = (e: PointerEvent) => {
      pointRef.current = { x: e.clientX, y: e.clientY };
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(readPoint);
    };

    const onPointerDown = () => {
      pressedRef.current = activeRef.current?.el ?? pendingRef.current;
      hide();
    };

    // Keyboard users get the same tooltip when they tab onto a trigger.
    const onFocusIn = (e: FocusEvent) => {
      const node = e.target as HTMLElement | null;
      if (!node?.matches?.(':focus-visible')) return;
      const el = node.closest(SELECTOR) as HTMLElement | null;
      const text = el?.getAttribute('data-tooltip');
      if (!el || !text) return;
      cancelPending();
      hide();
      show(el, text);
    };

    const onFocusOut = (e: FocusEvent) => {
      const el = activeRef.current?.el;
      if (el && e.target instanceof Node && el.contains(e.target)) hide();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerleave', hide);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    // Capture: the position is measured against the viewport, so any scroll
    // container moving underneath the tooltip invalidates it.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      cancelPending();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerleave', hide);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  // Placement runs before paint, so moving between neighbouring triggers
  // repositions the box in the same frame the text changes.
  useLayoutEffect(() => {
    if (!active || !tipRef.current) {
      setPosition(null);
      return;
    }
    const trigger = active.el.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const above = trigger.top - tip.height - OFFSET_PX;
    setPosition({
      left: clamp(
        trigger.left + trigger.width / 2 - tip.width / 2,
        EDGE_MARGIN_PX,
        window.innerWidth - tip.width - EDGE_MARGIN_PX
      ),
      // Clamped like the horizontal axis: a trigger as tall as the viewport
      // (the panel's resize handle) has no room either above or below it.
      top: clamp(
        above >= EDGE_MARGIN_PX ? above : trigger.bottom + OFFSET_PX,
        EDGE_MARGIN_PX,
        window.innerHeight - tip.height - EDGE_MARGIN_PX
      ),
    });
  }, [active]);

  // Screen readers announce the tooltip as the trigger's description.
  useEffect(() => {
    const el = active?.el;
    if (!el) return;
    el.setAttribute('aria-describedby', TOOLTIP_ID);
    return () => el.removeAttribute('aria-describedby');
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      ref={tipRef}
      id={TOOLTIP_ID}
      role="tooltip"
      className="tooltip-enter pointer-events-none fixed z-[10001] max-w-xs rounded-md bg-stone-800 px-2 py-1 font-sans text-[11px] leading-snug text-stone-50 shadow-lg"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {active.text}
    </div>,
    document.body
  );
};

/**
 * Props for a control whose only content is an icon: the same text becomes the
 * tooltip and the control's accessible name, so screen readers still have
 * something to announce now that `title` is gone.
 */
export const iconTooltip = (text: string) => ({ 'data-tooltip': text, 'aria-label': text });
