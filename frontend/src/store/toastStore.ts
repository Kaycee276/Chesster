import { create } from 'zustand';

export type ToastType = 'error' | 'success' | 'info' | 'loading' | 'invitation';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  /** Optional action label + callback (used by invitation toasts). */
  action?: { label: string; onClick: () => void };
}

interface ToastStore {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, action?: Toast['action']) => number;
  removeToast: (id: number) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'error', action) => {
    const id = Date.now();
    set((state) => ({ toasts: [...state.toasts, { id, message, type, action }] }));
    if (type !== 'loading' && type !== 'invitation') {
      setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
      }, 3000);
    }
    return id;
  },

  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}));
