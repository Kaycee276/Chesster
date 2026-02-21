import { Loader2 } from "lucide-react";
import { useToastStore } from "../store/toastStore";

export default function Toast() {
	const { toasts, removeToast } = useToastStore();

	return (
		<div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`px-4 py-3 rounded-xl shadow-lg text-white flex items-center gap-2 ${
						toast.type === "loading" ? "cursor-default" : "cursor-pointer"
					} ${
						toast.type === "error"
							? "bg-(--error)"
							: toast.type === "success"
								? "bg-(--success)"
								: toast.type === "loading"
									? "bg-(--info)"
									: "bg-(--warning)"
					}`}
					onClick={() => toast.type !== "loading" && removeToast(toast.id)}
				>
					{toast.type === "loading" && (
						<Loader2 size={16} className="animate-spin shrink-0" />
					)}
					{toast.message}
				</div>
			))}
		</div>
	);
}
