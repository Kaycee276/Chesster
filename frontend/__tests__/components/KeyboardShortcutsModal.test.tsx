import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { KeyboardShortcutsModal } from '../../src/components/KeyboardShortcutsModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue || key,
  }),
}));

describe('KeyboardShortcutsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders when isOpen is true', () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<KeyboardShortcutsModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays default keybindings', () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Flip Board')).toBeInTheDocument();
    expect(screen.getByText('Offer Draw')).toBeInTheDocument();
    expect(screen.getByText('Resign')).toBeInTheDocument();
  });

  it('allows rebinding a key', async () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

    const flipBoardRow = screen.getByText('Flip Board').closest('tr');
    const rebindButton = flipBoardRow?.querySelector('button[class*="px-3"]');

    fireEvent.click(rebindButton!);
    expect(rebindButton).toHaveTextContent('Recording...');

    const keyCodeInput = rebindButton as HTMLButtonElement;
    fireEvent.keyDown(keyCodeInput, { key: 'G', code: 'KeyG' });

    await waitFor(() => {
      expect(screen.getByText('G')).toBeInTheDocument();
    });

    const stored = localStorage.getItem('chesster:user_keybindings');
    expect(stored).toContain('flip_board');
  });

  it('detects duplicate key conflicts', async () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

    const drawRow = screen.getByText('Offer Draw').closest('tr');
    const rebindButton = drawRow?.querySelector('button[class*="px-3"]');

    fireEvent.click(rebindButton!);

    const keyCodeInput = rebindButton as HTMLButtonElement;
    fireEvent.keyDown(keyCodeInput, { key: 'F', code: 'KeyF' });

    await waitFor(() => {
      expect(screen.getByText(/already assigned/)).toBeInTheDocument();
    });
  });

  it('persists custom keybindings to localStorage', () => {
    const { rerender } = render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

    const flipBoardRow = screen.getByText('Flip Board').closest('tr');
    const rebindButton = flipBoardRow?.querySelector('button[class*="px-3"]');

    fireEvent.click(rebindButton!);
    const keyCodeInput = rebindButton as HTMLButtonElement;
    fireEvent.keyDown(keyCodeInput, { key: 'Z', code: 'KeyZ' });

    expect(localStorage.getItem('chesster:user_keybindings')).toContain('flip_board');

    rerender(<KeyboardShortcutsModal isOpen={false} onClose={vi.fn()} />);
    rerender(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('restores default keybindings on reset', async () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

    const flipBoardRow = screen.getByText('Flip Board').closest('tr');
    const rebindButton = flipBoardRow?.querySelector('button[class*="px-3"]');

    fireEvent.click(rebindButton!);
    const keyCodeInput = rebindButton as HTMLButtonElement;
    fireEvent.keyDown(keyCodeInput, { key: 'Z', code: 'KeyZ' });

    await waitFor(() => {
      expect(screen.getByText('Z')).toBeInTheDocument();
    });

    const resetButton = screen.getByText('Reset to Defaults');
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(screen.getByText('F')).toBeInTheDocument();
    });

    expect(localStorage.getItem('chesster:user_keybindings')).toBeNull();
  });

  it('supports modifier key combinations', async () => {
    render(<KeyboardShortcutsModal isOpen={true} onClose={vi.fn()} />);

    const flipBoardRow = screen.getByText('Flip Board').closest('tr');
    const rebindButton = flipBoardRow?.querySelector('button[class*="px-3"]');

    fireEvent.click(rebindButton!);
    const keyCodeInput = rebindButton as HTMLButtonElement;
    fireEvent.keyDown(keyCodeInput, { key: 'Z', code: 'KeyZ', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText('Ctrl+Z')).toBeInTheDocument();
    });
  });

  it('calls onClose when Done button is clicked', () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });
});
