/**
 * In-app back navigation stack.
 *
 * Views register a handler while they are in an internal "drilled-in" state
 * (e.g. a section opened via See All). The Android back gesture/button runs
 * the top-most handler first; if it claims the event (returns true) the app
 * stays exactly where the user is. Only when no handler claims it does the
 * fall-through run (tab → home → exit).
 */

import { useEffect } from 'react';

const stack = [];

export function useBackHandler(active, handler) {
  useEffect(() => {
    if (!active) return undefined;
    const entry = { handler };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active, handler]);
}

/** Run the top-most handler. Returns true when the back was consumed. */
export function consumeBack() {
  while (stack.length) {
    const entry = stack[stack.length - 1];
    let handled = false;
    try {
      handled = entry.handler() === true;
    } catch (e) {}
    if (handled) return true;
    stack.pop();
  }
  return false;
}
