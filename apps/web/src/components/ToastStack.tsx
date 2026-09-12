type Toast = { id: number; text: string };

export function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
