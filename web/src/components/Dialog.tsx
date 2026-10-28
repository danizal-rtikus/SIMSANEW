import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './ui';

/* ------------------------------------------------------------------
   Modal dasar (menggantikan dialog bawaan browser)
   ------------------------------------------------------------------ */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('input, select, textarea, button:not(.dialog-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && node) {
        const f = node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const a = f[0];
        const z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" ref={ref}>
        <div className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Konfirmasi, isian singkat, dan pemberitahuan berbasis Promise
   ------------------------------------------------------------------ */
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface PromptOpts extends ConfirmOpts {
  label: string;
  placeholder?: string;
  initial?: string;
  required?: boolean;
  multiline?: boolean;
}
interface AlertOpts {
  title: string;
  message?: ReactNode;
  okLabel?: string;
}

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'alert'; opts: AlertOpts; resolve: () => void };

interface DialogApi {
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: PromptOpts) => Promise<string | null>;
  alert: (o: AlertOpts) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ kind: 'confirm', opts, resolve })), []);
  const prompt = useCallback(
    (opts: PromptOpts) =>
      new Promise<string | null>((resolve) => {
        setText(opts.initial ?? '');
        setTouched(false);
        setState({ kind: 'prompt', opts, resolve });
      }),
    [],
  );
  const alert = useCallback((opts: AlertOpts) => new Promise<void>((resolve) => setState({ kind: 'alert', opts, resolve })), []);

  const close = (value: unknown) => {
    if (!state) return;
    (state.resolve as (v: unknown) => void)(value);
    setState(null);
  };

  const cancelValue = state?.kind === 'confirm' ? false : state?.kind === 'prompt' ? null : undefined;
  const promptInvalid = state?.kind === 'prompt' && state.opts.required && text.trim() === '';

  const submitPrompt = () => {
    setTouched(true);
    if (promptInvalid) return;
    close(text.trim());
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt, alert }}>
      {children}
      {state && (
        <Modal
          open
          title={state.opts.title}
          onClose={() => close(cancelValue)}
          footer={
            state.kind === 'alert' ? (
              <Button variant="primary" onClick={() => close(undefined)}>
                {state.opts.okLabel ?? 'Tutup'}
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => close(cancelValue)}>
                  {state.opts.cancelLabel ?? 'Batal'}
                </Button>
                <Button
                  variant={state.opts.danger ? 'danger-solid' : 'primary'}
                  onClick={() => (state.kind === 'prompt' ? submitPrompt() : close(true))}
                >
                  {state.opts.confirmLabel ?? 'Lanjutkan'}
                </Button>
              </>
            )
          }
        >
          <div className="stack-sm">
            {state.opts.message && <div className="muted">{state.opts.message}</div>}
            {state.kind === 'prompt' && (
              <form
                className="field"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitPrompt();
                }}
              >
                <label>{state.opts.label}</label>
                {state.opts.multiline ? (
                  <textarea value={text} placeholder={state.opts.placeholder} onChange={(e) => setText(e.target.value)} />
                ) : (
                  <input value={text} placeholder={state.opts.placeholder} onChange={(e) => setText(e.target.value)} />
                )}
                {touched && promptInvalid && <span className="err">Wajib diisi</span>}
              </form>
            )}
          </div>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogApi {
  const v = useContext(DialogContext);
  if (!v) throw new Error('useDialog harus dipakai di dalam DialogProvider');
  return v;
}
