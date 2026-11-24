import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Gamepad2, X } from "lucide-react";
import { useToastStore, type Toast as ToastData } from "../store/toastStore";

/** Maximum toasts shown at once; the rest wait in a FIFO queue (#585). */
export const MAX_VISIBLE_TOASTS = 4;
/** How often the countdown advances, in ms. */
const TICK_MS = 50;
/** Exit animation length, in ms. */
export const TOAST_EXIT_MS = 200;

const TYPE_STYLES: Record<string, string> = {
	error: "bg-(--error)",
	success: "bg-(--success)",
	loading: "bg-(--warning)",
	info: "bg-(--info)",
	invitation: "bg-gradient-to-r from-purple-600 to-blue-600 border border-purple-400/30",
};

const PROGRESS_STYLES: Record<string, string> = {
	error: "bg-red-200/80",
	success: "bg-green-200/80",
	loading: "bg-yellow-200/80",
	info: "bg-blue-200/80",
	invitation: "bg-purple-200/80",
};

function ToastItem({ toast }: { toast: ToastData }) {
	const removeToast = useToastStore((s) => s.removeToast);
	const [progress, setProgress] = useState(100);
	const [isHovered, setIsHovered] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	const [isLeaving, setIsLeaving] = useState(false);
	// Hovering and keyboard focus are tracked separately so moving focus out
	// of a toast while the pointer still rests on it keeps the countdown
	// paused (and vice versa).
	const isPaused = isHovered || isFocused;
	const remainingRef = useRef(toast.duration ?? 0);
	const leavingRef = useRef(false);
	const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Animate out, then remove. Safe to call repeatedly (timer + manual close).
	const dismiss = useCallback(() => {
		if (leavingRef.current) return;
		leavingRef.current = true;
		setIsLeaving(true);
		exitTimerRef.current = setTimeout(() => removeToast(toast.id), TOAST_EXIT_MS);
	}, [removeToast, toast.id]);

	useEffect(() => () => clearTimeout(exitTimerRef.current), []);

	// Countdown. The toast only mounts once it is visible, so queued toasts do
	// not burn through their time while waiting.
	useEffect(() => {
		if (toast.duration === null || isPaused || isLeaving) return;
		let last = Date.now();
		const timer = setInterval(() => {
			const now = Date.now();
			remainingRef.current = Math.max(0, remainingRef.current - (now - last));
			last = now;
			setProgress((remainingRef.current / (toast.duration as number)) * 100);
			if (remainingRef.current <= 0) {
				clearInterval(timer);
				dismiss();
			}
		}, TICK_MS);
		return () => clearInterval(timer);
	}, [toast.duration, isPaused, isLeaving, dismiss]);

	const dismissible = toast.type !== "loading" && toast.type !== "invitation";

	return (
		<div
			role="status"
			data-testid="toast"
			data-paused={isPaused}
			className={`relative overflow-hidden px-4 py-3 rounded-xl shadow-lg text-white flex items-center gap-2 transition-all duration-200 ease-out ${
				isLeaving ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0 animate-slide-in"
			} ${TYPE_STYLES[toast.type] ?? TYPE_STYLES.info} ${
				toast.type === "loading" ? "cursor-default" : "cursor-pointer"
			}`}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			onFocus={() => setIsFocused(true)}
			onBlur={(event) => {
				// Ignore focus moving between controls inside the same toast.
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setIsFocused(false);
				}
			}}
			onClick={() => {
				if (dismissible) dismiss();
			}}
		>
			{toast.type === "loading" && <Loader2 size={16} className="animate-spin shrink-0" />}
			{toast.type === "invitation" && <Gamepad2 size={16} className="shrink-0 text-purple-200" />}
			<span className="flex-1 text-sm">{toast.message}</span>
			{toast.type === "invitation" && toast.action && (
				<button
					onClick={(e) => {
						e.stopPropagation();
						toast.action!.onClick();
						dismiss();
					}}
					className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold shrink-0 transition-colors"
				>
					{toast.action.label}
				</button>
			)}
			{dismissible && (
				<button
					onClick={(e) => {
						e.stopPropagation();
						dismiss();
					}}
					className="text-white/60 hover:text-white transition-colors shrink-0"
					aria-label="Dismiss"
				>
					<X size={14} />
				</button>
			)}
			{toast.duration !== null && (
				<div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700/50 overflow-hidden rounded-b">
					<div
						role="progressbar"
						aria-label="Time remaining"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(progress)}
						className={`h-full transition-all ease-linear ${PROGRESS_STYLES[toast.type] ?? PROGRESS_STYLES.info}`}
						style={{ width: `${progress}%`, transitionDuration: `${TICK_MS}ms` }}
					/>
				</div>
			)}
		</div>
	);
}

export default function Toast() {
	const toasts = useToastStore((s) => s.toasts);
	// Oldest first; anything beyond the cap is queued until a slot frees up.
	const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);

	return (
		<div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs">
			{visible.map((toast) => (
				<ToastItem key={toast.id} toast={toast} />
			))}
		</div>
	);
}
