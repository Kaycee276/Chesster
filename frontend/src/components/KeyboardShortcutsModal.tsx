import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface KeyBinding {
  id: string;
  label: string;
  key: string;
  defaultKey: string;
}

const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  { id: 'flip_board', label: 'Flip Board', key: 'F', defaultKey: 'F' },
  { id: 'draw_offer', label: 'Offer Draw', key: 'D', defaultKey: 'D' },
  { id: 'resign', label: 'Resign', key: 'R', defaultKey: 'R' },
  { id: 'claim_draw', label: 'Claim Draw', key: 'C', defaultKey: 'C' },
  { id: 'move_history_prev', label: 'Previous Move', key: 'ArrowLeft', defaultKey: 'ArrowLeft' },
  { id: 'move_history_next', label: 'Next Move', key: 'ArrowRight', defaultKey: 'ArrowRight' },
  { id: 'toggle_coords', label: 'Toggle Coordinates', key: 'X', defaultKey: 'X' },
  { id: 'toggle_moves', label: 'Toggle Move List', key: 'M', defaultKey: 'M' },
];

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const [bindings, setBindings] = useState<KeyBinding[]>(DEFAULT_KEYBINDINGS);
  const [listeningActionId, setListeningActionId] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    const stored = localStorage.getItem('chesster:user_keybindings');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setBindings(DEFAULT_KEYBINDINGS.map((def) => ({
          ...def,
          key: parsed[def.id] || def.defaultKey,
        })));
      } catch {
        setBindings(DEFAULT_KEYBINDINGS);
      }
    }
  }, [isOpen]);

  const isKeyConflict = useCallback(
    (newKey: string, excludeActionId: string): boolean => {
      return bindings.some(
        (b) => b.id !== excludeActionId && b.key.toUpperCase() === newKey.toUpperCase()
      );
    },
    [bindings]
  );

  const handleRecordKey = useCallback(
    (actionId: string, event: React.KeyboardEvent<HTMLButtonElement>) => {
      event.preventDefault();
      let newKey = event.key;

      if (event.ctrlKey) newKey = `Ctrl+${newKey}`;
      if (event.altKey) newKey = `Alt+${newKey}`;
      if (event.shiftKey) newKey = `Shift+${newKey}`;

      if (isKeyConflict(newKey, actionId)) {
        setConflictError(
          t('shortcuts.conflict', `Key ${newKey} is already assigned!`)
        );
        setTimeout(() => setConflictError(null), 3000);
        return;
      }

      const updated = bindings.map((b) =>
        b.id === actionId ? { ...b, key: newKey } : b
      );
      setBindings(updated);
      setListeningActionId(null);

      const keybindingMap = updated.reduce(
        (acc, b) => ({
          ...acc,
          [b.id]: b.key,
        }),
        {} as Record<string, string>
      );
      localStorage.setItem('chesster:user_keybindings', JSON.stringify(keybindingMap));
    },
    [bindings, isKeyConflict, t]
  );

  const resetToDefaults = useCallback(() => {
    setBindings(DEFAULT_KEYBINDINGS);
    localStorage.removeItem('chesster:user_keybindings');
    setListeningActionId(null);
    setConflictError(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="mb-6 text-2xl font-bold text-white">
          {t('shortcuts.title', 'Keyboard Shortcuts')}
        </h2>

        {conflictError && (
          <div className="mb-4 rounded bg-red-900/30 p-3 text-red-300 border border-red-700">
            {conflictError}
          </div>
        )}

        <div className="mb-6 max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-2 px-3 text-slate-300 font-semibold">
                  {t('shortcuts.action', 'Action')}
                </th>
                <th className="text-left py-2 px-3 text-slate-300 font-semibold">
                  {t('shortcuts.key', 'Key Binding')}
                </th>
                <th className="text-right py-2 px-3 text-slate-300 font-semibold w-20">
                  {t('shortcuts.edit', 'Edit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {bindings.map((binding) => (
                <tr key={binding.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                  <td className="py-3 px-3 text-slate-200">{binding.label}</td>
                  <td className="py-3 px-3">
                    <code className="rounded bg-slate-800 px-2 py-1 font-mono text-slate-300">
                      {listeningActionId === binding.id
                        ? t('shortcuts.listening', 'Press a key...')
                        : binding.key}
                    </code>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onKeyDown={(e) => handleRecordKey(binding.id, e)}
                      onClick={() =>
                        setListeningActionId(
                          listeningActionId === binding.id ? null : binding.id
                        )
                      }
                      className={`px-3 py-1 rounded text-xs font-semibold transition ${
                        listeningActionId === binding.id
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                      autoFocus={listeningActionId === binding.id}
                    >
                      {listeningActionId === binding.id
                        ? t('shortcuts.recording', 'Recording...')
                        : t('shortcuts.rebind', 'Rebind')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 justify-end border-t border-slate-700 pt-4">
          <button
            onClick={resetToDefaults}
            className="rounded px-4 py-2 bg-slate-700 text-slate-200 font-semibold hover:bg-slate-600 transition"
          >
            {t('shortcuts.reset', 'Reset to Defaults')}
          </button>
          <button
            onClick={onClose}
            className="rounded px-4 py-2 bg-blue-600 text-white font-semibold hover:bg-blue-700 transition"
          >
            {t('shortcuts.done', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsModal;
