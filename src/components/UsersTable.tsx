import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, formatDateFrench, updateUserRole } from '../lib/supabase';
import { Search, Shield, UserCheck, ShieldAlert, AlertCircle, Loader2 } from 'lucide-react';

interface UsersTableProps {
  users: UserProfile[];
  onRefresh: () => Promise<void>;
  currentUserId: string;
}

export const UsersTable: React.FC<UsersTableProps> = ({
  users,
  onRefresh,
  currentUserId,
}) => {
  const [search, setSearch] = useState('');
  const [targetUser, setTargetUser] = useState<UserProfile | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Compteur count-up animé
  const [displayCount, setDisplayCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = users.length;
    if (end === 0) {
      setDisplayCount(0);
      return;
    }
    const duration = 600;
    const stepTime = Math.max(20, Math.floor(duration / end));
    const timer = setInterval(() => {
      start += 1;
      setDisplayCount(start);
      if (start >= end) {
        clearInterval(timer);
      }
    }, stepTime);
    return () => clearInterval(timer);
  }, [users.length]);

  const filteredUsers = users.filter((u) => {
    const q = search.trim().toLowerCase();
    return (
      u.full_name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  const handleToggleRole = async () => {
    if (!targetUser) return;
    try {
      setIsUpdating(true);
      const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
      await updateUserRole(targetUser.id, newRole);
      await onRefresh();
      setTargetUser(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* En-tête avec compteur animé et recherche */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border-2 border-[#141414]/15 shadow-2xs">
        <div>
          <span className="text-xs font-bold text-[#141414]/50 uppercase tracking-wider">
            Total des inscrits
          </span>
          <div className="flex items-center gap-2">
            <span className="font-[800] text-3xl text-[#141414] font-mono">
              {displayCount}
            </span>
            <span className="text-xs font-bold text-[#ff6a2b]">utilisateurs Google</span>
          </div>
        </div>

        {/* Barre de recherche d'utilisateurs */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-[#141414]/40 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Rechercher par nom ou email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#f1ece4]/70 border border-[#141414]/15 text-xs font-bold text-[#141414] placeholder-[#141414]/40 focus:outline-hidden focus:border-[#ff6a2b]"
          />
        </div>
      </div>

      {/* Version Mobile : Cartes empilées */}
      <div className="md:hidden flex flex-col gap-3">
        <AnimatePresence>
          {filteredUsers.map((u, idx) => (
            <motion.div
              key={u.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              className="bg-white rounded-2xl border-2 border-[#141414]/15 p-4 shadow-2xs flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0 pr-2">
                  {u.avatar_url ? (
                    <img
                      src={u.avatar_url}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover border border-[#141414]/10 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#ff6a2b]/20 text-[#ff6a2b] font-black flex items-center justify-center shrink-0">
                      {u.full_name.charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-extrabold text-sm text-[#141414] truncate">{u.full_name}</p>
                    <p className="text-xs text-[#141414]/60 truncate font-mono">{u.email}</p>
                  </div>
                </div>

                {u.role === 'admin' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffd23f] border border-[#141414] text-[#141414] font-extrabold text-[11px] shadow-2xs shrink-0">
                    <Shield className="w-3 h-3 text-[#ff6a2b]" />
                    <span>Admin</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f1ece4] text-[#141414]/70 font-bold text-[11px] shrink-0">
                    <span>Membre</span>
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-xs text-[#141414]/65 pt-2 border-t border-[#f1ece4]">
                <span>Inscrit le {formatDateFrench(u.created_at)}</span>
                <span className="font-bold text-[#141414] bg-[#f1ece4] px-2 py-0.5 rounded-full text-[11px]">
                  {u.document_count || 0} document(s)
                </span>
              </div>

              {u.id !== currentUserId && (
                <button
                  type="button"
                  onClick={() => setTargetUser(u)}
                  className={`w-full py-2.5 rounded-xl text-xs font-black transition-all active:scale-98 cursor-pointer ${
                    u.role === 'admin'
                      ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'
                      : 'bg-[#141414] text-white hover:bg-[#ff6a2b]'
                  }`}
                >
                  {u.role === 'admin' ? 'Retirer les droits Admin' : 'Nommer Administrateur'}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Version Desktop : Tableau classique */}
      <div className="hidden md:block bg-white rounded-3xl border-2 border-[#141414]/15 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-[#f1ece4] bg-[#f1ece4]/40 text-xs font-extrabold text-[#141414]">
                <th className="py-3.5 px-5">Utilisateur</th>
                <th className="py-3.5 px-4">Date d'inscription</th>
                <th className="py-3.5 px-4">Dernière visite</th>
                <th className="py-3.5 px-4">Documents</th>
                <th className="py-3.5 px-4">Rôle</th>
                <th className="py-3.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1ece4] text-xs font-medium">
              <AnimatePresence>
                {filteredUsers.map((u, idx) => (
                  <motion.tr
                    key={u.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className="hover:bg-[#f1ece4]/20 transition-colors"
                  >
                    {/* Utilisateur : avatar + nom + email */}
                    <td className="py-4 px-5">
                      <div className="flex items-center gap-3">
                        {u.avatar_url ? (
                          <img
                            src={u.avatar_url}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover border border-[#141414]/10 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[#ff6a2b]/20 text-[#ff6a2b] font-black flex items-center justify-center shrink-0">
                            {u.full_name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-extrabold text-[#141414] truncate max-w-[160px]">
                            {u.full_name}
                          </p>
                          <p className="text-[11px] text-[#141414]/60 truncate font-mono max-w-[160px]">
                            {u.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Date d'inscription */}
                    <td className="py-4 px-4 text-[#141414]/70">
                      {formatDateFrench(u.created_at)}
                    </td>

                    {/* Dernière visite */}
                    <td className="py-4 px-4 text-[#141414]/70">
                      {formatDateFrench(u.last_sign_in_at)}
                    </td>

                    {/* Nombre de documents */}
                    <td className="py-4 px-4">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#f1ece4] text-[#141414] font-bold text-[11px]">
                        {u.document_count || 0} doc(s)
                      </span>
                    </td>

                    {/* Rôle */}
                    <td className="py-4 px-4">
                      {u.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#ffd23f] border border-[#141414] text-[#141414] font-extrabold text-[11px] shadow-2xs">
                          <Shield className="w-3 h-3 text-[#ff6a2b]" />
                          <span>Admin</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f1ece4] text-[#141414]/70 font-bold text-[11px]">
                          <span>Membre</span>
                        </span>
                      )}
                    </td>

                    {/* Actions : Promouvoir / Rétrograder */}
                    <td className="py-4 px-5 text-right">
                      {u.id === currentUserId ? (
                        <span className="text-[11px] text-[#141414]/40 italic">
                          (Vous-même)
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTargetUser(u)}
                          className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold transition-colors cursor-pointer ${
                            u.role === 'admin'
                              ? 'bg-white border border-[#e11d48]/30 text-[#e11d48] hover:bg-[#e11d48]/10'
                              : 'bg-[#141414] text-white hover:bg-[#ff6a2b]'
                          }`}
                        >
                          {u.role === 'admin' ? 'Retirer admin' : 'Nommer admin'}
                        </button>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>

      {/* Popover confirmation changement de rôle */}
      {targetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#141414]/50 backdrop-blur-xs">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm bg-white rounded-3xl border-3 border-[#141414] p-6 shadow-2xl text-center flex flex-col items-center gap-3"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#ffd23f]/30 border-2 border-[#141414] flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-[#ff6a2b]" />
            </div>

            <h4 className="font-[800] text-lg text-[#141414]">
              {targetUser.role === 'admin'
                ? `Retirer le rôle Admin à ${targetUser.full_name} ?`
                : `Promouvoir ${targetUser.full_name} en tant qu'Admin ?`}
            </h4>

            <p className="text-xs text-[#141414]/70 leading-relaxed">
              {targetUser.role === 'admin'
                ? 'Cet utilisateur ne pourra plus accéder à la modération ni gérer les autres membres.'
                : 'Cet utilisateur aura un accès complet pour approuver ou rejeter les documents.'}
            </p>

            <div className="flex items-center gap-2 w-full mt-2">
              <button
                type="button"
                disabled={isUpdating}
                onClick={handleToggleRole}
                className="flex-1 py-2.5 rounded-full bg-[#ff6a2b] text-white text-xs font-extrabold hover:bg-[#ff8a4c] transition-colors flex items-center justify-center gap-1.5"
              >
                {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirmer'}
              </button>
              <button
                type="button"
                onClick={() => setTargetUser(null)}
                className="flex-1 py-2.5 rounded-full bg-[#f1ece4] text-[#141414] text-xs font-bold hover:bg-[#e7e1d7]"
              >
                Annuler
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
