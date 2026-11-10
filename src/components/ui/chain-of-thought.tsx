import * as React from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
import { CheckCircle2, ChevronDown, Circle, CircleAlert, Image as ImageIcon, Lightbulb, Loader2, MinusCircle, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';

export type StepStatus = 'pending' | 'active' | 'complete' | 'error' | 'skipped';

export interface AiChainOfThoughtProps {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

const ChainContext = React.createContext({ isOpen: true });

// Ces étapes décrivent le traitement réel et ses résumés publics, pas le raisonnement du modèle.
export function AiChainOfThought({ defaultOpen = true, open, onOpenChange, children, className }: AiChainOfThoughtProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <ChainContext.Provider value={{ isOpen }}>
      <CollapsiblePrimitive.Root
        open={isOpen}
        onOpenChange={handleOpenChange}
        className={cn('w-full min-w-0 overflow-hidden rounded-3xl border border-[#141414]/10 bg-white text-[#141414]', className)}
      >
        {children}
      </CollapsiblePrimitive.Root>
    </ChainContext.Provider>
  );
}

export interface AiChainOfThoughtHeaderProps {
  title?: string;
  stepCount?: number;
  completedCount?: number;
  children?: React.ReactNode;
  className?: string;
}

export function AiChainOfThoughtHeader({ title = 'Réflexion de Léo', stepCount, completedCount, children, className }: AiChainOfThoughtHeaderProps) {
  const { isOpen } = React.useContext(ChainContext);
  const total = typeof stepCount === 'number' && Number.isFinite(stepCount) ? Math.max(0, Math.floor(stepCount)) : undefined;
  const done = typeof completedCount === 'number' && Number.isFinite(completedCount)
    ? Math.min(total ?? Number.POSITIVE_INFINITY, Math.max(0, Math.floor(completedCount)))
    : undefined;

  return (
    <CollapsiblePrimitive.Trigger
      type="button"
      className={cn('flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-3xl px-4 py-3 text-left hover:bg-[#f1ece4]/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#141414]', className)}
    >
      <Lightbulb aria-hidden="true" className="size-4 shrink-0 text-[#141414]/70" />
      <span className="min-w-0 flex-1 text-sm font-semibold break-words">{children ?? title}</span>
      {total !== undefined && (
        <span className="shrink-0 rounded-full bg-[#ededed] px-2 py-0.5 text-xs font-medium tabular-nums">
          {done === undefined ? `${total} étape${total > 1 ? 's' : ''}` : `${done}/${total} étape${total > 1 ? 's' : ''}`}
        </span>
      )}
      <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 text-[#141414]/60 transition-transform motion-reduce:transition-none', isOpen && 'rotate-180')} />
    </CollapsiblePrimitive.Trigger>
  );
}

export interface AiChainOfThoughtContentProps {
  children?: React.ReactNode;
  className?: string;
}

export function AiChainOfThoughtContent({ children, className }: AiChainOfThoughtContentProps) {
  return (
    <CollapsiblePrimitive.Content className={cn('min-w-0 overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none!', className)}>
      <div className="min-w-0 px-4 pt-1 pb-4">{children}</div>
    </CollapsiblePrimitive.Content>
  );
}

export interface AiChainOfThoughtStepProps {
  status: StepStatus;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

const STEP_STATUS = {
  pending: { icon: Circle, label: 'En attente', className: 'text-[#141414]/45' },
  active: { icon: Loader2, label: 'En cours', className: 'animate-spin text-[#141414] motion-reduce:animate-none' },
  complete: { icon: CheckCircle2, label: 'Terminée', className: 'text-[#141414]' },
  error: { icon: CircleAlert, label: 'Interrompue', className: 'text-red-700' },
  skipped: { icon: MinusCircle, label: 'Ignorée', className: 'text-[#141414]/60' },
} satisfies Record<StepStatus, { icon: typeof Circle; label: string; className: string }>;

export function AiChainOfThoughtStep({ status, title, description, children, className }: AiChainOfThoughtStepProps) {
  const { icon: Icon, label, className: iconClassName } = STEP_STATUS[status];
  return (
    <div data-status={status} className={cn('group relative flex min-w-0 gap-3 pb-5 last:pb-0', className)}>
      <span aria-hidden="true" className="absolute top-6 bottom-0 left-2.5 w-px bg-[#141414]/10 group-last:hidden" />
      <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <Icon aria-hidden="true" className={cn('size-4', iconClassName)} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h4 className="min-w-0 text-sm font-semibold break-words [overflow-wrap:anywhere]">{title}</h4>
          <span className="text-xs text-[#141414]/65">{label}</span>
        </div>
        {description && <p className="mt-1 text-sm leading-relaxed text-[#141414]/70 break-words [overflow-wrap:anywhere]">{description}</p>}
        {children && <div className="mt-2 min-w-0">{children}</div>}
      </div>
    </div>
  );
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface AiChainOfThoughtSearchResultsProps {
  results: SearchResult[];
  onSelect?: (result: SearchResult) => void;
  className?: string;
}

function internalDocumentUrl(url: string): string | null {
  const prefix = '/dashboard?document=';
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  const id = url.slice(prefix.length);
  if (id.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return `${prefix}${id.toLowerCase()}`;
}

export function AiChainOfThoughtSearchResults({ results, onSelect, className }: AiChainOfThoughtSearchResultsProps) {
  const seen = new Set<string>();
  const safeResults = results.flatMap((result) => {
    const url = internalDocumentUrl(result.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ ...result, url }];
  });

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      <p role="status" aria-atomic="true" className="flex items-center gap-2 text-xs text-[#141414]/70">
        <Search aria-hidden="true" className="size-3.5 shrink-0" />
        {safeResults.length} résultat{safeResults.length > 1 ? 's' : ''} trouvé{safeResults.length > 1 ? 's' : ''}
      </p>
      <ul className="min-w-0 space-y-2">
        {safeResults.map((result) => (
          <li key={result.url} className="min-w-0">
            <Link
              to={result.url}
              onClick={(event) => {
                if (!onSelect || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                event.preventDefault();
                onSelect(result);
              }}
              className="block min-h-11 min-w-0 rounded-2xl bg-[#ededed] px-3 py-2 hover:bg-[#e2e2e2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#141414]"
            >
              <span className="block text-sm font-semibold break-words [overflow-wrap:anywhere]">{result.title}</span>
              {result.snippet && <span className="mt-1 block text-xs leading-relaxed text-[#141414]/70 break-words [overflow-wrap:anywhere]">{result.snippet}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface AiChainOfThoughtImageProps {
  src: string;
  alt: string;
  caption?: string;
  className?: string;
}

function ChainImagePreview({ src, alt }: Pick<AiChainOfThoughtImageProps, 'src' | 'alt'>) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  if (error) {
    return (
      <div role="status" className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl bg-[#ededed] p-4 text-center text-sm text-[#141414]/70">
        <ImageIcon aria-hidden="true" className="size-6" />
        <span>Impossible de charger l’image.</span>
        {alt && <span className="sr-only">{alt}</span>}
      </div>
    );
  }

  return (
    <div className="relative min-h-32 overflow-hidden rounded-2xl bg-[#ededed]">
      {loading && <div role="status" className="absolute inset-0 flex items-center justify-center"><Loader2 aria-hidden="true" className="size-5 animate-spin text-[#141414]/60 motion-reduce:animate-none" /><span className="sr-only">Chargement de l’image…</span></div>}
      <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setLoading(false)} onError={() => setError(true)}
        className={cn('max-h-64 w-full object-cover', loading && 'invisible')} />
    </div>
  );
}

export function AiChainOfThoughtImage({ src, alt, caption, className }: AiChainOfThoughtImageProps) {
  return (
    <figure className={cn('min-w-0 space-y-2', className)}>
      <ChainImagePreview key={src} src={src} alt={alt} />
      {caption && <figcaption className="text-xs text-[#141414]/65 break-words [overflow-wrap:anywhere]">{caption}</figcaption>}
    </figure>
  );
}

export default AiChainOfThought;
