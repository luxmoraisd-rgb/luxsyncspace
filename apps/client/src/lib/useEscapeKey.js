import { useEffect, useRef } from "react";

const handlers = new Map();
let nextHandlerId = 0;
let listening = false;

function handleEscape(event) {
  if (event.key !== "Escape") return;
  let topmost;
  handlers.forEach((handler) => { topmost = handler; });
  if (!topmost) return;
  event.preventDefault();
  event.stopPropagation();
  topmost();
}

function registerEscapeHandler(id, handler) {
  handlers.delete(id);
  handlers.set(id, handler);
  if (!listening) {
    window.addEventListener("keydown", handleEscape);
    listening = true;
  }
}

function unregisterEscapeHandler(id) {
  handlers.delete(id);
  if (listening && handlers.size === 0) {
    window.removeEventListener("keydown", handleEscape);
    listening = false;
  }
}

export function useEscapeKey(handler, enabled = true) {
  const handlerRef = useRef(handler);
  const idRef = useRef(null);

  if (idRef.current === null) idRef.current = nextHandlerId++;
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const id = idRef.current;
    registerEscapeHandler(id, () => handlerRef.current());
    return () => unregisterEscapeHandler(id);
  }, [enabled]);
}
