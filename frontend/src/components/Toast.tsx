import { Loader2, Gamepad2, X } from "lucide-react";
import { useToastStore } from "../store/toastStore";

const TYPE_STYLES: Record<string, string> = {
	error: "bg-(--error)",
	success: "bg-(--success)",
	loading: "bg-(--warning)",
	info: "bg-(--info)",
	invitation: "bg-gradient-to-r from-purple-600 to-blue-600 border border-purple-400/30",
};

export default function Toast() {
	const { toasts, removeToast } = useToastStore();

	return (
		<div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`px-4 py-3 rounded-xl shadow-lg text-white flex items-center gap-2 animate-slide-in ${
						TYPE_STYLES[toast.type] ?? TYPE_STYLES.info
					} ${toast.type === "loading" ? "cursor-default" : "cursor-pointer"}`}
					onClick={() => {
						if (toast.type !== "loading" && toast.type !== "invitation") {
							removeToast(toast.id);
						}
					}}
				>
					{toast.type === "loading" && (
						<Loader2 size={16} className="animate-spin shrink-0" />
					)}
					{toast.type === "invitation" && (
						<Gamepad2 size={16} className="shrink-0 text-purple-200" />
					)}
					<span className="flex-1 text-sm">{toast.message}</span>
					{toast.type === "invitation" && toast.action && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								toast.action!.onClick();
								removeToast(toast.id);
							}}
							className="px-2 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold shrink-0 transition-colors"
						>
							{toast.action.label}
						</button>
					)}
					{toast.type !== "loading" && toast.type !== "invitation" && (
						<button
							onClick={(e) => {
								e.stopPropagation();
								removeToast(toast.id);
							}}
							className="text-white/60 hover:text-white transition-colors shrink-0"
							aria-label="Dismiss"
						>
							<X size={14} />
						</button>
					)}
				</div>
			))}
		</div>
	);
}
