import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, Loader2, Search, Shield, ShieldAlert } from 'lucide-react';
import { formatDateFrench, updateUserRole, type UserProfile } from '../lib/supabase';
import type { UserRole } from '../lib/database.types';
import type { AdminLibraryData } from '../lib/admin-library';
import { inspectRoleResult } from '../lib/admin-confirmations';
import { errorMessage } from '../lib/errors';
import { BottomSheet } from './mobile/BottomSheet';

interface UsersTableProps {
  users: UserProfile[];
  onRefresh: () => Promise<AdminLibraryData>;
  currentUserId: string;
  isCurrent: () => boolean;
  disabled?: boolean;
  onInteractionChange: (active: boolean) => void;
}
interface RoleAction {
  profile: UserProfile;
  expectedRole: UserRole;
  attempted: boolean;
  mutationConfirmed: boolean;
}
const buttonClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:cursor-not-allowed disabled:opacity-50';

function ProfileIdentity({ profile }: { profile: UserProfile }) {
  return <div className="flex min-w-0 items-start gap-3">
    {profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-10 w-10 shrink-0 rounded-full border border-[#141414]/10 object-cover" />
      : <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ff6a2b]/20 font-black text-[#141414]">{profile.full_name?.trim().charAt(0).toUpperCase() || '?'}</span>}
    <div className="min-w-0 flex-1">
      <p className="break-words text-sm font-extrabold">{profile.full_name || 'Nom non renseigné'}</p>
      <p className="mt-1 break-all text-xs text-[#141414]/65">{profile.email || 'Adresse e-mail non renseignée'}</p>
    </div>
  </div>;
}
function RoleBadge({ role }: { role: UserRole }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${role === 'admin' ? 'border border-[#141414] bg-[#ffd23f]' : 'bg-[#f1ece4] text-[#141414]/75'}`}>
    {role === 'admin' && <Shield className="h-3.5 w-3.5" aria-hidden="true" />}{role === 'admin' ? 'Admin' : 'Membre'}
  </span>;
}

export function UsersTable({ users, onRefresh, currentUserId, isCurrent, disabled = false, onInteractionChange }: UsersTableProps) {
  const reducedMotion = useReducedMotion();
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<RoleAction | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operationRef = useRef(false);
  const mountedRef = useRef(false);
  const searchId = useId();
  const hasInteraction = action !== null;
  const query = search.trim().toLocaleLowerCase('fr');
  const filteredUsers = users.filter((profile) => [profile.full_name, profile.email].some((value) => value?.toLocaleLowerCase('fr').includes(query)) || !query);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    onInteractionChange(hasInteraction);
    return () => onInteractionChange(false);
  }, [hasInteraction, onInteractionChange]);

  const closeAction = () => {
    if (!operationRef.current) { setAction(null); setActionError(null); }
  };
  const openAction = (profile: UserProfile) => {
    if (disabled || operationRef.current || !isCurrent() || profile.id === currentUserId) return;
    setNotice(null);
    setActionError(null);
    setAction({ profile: { ...profile }, expectedRole: profile.role === 'admin' ? 'user' : 'admin', attempted: false, mutationConfirmed: false });
  };
  const performAction = async () => {
    if (!action || operationRef.current || !isCurrent() || (!action.attempted && disabled)) return;
    const current = () => mountedRef.current && isCurrent();
    let mutationConfirmed = action.mutationConfirmed;
    let mutationError: string | null = null;
    operationRef.current = true;
    setIsWorking(true);
    setActionError(null);
    try {
      if (!action.attempted) {
        // Cible et rôle restent figés. Après un premier envoi, ce dialogue ne
        // peut que relire le profil : pas de bascule répétée en cas de réponse perdue.
        setAction({ ...action, attempted: true });
        try {
          await updateUserRole(action.profile.id, action.expectedRole, currentUserId);
          if (!current()) return;
          mutationConfirmed = true;
          setAction({ ...action, attempted: true, mutationConfirmed: true });
        } catch (cause) {
          if (!current()) return;
          mutationError = errorMessage(cause, 'Le changement de rôle n’a pas été confirmé.');
        }
      }
      try {
        const data = await onRefresh();
        if (!current()) return;
        const result = inspectRoleResult(action.profile.id, action.expectedRole, data.users);
        if (result === 'confirmed') {
          const roleName = action.expectedRole === 'admin' ? 'administrateur' : 'membre';
          setNotice(mutationConfirmed
            ? `Le rôle ${roleName} a été confirmé et les inscriptions ont été actualisées.`
            : `La relecture confirme le rôle ${roleName} de ce profil. Elle ne permet pas d’attribuer la modification à ce clic.`);
          setAction(null);
        } else {
          setActionError(`${mutationError ? `${mutationError} ` : ''}${mutationConfirmed ? 'Le changement avait été confirmé, mais le profil a ensuite changé.' : 'La relecture ne confirme pas le rôle demandé.'} ${result === 'unavailable' ? 'Ce profil n’est plus accessible.' : 'Le rôle actuel est différent du rôle demandé.'} Aucune nouvelle modification n’est envoyée. Fermez pour vérifier les inscriptions avant une nouvelle action.`);
        }
      } catch (cause) {
        if (!current()) return;
        const readError = errorMessage(cause, 'Les inscriptions n’ont pas pu être actualisées.');
        setActionError(mutationConfirmed
          ? `Le rôle a été enregistré, mais la liste n’a pas pu être actualisée : ${readError} Réessayez l’actualisation, pas la modification.`
          : `Le résultat reste incertain. ${mutationError ? `${mutationError} ` : ''}${readError} Relisez le profil avant toute nouvelle action.`);
      }
    } finally {
      operationRef.current = false;
      if (current()) setIsWorking(false);
    }
  };
  const roleButton = (profile: UserProfile) => profile.id === currentUserId
    ? <span className="text-xs text-[#141414]/65">Votre compte</span>
    : <button type="button" disabled={disabled || hasInteraction} onClick={() => openAction(profile)}
      className={`${buttonClass} w-full md:w-auto ${profile.role === 'admin' ? 'border border-rose-300 text-rose-700 hover:bg-rose-50' : 'bg-[#141414] text-white hover:bg-[#ff6a2b]'}`}>
      {profile.role === 'admin' ? 'Retirer les droits admin' : 'Nommer admin'}
    </button>;

  return (
    <div className="min-w-0 space-y-5">
      {notice && <p role="status" className="break-words rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
      <div className="flex min-w-0 flex-col gap-3 rounded-2xl border-2 border-[#141414]/15 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-wide text-[#141414]/65">Inscriptions visibles</p><p className="mt-1 text-3xl font-extrabold tabular-nums">{users.length}</p></div>
        <div className="w-full min-w-0 sm:max-w-sm">
          <label htmlFor={searchId} className="mb-2 block text-sm font-bold">Rechercher un profil</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#141414]/50" aria-hidden="true" />
            <input id={searchId} type="search" value={search} disabled={hasInteraction} onChange={(event) => setSearch(event.target.value)} placeholder="Nom ou adresse e-mail…"
              className="min-h-11 w-full min-w-0 rounded-xl border border-[#141414]/20 bg-[#f1ece4] py-2 pl-10 pr-3 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a6cf0] disabled:opacity-50" />
          </div>
        </div>
      </div>
      {filteredUsers.length === 0 ? (
        <div className="rounded-3xl border-2 border-[#141414]/15 bg-white px-4 py-10 text-center">
          <h3 className="text-lg font-extrabold">{users.length ? 'Aucun profil correspondant' : 'Aucune inscription accessible'}</h3>
          <p className="mt-2 text-sm text-[#141414]/65">{users.length ? 'Essayez un autre nom ou effacez votre recherche.' : 'Actualisez les données avant de conclure qu’aucun profil n’existe.'}</p>
          {search && <button type="button" onClick={() => setSearch('')} className={`${buttonClass} mt-3 bg-[#f1ece4]`}>Effacer la recherche</button>}
        </div>
      ) : <>
        <div className="min-w-0 space-y-3 md:hidden"><AnimatePresence>
          {filteredUsers.map((profile) => <motion.article key={profile.id} layout={!reducedMotion} initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}
            className="min-w-0 space-y-3 rounded-2xl border-2 border-[#141414]/15 bg-white p-4 shadow-2xs">
            <ProfileIdentity profile={profile} />
            <div className="flex flex-wrap items-center justify-between gap-2"><RoleBadge role={profile.role} /><span className="text-xs font-bold">{profile.document_count} fichier(s) actif(s)</span></div>
            <dl className="space-y-1 border-t border-[#141414]/10 pt-2 text-xs text-[#141414]/70">
              <div className="flex flex-wrap justify-between gap-x-2"><dt>Inscription</dt><dd>{formatDateFrench(profile.created_at)}</dd></div>
              <div className="flex flex-wrap justify-between gap-x-2"><dt>Connexion enregistrée</dt><dd>{formatDateFrench(profile.last_sign_in_at)}</dd></div>
            </dl>
            {roleButton(profile)}
          </motion.article>)}
        </AnimatePresence></div>
        <div className="hidden min-w-0 overflow-x-auto rounded-3xl border-2 border-[#141414]/15 bg-white md:block">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Inscriptions accessibles, fichiers actifs et rôles des profils</caption>
            <thead className="border-b-2 border-[#f1ece4] bg-[#f1ece4]/60 text-xs">
              <tr><th scope="col" className="p-4">Profil</th><th scope="col" className="p-4">Inscription</th><th scope="col" className="p-4">Connexion enregistrée</th><th scope="col" className="p-4">Fichiers actifs</th><th scope="col" className="p-4">Rôle</th><th scope="col" className="p-4">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-[#f1ece4]">
              {filteredUsers.map((profile) => <tr key={profile.id} className="align-top hover:bg-[#f1ece4]/20">
                <td className="max-w-72 p-4"><ProfileIdentity profile={profile} /></td>
                <td className="p-4 text-xs">{formatDateFrench(profile.created_at)}</td>
                <td className="p-4 text-xs">{formatDateFrench(profile.last_sign_in_at)}</td>
                <td className="p-4 font-bold tabular-nums">{profile.document_count}</td>
                <td className="p-4"><RoleBadge role={profile.role} /></td>
                <td className="p-4">{roleButton(profile)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
      <BottomSheet isOpen={action !== null} onClose={closeAction} canClose={!isWorking} title={action?.expectedRole === 'admin' ? 'Nommer admin' : 'Retirer les droits admin'}>
        {action && <form onSubmit={(event) => { event.preventDefault(); void performAction(); }} className="min-w-0 space-y-4">
          <ShieldAlert className="h-8 w-8 text-[#ff6a2b]" aria-hidden="true" />
          <ProfileIdentity profile={action.profile} />
          <p className="text-sm text-[#141414]/75">{action.expectedRole === 'admin'
            ? 'Ce profil pourra modérer les fichiers et gérer les rôles des autres membres.'
            : 'Ce profil ne pourra plus accéder à la console de modération ni gérer les rôles.'}</p>
          {action.expectedRole === 'user' && <p className="text-sm font-bold">La migration V5 interdit de retirer ou supprimer le dernier compte administrateur.</p>}
          {actionError && <div role="alert" className="flex min-w-0 items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" /><p className="min-w-0 break-words">{actionError}</p>
          </div>}
          {isWorking && <p role="status" className="text-sm">Envoi ou vérification du rôle en cours…</p>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" disabled={isWorking || (!action.attempted && disabled)} className={`${buttonClass} flex-1 bg-[#ff6a2b] text-[#141414] hover:bg-[#ff8a4c]`}>
              {isWorking && <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {isWorking ? 'Vérification…' : action.attempted ? 'Réessayer l’actualisation' : 'Confirmer'}
            </button>
            <button type="button" data-autofocus disabled={isWorking} onClick={closeAction} className={`${buttonClass} flex-1 border border-[#141414]/20 bg-white`}>
              {action.attempted ? 'Fermer et vérifier la liste' : 'Annuler'}
            </button>
          </div>
        </form>}
      </BottomSheet>
    </div>
  );
}
