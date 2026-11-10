import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CornerRightUp, Loader2 } from 'lucide-react';
import { Textarea } from './textarea';
import { cn } from '../../lib/utils';
import { useAutoResizeTextarea } from '../../hooks/use-auto-resize-textarea';

export interface AIInputWithLoadingProps {
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
  disabled?: boolean;
  /** Retourner false après une erreur traitée pour conserver le brouillon. */
  onSubmit: (value: string) => boolean | void | Promise<boolean | void>;
  id?: string;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
}

export function AIInputWithLoading({
  value,
  onChange,
  loading,
  disabled = false,
  onSubmit,
  id,
  placeholder = 'Décris le fichier que tu cherches…',
  minHeight = 56,
  maxHeight = 200,
  className,
}: AIInputWithLoadingProps) {
  const uid = useId();
  const inputId = id ?? `leo-input-${uid}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const minimum = Number.isFinite(minHeight) ? Math.max(56, minHeight) : 56;
  const maximum = Number.isFinite(maxHeight) ? Math.max(minimum, maxHeight) : Math.max(minimum, 200);
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: minimum, maxHeight: maximum });
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(false);
  const submitLock = useRef(false);
  const composing = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const busy = loading || submitting;
  const tooLong = value.length > 500;
  const canSubmit = !disabled && !busy && !!value.trim() && !tooLong;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSubmit = async () => {
    if (!canSubmit || submitLock.current || composing.current) return;
    const submittedValue = value;
    submitLock.current = true;
    setSubmitting(true);
    setSubmissionError(false);
    try {
      const accepted = await onSubmit(submittedValue.trim());
      // Une suggestion ou un autre brouillon contrôlé ne doit pas être effacé.
      if (accepted !== false && mounted.current && latest.current.value === submittedValue) {
        latest.current.onChange('');
      }
    } catch {
      // Le parent gère les erreurs métier ; un rejet inattendu reste visible et garde la saisie.
      if (mounted.current) setSubmissionError(true);
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  return (
    <div className={cn('w-full min-w-0', className)}>
      <div className="relative mx-auto w-full min-w-0 max-w-xl">
        <label htmlFor={inputId} className="sr-only">Décris le fichier que tu cherches</label>
        <Textarea
          ref={textareaRef}
          id={inputId}
          data-autofocus
          value={value}
          placeholder={placeholder}
          maxLength={500}
          rows={1}
          enterKeyHint="send"
          disabled={disabled}
          readOnly={busy}
          aria-busy={busy}
          aria-invalid={tooLong || submissionError || undefined}
          aria-describedby={`${helpId}${submissionError ? ` ${errorId}` : ''}`}
          style={{ minHeight: minimum, maxHeight: maximum }}
          className="resize-none py-4 pr-16 pl-5 leading-6"
          onChange={(event) => {
            setSubmissionError(false);
            onChange(event.target.value);
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            if (!event.repeat) void handleSubmit();
          }}
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          aria-label={busy ? 'Léo cherche…' : 'Envoyer la recherche à Léo'}
          className="absolute right-1.5 bottom-1.5 inline-flex size-11 min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full bg-[#141414] text-white hover:bg-[#333333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> : <CornerRightUp aria-hidden="true" className="size-5" />}
        </button>
      </div>
      <div className="mx-auto mt-2 w-full min-w-0 max-w-xl px-1">
        <p id={helpId} role="status" aria-atomic="true" className="text-xs leading-relaxed text-[#141414]/65">
          {busy ? 'Léo cherche…' : tooLong ? 'Décris ta recherche en 500 caractères maximum.' : 'Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne'}
        </p>
        {submissionError && (
          <div className="mt-2 text-sm text-[#141414]">
            <p id={errorId} role="alert">Léo n'a pas pu répondre. Réessaie dans un instant.</p>
            <button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}
              className="mt-1 inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full px-3 font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414] disabled:cursor-not-allowed disabled:opacity-50">Réessayer</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIInputWithLoading;
