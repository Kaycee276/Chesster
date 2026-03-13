interface ConfirmModalProps {
	title: string;
	message: string;
	confirmLabel: string;
	confirmClassName?: string;
	onConfirm: () => void;
	onCancel: () => void;
}

export default function ConfirmModal({
	title,
	message,
	confirmLabel,
	confirmClassName = "bg-red-500 hover:bg-red-600 text-white",
	onConfirm,
	onCancel,
}: ConfirmModalProps) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onClick={onCancel}
		>
			<div
				className="w-full max-w-xs mx-4 bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-4 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex flex-col gap-1">
					<h3 className="text-base font-bold">{title}</h3>
					<p className="text-sm text-(--text-secondary)">{message}</p>
				</div>
				<div className="flex gap-2 justify-end">
					<button
						onClick={onCancel}
						className="px-4 py-2 rounded-xl text-sm font-semibold bg-(--bg-tertiary) hover:bg-(--border) text-(--text-secondary) hover:text-(--text) transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={onConfirm}
						className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${confirmClassName}`}
					>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
