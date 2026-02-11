import { useToastStore } from "../store/toastStore";

export default function Toast() {
	const { toasts, removeToast } = useToastStore();

	return (
		<div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={`px-4 py-3 rounded shadow-lg text-white cursor-pointer ${
						toast.type === "error"
							? "bg-(--error)"
							: toast.type === "success"
								? "bg-(--success)"
								: "bg-(--info)"
					}`}
					onClick={() => removeToast(toast.id)}
				>
					{toast.message}
				</div>
			))}
		</div>
	);
}
