import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import {
  DocumentItem,
  FolderItem,
  CategoryItem,
  uploadUserDocument,
  createFolderItem,
  formatFileSize,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  X,
  UploadCloud,
  FileText,
  Files,
  AlertCircle,
  CheckCircle2,
  Camera,
} from 'lucide-react';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CategoryItem[];
  folders: FolderItem[];
  initialFolderId?: string | null;
  onSuccess: (newDoc: DocumentItem, newFolder?: FolderItem) => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 Mo

const fieldClass =
  'w-full h-10 px-3 rounded-lg bg-white border border-[#141414]/20 text-sm text-[#141414] placeholder:text-[#141414]/40 hover:border-[#141414]/40 focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/15 focus:outline-hidden transition disabled:bg-[#f1ece4]';
const labelClass = 'block text-sm font-medium text-[#141414]/80 mb-1.5';
const linkButtonClass =
  'text-xs font-medium text-[#4a6cf0] hover:text-[#3d5ed8] hover:underline cursor-pointer';

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  categories,
  folders,
  initialFolderId = null,
  onSuccess,
}) => {
  const { user } = useAuth();

  const [files, setFiles] = useState<File[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>(initialFolderId || '');

  // Création d'un nouveau dossier à la volée
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Regrouper plusieurs fichiers
  const [groupInNewFolder, setGroupInNewFolder] = useState(false);
  const [groupFolderName, setGroupFolderName] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const modalBoxRef = useRef<HTMLDivElement>(null);

  const isBusy = uploadProgress !== null && !uploadSuccess;

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (isMobile && (info.offset.y > 100 || info.velocity.y > 500)) {
      if (uploadProgress === null) onClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      setFiles([]);
      setSelectedFileIndex(0);
      setTitle('');
      setDescription('');
      setSelectedCategoryId(categories[0]?.id || '');
      setSelectedFolderId(initialFolderId || '');
      setIsCreatingFolder(false);
      setNewFolderName('');
      setGroupInNewFolder(false);
      setGroupFolderName('');
      setUploadProgress(null);
      setUploadSuccess(false);
      setErrorMessage(null);
    }
  }, [isOpen, initialFolderId, categories]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && uploadProgress === null) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, uploadProgress]);

  const handleFilesChosen = (incoming: FileList | File[]) => {
    setErrorMessage(null);
    const arr = Array.from(incoming);
    if (arr.length === 0) return;

    for (const f of arr) {
      if (f.size > MAX_FILE_SIZE) {
        setErrorMessage(`Le fichier "${f.name}" dépasse la limite maximale de 20 Mo.`);
        return;
      }
    }

    setFiles(arr);
    setSelectedFileIndex(0);

    const first = arr[0];
    const nameWithoutExt = first.name.substring(0, first.name.lastIndexOf('.')) || first.name;
    setTitle(nameWithoutExt);

    if (arr.length > 1) {
      setGroupInNewFolder(true);
      setGroupFolderName(`Dossier ${nameWithoutExt}`);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesChosen(e.dataTransfer.files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setErrorMessage('Veuillez sélectionner au moins un fichier.');
      return;
    }
    if (!title.trim() && files.length === 1) {
      setErrorMessage('Le titre du document est obligatoire.');
      return;
    }
    if (!user) {
      setErrorMessage('Vous devez être connecté pour déposer un document.');
      return;
    }

    try {
      setErrorMessage(null);
      setUploadProgress(10);

      let targetFolderId = selectedFolderId || null;
      let createdFolderObj: FolderItem | undefined;

      const folderToCreate = isCreatingFolder
        ? newFolderName.trim()
        : groupInNewFolder && groupFolderName.trim()
        ? groupFolderName.trim()
        : null;

      if (folderToCreate) {
        createdFolderObj = await createFolderItem(
          folderToCreate,
          selectedCategoryId || null,
          user.id,
          user.user_metadata?.full_name || 'Utilisateur',
          user.user_metadata?.avatar_url || ''
        );
        targetFolderId = createdFolderObj.id;
      }

      const authorInfo = {
        name: user.user_metadata?.full_name || 'Utilisateur',
        avatar: user.user_metadata?.avatar_url || '',
        email: user.email || '',
      };

      let lastUploadedDoc: DocumentItem | null = null;
      const total = files.length;

      for (let i = 0; i < total; i++) {
        const currentFile = files[i];
        const docTitle =
          total === 1
            ? title.trim()
            : currentFile.name.substring(0, currentFile.name.lastIndexOf('.')) ||
              currentFile.name;

        lastUploadedDoc = await uploadUserDocument(
          currentFile,
          docTitle,
          description,
          user.id,
          targetFolderId,
          selectedCategoryId || null,
          (prog) => {
            const overall = ((i + prog / 100) / total) * 100;
            setUploadProgress(overall);
          },
          authorInfo
        );
      }

      setUploadProgress(100);
      setUploadSuccess(true);

      setTimeout(() => {
        if (lastUploadedDoc) {
          onSuccess(lastUploadedDoc, createdFolderObj);
        }
        onClose();
      }, 850);
    } catch (err: unknown) {
      setUploadProgress(null);
      const msg = err instanceof Error ? err.message : 'Une erreur inattendue est survenue.';
      setErrorMessage(msg);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-hidden sm:overflow-y-auto">
          {/* Fond */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              if (uploadProgress === null) onClose();
            }}
            className="fixed inset-0 bg-[#141414]/45 backdrop-blur-xs"
          />

          {/* Modal desktop / bottom sheet mobile */}
          <motion.div
            ref={modalBoxRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
            drag={isMobile ? 'y' : false}
            dragConstraints={{ top: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            initial={isMobile ? { y: '100%' } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
            exit={isMobile ? { y: '100%' } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="relative z-10 w-full max-w-lg bg-[#f1ece4] rounded-t-[28px] sm:rounded-[24px] shadow-[0_0_0_4px_#fff,0_18px_40px_rgba(10,16,60,0.35)] p-5 sm:p-7 max-h-[90dvh] overflow-y-auto safe-bottom touch-pan-y"
          >
            {isMobile && (
              <div className="pb-3 flex justify-center cursor-grab active:cursor-grabbing w-full">
                <div className="w-10 h-1 rounded-full bg-[#141414]/25" />
              </div>
            )}

            {/* En-tête */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2
                  id="upload-title"
                  className="text-xl font-extrabold text-[#141414] tracking-[-0.02em]"
                >
                  Déposer un document
                </h2>
                <p className="text-sm text-[#141414]/55 mt-0.5">
                  Il sera visible après validation par l'équipe admin.
                </p>
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={onClose}
                aria-label="Fermer"
                className="w-8 h-8 -mr-1.5 -mt-1 rounded-lg flex items-center justify-center text-[#141414]/55 hover:text-[#141414] hover:bg-[#141414]/5 transition-colors cursor-pointer disabled:opacity-40"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Erreur */}
            {errorMessage && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Zone de dépôt */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-full px-4 py-6 rounded-xl border border-dashed text-center flex flex-col items-center justify-center transition-colors ${
                  isDragging
                    ? 'bg-[#4a6cf0]/10 border-[#4a6cf0]'
                    : files.length > 0
                    ? 'bg-white/60 border-[#141414]/25'
                    : 'bg-white/60 border-[#141414]/25 hover:border-[#141414]/45'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesChosen(e.target.files);
                    }
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleFilesChosen(e.target.files);
                    }
                  }}
                />

                {files.length === 0 ? (
                  <>
                    <UploadCloud
                      className={`w-8 h-8 mb-3 ${isDragging ? 'text-[#4a6cf0]' : 'text-[#141414]/40'}`}
                      strokeWidth={1.5}
                    />
                    <p className="text-sm font-medium text-[#141414]">
                      Glissez vos fichiers ici
                    </p>
                    <p className="text-xs text-[#141414]/55 mt-1 mb-4">
                      PDF, images, documents. 20 Mo maximum par fichier.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-9 px-4 rounded-full bg-white border border-[#141414]/20 text-[#141414] text-sm font-medium hover:bg-[#f1ece4] transition-colors cursor-pointer"
                      >
                        Parcourir les fichiers
                      </button>
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="sm:hidden h-9 px-4 rounded-full bg-white border border-[#141414]/20 text-[#141414] text-sm font-medium hover:bg-[#f1ece4] transition-colors cursor-pointer inline-flex items-center gap-2"
                      >
                        <Camera className="w-4 h-4 text-[#141414]/55" />
                        <span>Prendre une photo</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3 w-full text-left">
                    <div className="w-10 h-10 shrink-0 rounded-lg bg-white border border-[#141414]/10 text-[#141414]/55 flex items-center justify-center">
                      {files.length > 1 ? (
                        <Files className="w-5 h-5" />
                      ) : (
                        <FileText className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#141414] truncate">
                        {files.length === 1
                          ? files[0].name
                          : `${files.length} fichiers sélectionnés`}
                      </p>
                      <p className="text-xs text-[#141414]/55 mt-0.5">
                        {files.length === 1
                          ? formatFileSize(files[0].size)
                          : formatFileSize(files.reduce((acc, f) => acc + f.size, 0))}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFiles([]);
                      }}
                      className={linkButtonClass}
                    >
                      Remplacer
                    </button>
                  </div>
                )}
              </div>

              {/* Regroupement si plusieurs fichiers */}
              {files.length > 1 && (
                <div className="space-y-2.5">
                  <label className="flex items-center gap-2.5 cursor-pointer text-sm text-[#141414]/80">
                    <input
                      type="checkbox"
                      checked={groupInNewFolder}
                      onChange={(e) => setGroupInNewFolder(e.target.checked)}
                      className="w-4 h-4 accent-[#4a6cf0] rounded cursor-pointer"
                    />
                    <span>Regrouper ces {files.length} fichiers dans un nouveau dossier</span>
                  </label>

                  {groupInNewFolder && (
                    <input
                      type="text"
                      required
                      aria-label="Nom du nouveau dossier"
                      placeholder="Nom du dossier"
                      value={groupFolderName}
                      onChange={(e) => setGroupFolderName(e.target.value)}
                      className={fieldClass}
                    />
                  )}
                </div>
              )}

              {/* Titre (fichier unique) */}
              {files.length <= 1 && (
                <div>
                  <label htmlFor="upload-doc-title" className={labelClass}>
                    Titre
                  </label>
                  <input
                    id="upload-doc-title"
                    type="text"
                    required
                    placeholder="Ex. Contrat de bail 2026"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={fieldClass}
                  />
                </div>
              )}

              {/* Catégorie & dossier */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="upload-category" className={labelClass}>
                    Catégorie
                  </label>
                  <select
                    id="upload-category"
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Aucune</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {!groupInNewFolder && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="upload-folder"
                        className="text-sm font-medium text-[#141414]/80"
                      >
                        Dossier
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsCreatingFolder((prev) => !prev)}
                        className={linkButtonClass}
                      >
                        {isCreatingFolder ? 'Dossier existant' : 'Nouveau dossier'}
                      </button>
                    </div>

                    {isCreatingFolder ? (
                      <input
                        id="upload-folder"
                        type="text"
                        required
                        placeholder="Nom du dossier"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        className={fieldClass}
                      />
                    ) : (
                      <select
                        id="upload-folder"
                        value={selectedFolderId}
                        onChange={(e) => setSelectedFolderId(e.target.value)}
                        className={fieldClass}
                      >
                        <option value="">Racine (sans dossier)</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="upload-description" className="text-sm font-medium text-[#141414]/80">
                    Description <span className="font-normal text-[#141414]/40">(facultatif)</span>
                  </label>
                  <span
                    className={`text-xs tabular-nums ${
                      description.length >= 200 ? 'text-red-600' : 'text-[#141414]/40'
                    }`}
                  >
                    {description.length}/200
                  </span>
                </div>
                <textarea
                  id="upload-description"
                  rows={2}
                  maxLength={200}
                  placeholder="Notes, mots-clés ou contexte"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-[#141414]/20 text-sm text-[#141414] placeholder:text-[#141414]/40 hover:border-[#141414]/40 focus:border-[#4a6cf0] focus:ring-4 focus:ring-[#4a6cf0]/15 focus:outline-hidden transition resize-none"
                />
              </div>

              {/* Progression */}
              {uploadProgress !== null && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span
                      className={`flex items-center gap-1.5 ${
                        uploadSuccess ? 'text-emerald-700 font-medium' : 'text-[#141414]/65'
                      }`}
                    >
                      {uploadSuccess && <CheckCircle2 className="w-4 h-4" />}
                      {uploadSuccess ? 'Document envoyé pour validation' : 'Envoi en cours…'}
                    </span>
                    <span className="text-[#141414]/55 tabular-nums">
                      {Math.round(uploadProgress)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-[#141414]/5 overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${
                        uploadSuccess ? 'bg-emerald-600' : 'bg-[#4a6cf0]'
                      }`}
                      initial={{ width: '0%' }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ ease: 'easeOut', duration: 0.15 }}
                    />
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-[#141414]/10">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onClose}
                  className="h-10 px-4 rounded-full text-sm font-medium text-[#141414]/80 hover:bg-[#141414]/5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={files.length === 0 || isBusy || uploadSuccess}
                  className="h-10 px-5 rounded-full bg-[#4a6cf0] text-[#f1ece4] text-sm font-medium hover:bg-[#3d5ed8] active:bg-[#3552c0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff6a2b]"
                >
                  Déposer
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
