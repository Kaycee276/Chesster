import { create } from 'zustand';

export type ToastType = 'error' | 'success' | 'info' | 'loading' | 'invitation';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  /** Optional action label + callback (used by invitation toasts). */
  action?: { label: string; onClick: () => void };
  /**
   * Auto-dismiss duration in ms, or null when the toast stays until removed
   * (loading toasts). The countdown starts when the toast becomes visible,
   * which is handled by the Toast component (#585).
   */
  duration: number | null;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, action?: Toast['action']) => number;
  removeToast: (id: number) => void;
}

/** Auto-dismiss durations: 5 seconds, or 3 seconds for invitations. */
export function getToastDuration(type: ToastType): number | null {
  if (type === 'loading') return null;
  return type === 'invitation' ? 3000 : 5000;
}

let lastId = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'error', action) => {
    // Date.now() alone collides for toasts added in the same millisecond.
    const id = (lastId = Math.max(Date.now(), lastId + 1));
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, action, duration: getToastDuration(type) }],
    }));
    return id;
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}));
