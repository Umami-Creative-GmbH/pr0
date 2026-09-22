import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

let visible = false;
let revision = 0;
const subscribers = new Set<() => void>();
const visibilitySubscribers = new Set<() => void>();

export const surfaceVisible = () => visible;
export const subscribeSurfaceVisibility = (onChange: () => void) => {
  visibilitySubscribers.add(onChange);
  return () => {
    visibilitySubscribers.delete(onChange);
  };
};

const refresh = async () => {
  revision += 1;
  const current = revision;
  try {
    const next = z.boolean().parse(await invoke("surface_visible"));
    if (current !== revision) {
      return;
    }
    const changed = next !== visible;
    visible = next;
    document.documentElement.dataset.surfaceHidden = String(!next);
    if (changed) {
      for (const subscriber of visibilitySubscribers) {
        subscriber();
      }
    }
    if (changed && next) {
      for (const subscriber of subscribers) {
        subscriber();
      }
    }
  } catch {
    // Explicit focus retries the authoritative native visibility query.
  }
};

// These subscriptions last as long as this WebView. Never infer Windows window
// visibility from document.hidden: WebView2 can report visible while hidden.
const connect = async () => {
  try {
    await listen("surface-visibility", () => {
      void refresh();
    });
    await listen("launcher-changed", () => {
      void refresh();
    });
  } catch {
    // Window focus remains an explicit recovery path.
  }
  await refresh();
};
document.documentElement.dataset.surfaceHidden = "true";
void connect();
window.addEventListener("focus", () => {
  void refresh();
});

export const listenWhenVisible = async (
  event: string,
  onInvalidated: () => void
) => {
  const onChange = () => {
    if (visible) {
      onInvalidated();
    }
  };
  subscribers.add(onChange);
  try {
    const stop = await listen(event, onChange);
    return () => {
      subscribers.delete(onChange);
      stop();
    };
  } catch (error) {
    subscribers.delete(onChange);
    throw error;
  }
};
