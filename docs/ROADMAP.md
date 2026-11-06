# Roadmap de correction et de validation — AmphixDocs

> **PHASE 2 AUTORISÉE.** Le feu vert explicite porte sur les corrections locales, par lots vérifiés. Priorités demandées : compteur TypeScript, relations `documents`/`folders` vers `profiles` avec une nouvelle `migration_v3.sql`, resserrement RLS/Storage, erreurs réelles, progression honnête, puis les autres travaux ci-dessous. Les scripts SQL déjà appliqués restent intacts ; les migrations seront exécutées manuellement par l’utilisateur. Aucune opération distante ni aucun déploiement n’est autorisé par ce feu vert.

Références : [ARCHITECTURE.md](ARCHITECTURE.md), [CHECKLIST_MANUELLE.md](CHECKLIST_MANUELLE.md), [CLAUDE.md](../CLAUDE.md).

## 1. Règles d’exécution

- **P0** : blocages techniques, sécurité des droits, fiabilité des données et résultats trompeurs. À traiter avant toute qualification de production.
- **P1** : conformité des parcours, mobile, accessibilité, français et PWA.
- **P2** : outillage durable, performance, maintenance et préparation d’une livraison vérifiée.
- Difficulté **S** : correction localisée ; **M** : plusieurs composants ou contrats ; **L** : coordination SQL/Storage/serveur ou validation multi-session. Ce sont des niveaux de complexité, pas des promesses de durée.
- Après **chaque étape d’implémentation** : `npx tsc --noEmit`, puis `npm run build`, puis le lint et les tests concernés lorsqu’ils existent. Corriger les échecs avant de poursuivre. Le lint actuel est un alias de TypeScript ; un build réussi ne valide ni les types, ni OAuth, ni les RLS.
- Ajouter les tests de non-régression ciblés au fil des corrections ; ne pas attendre P2 pour vérifier un défaut de sécurité ou un échec partiel.
- Cocher une tâche **uniquement quand son implémentation et tous ses critères requis sont vérifiés**. Si une recette distante n’est pas autorisée/disponible, noter « réalisé localement, validation externe en attente » sans cocher la tâche entière.
- Le feu vert sur le code local ne vaut pas autorisation de modifier un projet Supabase, de lancer du SQL distant, de changer un provider OAuth ou de déployer. Demander l’autorisation adaptée à ces opérations au moment nécessaire.
- Windows/PowerShell et npm/`package-lock.json`. Pas de réinstallation pour masquer une erreur, pas de `npm audit fix --force`, pas de `npm run clean` pendant l’analyse.
- Préserver esbuild **`^0.28.0`**. Toute modification de cette version ou résolution forcée demande un accord séparé. Ne supprimer aucun fichier, aucun lockfile et aucune dépendance implicitement.
- Ne jamais modifier `components/ui/sticker-slap-footer.tsx` ou son re-export pour contourner les contraintes. Footer configuré uniquement par les props de son appel, sans réseaux sociaux ni credits.
- Aucun secret dans les sources, les logs ou les preuves. Les variables `VITE_*` sont publiques ; aucune clé `service_role`, privée Google ou Gemini dans le navigateur.
- Préserver DM Sans, la palette, les arrondis et les animations via `motion/react`, tout en respectant reduced-motion et l’accessibilité. Tailwind reste en v4 ; l’alias `@/*` reste interprété selon sa configuration réelle vers la racine.
- Après les modifications de code, utiliser `python -m graphify . --update`, jamais un rebuild complet. Le graphe local existe désormais. La mise à jour historique `--update --code-only` avait réussi (314 nœuds, 742 liens), après un échec d’extraction complète faute de clé pour les documents/images. Les SQL n’étaient pas indexés faute de `tree_sitter_sql` : leurs vérifications restent ciblées et distinctes du graphe. **Pour le delta de reprise du 5 novembre 2026, aucune mise à jour n’est encore confirmée** : les dernières tentatives ont été bloquées avant lancement par l’indisponibilité du classificateur de permissions. Ne pas présenter ce graphe historique comme synchronisé avec les nouveaux contrats.

### État du sous-lot de reprise — 5 novembre 2026

Ce sous-lot remet en cohérence les contrats locaux interrompus ; il **ne termine pas les P0 globaux et ne contourne pas leurs dépendances serveur**. Les validations externes de P0-02, le protocole durable de P0-05 et les décisions produit restent requis avant de qualifier le dépôt complet.

- [x] Stabiliser l’orchestration de dépôt et son journal local : identités figées, bilan cumulatif, reprise des seuls échecs dans un lot en mémoire, revérification de toutes les identités restaurées et protection d’une autre trace. **27 tests de module réussis** ; ni transfert Supabase réel ni concurrence atomique entre onglets démontrés.
- [x] Vérifier le contrôleur atomique de bibliothèque : lectures obsolètes, mutations confirmées pendant une lecture, rapports répétés, suppressions et scopes compte/projet/génération. **21 tests de module réussis** ; cela ne teste pas React StrictMode ou les effets du dashboard dans un DOM.
- [x] Remettre le runner relations/modération/reprises en cohérence avec les helpers actuels : **18 tests API simulés réussis**, dont huit scénarios de réponse perdue, conflit ou scope Auth incompatible. Les dix tests historiques de relations/modération sont conservés.
- [x] Revérifier les sources par `npx tsc --noEmit`, `npm run build` et `npm run lint`, et exécuter les **six contrôles SQL textuels**. Le run groupé termine à **72/72**, sans avertissement WebSocket et avec fermeture normale des runners ; ceux-ci isolent Vite avec `configFile: false`, `envDir: false`, `hmr: false` et `ws: false`.
- [ ] Vérifier directement configuration/Auth, guards et raccordement React du dashboard/modal : montages/nettoyages StrictMode, changement de compte/projet/rôle, erreurs et focus réel. Ces parcours ne sont pas couverts par les 72 tests.
- [ ] Actualiser le delta Graphify par mise à jour incrémentale et conserver son résultat ; aucune réussite actuelle ne peut être déduite de l’ancien graphe.

**État du code local :** contrat `Database` conservateur dérivé des SQL versionnés, client Supabase nullable et configuration URL/clé atomique ; session et rôle explicites sans succès démo de secours ; dépôt UUID/chemin/SHA-256, réconciliation Storage/SQL et modal consommant `UploadBatchReport` ; dashboard raccordé au contrôleur et affichant chargement/erreur/réessai. Ces changements sont réalisés localement, mais le contrat `Database` n’a pas été comparé au schéma installé et OAuth/RLS/Storage réels restent non vérifiés. Les erreurs et confirmations de l’administration complète restent à recetter.

**Résultat du build :** service worker généré, chunk principal **833,99 kB** (**243,24 kB gzip**) ; avertissements de taille > 500 kB et de durée de callbacks PWA persistants. Le lint reste un alias TypeScript, pas ESLint. Aucun changement de dépendance/lockfile/esbuild, aucun changement du footer protégé, aucune opération distante ou suppression de fichier dans ce sous-lot.

Détails des contrats et limites : [ARCHITECTURE.md, section 13](ARCHITECTURE.md#13-reprise-locale-des-contrats--5-novembre-2026). Les nouvelles recettes de journal, scopes et focus restent décochées dans [CHECKLIST_MANUELLE.md](CHECKLIST_MANUELLE.md).

## 2. Ordre et dépendances

| Ordre | ID | Étape | Priorité | Difficulté | Dépendances principales |
| --- | --- | --- | --- | --- | --- |
| 1 | P0-01 | Rétablir le contrôle TypeScript | P0 | S | Feu vert phase 2 |
| 2 | P0-02 | Aligner SQL, relations, types et frontières de droits | P0 | L | P0-01 ; décisions de contrat et environnement de test pour la recette |
| 3 | P0-03 | Séparer production/démo et fiabiliser configuration/session/rôle | P0 | M | P0-02 pour le contrat profiles |
| 4 | P0-04 | Propager les erreurs et confirmer les opérations effectives | P0 | M | P0-02, P0-03 |
| 5 | P0-05 | Rendre les suppressions Storage/SQL récupérables | P0 | L | P0-02, P0-04 ; frontière serveur autorisée |
| 6 | P0-06 | Finaliser le dépôt réel, les lots et la progression honnête | P0 | L | P0-02 à P0-05 |
| 7 | P0-07 | Fiabiliser modération, approbation collective et rôles | P0 | L | P0-02 à P0-04 ; décisions de modération/rôles |
| 8 | P1-01 | Réparer recherche, accueil action d’abord et navigation mobile | P1 | M | P0-04, P0-06 |
| 9 | P1-02 | Compléter les interactions et dialogues accessibles | P1 | L | Parcours P0 et P1-01 stabilisés |
| 10 | P1-03 | Respecter reduced-motion et le français sans contourner le footer | P1 | M | P1-02 ; décision sur la traduction du footer |
| 11 | P1-04 | Fiabiliser la PWA et ses promesses | P1 | M | P0-03, P0-04 ; recette de deux builds |
| 12 | P2-01 | Installer un socle de qualité et une pipeline reproductible | P2 | M | Tests ciblés des étapes précédentes |
| 13 | P2-02 | Mesurer et réduire le coût du chargement | P2 | M | Parcours fonctionnels et P2-01 |
| 14 | P2-03 | Réconcilier maintenance, ressources et documentation | P2 | M | Décisions de dépendances et de ressources |
| 15 | P2-04 | Réaliser la recette finale et préparer une livraison autorisée | P2 | L | Toutes les étapes requises et autorisations externes |

L’ordre n’autorise pas à contourner une dépendance bloquée. Une étape peut être subdivisée en sous-lots cohérents avec les mêmes contrôles, sans déclarer achevée une validation non exécutée.

## 3. P0 — fiabilité et sécurité avant production

### P0-01 — Rétablir TypeScript

- [x] **Corriger le contrat de compteur des dossiers.**

**Résultat du lot :** les deux accès utilisent `document_count ?? 0`. `npx tsc --noEmit`, `npm run build` (service worker inclus) et `npm run lint` ont terminé avec succès. Le rendu React du composant réel a été vérifié pour compteur absent, 0, 1 et 3 fichiers. L’avertissement de taille du chunk principal (~802,85 kB) persiste et relève de P2-02 ; aucune recette visuelle sur appareil n’a été exécutée.

**Difficulté : S.** Fichiers : `src/components/mobile/MobileDashboardHero.tsx`, contrat `FolderItem` dans `src/lib/supabase.ts`.

**Constat :** `MobileDashboardHero.tsx:39` lit deux fois `file_count`, absent de `FolderItem`, qui expose `document_count`. TypeScript et le lint terminent en erreur ; Vite ne détecte pas ce défaut.

**Actions :** utiliser le contrat de compteur existant, vérifier singulier/pluriel et absence de valeur. Ne pas ajouter un cast ou une propriété fantôme pour masquer l’erreur.

**Critères de validation :**
- `npx tsc --noEmit`, `npm run build` et `npm run lint` réussissent séparément.
- Compteurs 0, 1 et plusieurs fichiers rendus correctement sur les vues concernées.
- Aucun changement d’esbuild, de lockfile ou de footer.

### P0-02 — Alignement SQL/PostgREST/types et droits effectifs

- [ ] **Définir et implémenter un contrat serveur sûr, puis le vérifier avec des sessions ordinaires et admin.**

**Sous-lots locaux vérifiés — la tâche globale reste ouverte :**
- [x] Préparer V3 et les quatre sélections auteurs explicites ; vérifier les requêtes et leur mapping avec des réponses API simulées.
- [x] Préparer `supabase/migration_v4.sql` : droits par colonne, triggers de modération, contraintes document, gardes RLS/Storage et contrôle des cascades dossier. Six contrôles textuels réussis ; **aucune exécution PostgreSQL effectuée**.
- [x] Adapter la modération au calcul serveur du reviewer/de la date, confirmer les identifiants affectés et limiter l'approbation collective aux cibles du filtre ; erreurs et succès partiels affichés. Dix tests locaux de relations/modération réussis.
- [ ] Vérifier V3/V4 sur une base de test, leur réexécution, les privilèges effectifs, les accès SQL/Storage et la concurrence avec A/B/admin ; terminer le contrat `Database`/nullabilité et les décisions restantes.

**Difficulté : L.** Fichiers : `supabase/schema.sql` et `supabase/migration_v2.sql` (historiques inchangés), `supabase/migration_v3.sql`, `supabase/migration_v4.sql`, `src/lib/supabase.ts`, types Supabase à prévoir.

**Constats :** jointures `profiles:user_id` sans FK directe déclarée ; nullabilité SQL/types divergente ; UPDATE propriétaire permettant de modifier les statuts et colonnes privilégiées ; absence de contraintes de cohérence ; droits Storage/SQL asymétriques.

**Actions :**
1. Inventorier les tables, contraintes, fonctions et **toutes** les policies de l’environnement de test autorisé. Comparer à la séquence `schema.sql` puis `migration_v2.sql`, sans rejouer aveuglément ces scripts sur une base existante.
2. Préparer une migration corrective non destructive, tenant compte des données et profils existants. Ne pas effacer l’historique ni supprimer des fichiers SQL pour rendre l’état plus simple.
3. Choisir une relation ou projection PostgREST valide pour les auteurs. Respecter les RLS de profiles et le contrat des champs publiables ; ne pas exposer l’e-mail de toutes les personnes par une vue privilégiée pour réparer une jointure.
4. Aligner les types sur les colonnes et leur nullabilité. Utiliser un contrat `Database` vérifié et supprimer les casts qui cachent une incompatibilité, sans activer toutes les options strictes en un changement aveugle.
5. Interdire aux comptes ordinaires les changements de statut, reviewer, dates de revue, propriétaire et chemin Storage privilégié. Une simple policy `USING (propriétaire OR admin)` ou un WITH CHECK sur le propriétaire ne suffit pas à protéger les colonnes.
6. Encadrer la modération par une opération serveur à périmètre explicite, avec vérification du rôle et métadonnées de revue fiables. Choisir des droits par colonne, triggers ou fonctions ciblées adaptés au contrat ; ne jamais dépendre seulement du guard React.
7. Renforcer les contraintes pertinentes : description ≤ 200 caractères, taille non négative/≤ 20 Mo dans les métadonnées, statuts et références cohérents. Le bucket conserve sa propre limite de 20 Mo ; SQL ne mesure pas les octets de l’objet à sa place.
8. Définir la cohérence objet/propriétaire/`file_path` et les droits de dépôt dans un dossier existant. Clarifier le comportement d’un dossier approuvé contenant des documents encore pending/rejected avant d’imposer une règle produit non donnée.

**Critères de validation :**
- Les requêtes de catégories, bibliothèque, création de dossier et retour d’insertion fonctionnent sans erreur de relation sur le schéma de test validé.
- Avec A/B/admin : A voit ses pending/rejected, B ne voit que les éléments approved qui leur sont accessibles, admin voit et modère selon le contrat.
- A/B ne peuvent pas modifier une colonne de modération, promouvoir leur rôle ou fabriquer une référence permettant un accès indu à un objet.
- Les accès SQL **et** Storage aux éléments privés/approuvés sont vérifiés séparément, sans clé privilégiée à la place d’un JWT ordinaire.
- Les contraintes rejettent les métadonnées invalides sans laisser d’état incohérent dans le parcours de dépôt.
- Les anciennes policies réellement installées n’élargissent pas les droits via leur combinaison permissive par OR.
- Contrôles locaux réussis et résultats de recette conservés sans secrets. Sans accès distant autorisé, cette étape reste partiellement non vérifiée.

### P0-03 — Production, configuration et état d’authentification honnêtes

- [ ] **Retirer les faux résultats de production et rendre session/rôle/configuration explicites.**

**Difficulté : M.** Fichiers : `src/lib/supabase.ts`, `src/context/AuthContext.tsx`, `src/components/SupabaseConfigModal.tsx`, `ProtectedRoute.tsx`, `AdminRoute.tsx`, `.env.example`.

**Actions :**
- Séparer explicitement mode réel et démonstration. Une erreur du mode réel ne doit jamais charger des utilisateurs, catégories ou documents de fixtures.
- Retirer le contournement `amphix_force_admin` du calcul du rôle de production. Les guards utilisent le profil vérifié ; conserver les RLS comme autorité réelle.
- Ne pas permettre aux identifiants démo non UUID de rejoindre les mutations du mode réel. Identifier visuellement toute démonstration conservée ; ne pas la présenter comme une connexion Google.
- Remplacer l’heuristique de configuration trompeuse : distinguer non configuré, valeurs invalides, configuration saisie, service inaccessible et session vérifiée. Rejeter les placeholders de `.env.example` ; ne pas afficher « Connecté » sur un simple format HTTPS.
- Clarifier la priorité des valeurs localStorage/environnement et offrir une récupération sûre d’une ancienne configuration locale. Protéger les accès au stockage navigateur contre les exceptions.
- Séparer chargement de session et chargement de rôle/profil ; ne pas rediriger un compte admin avant la résolution du rôle. Rendre les erreurs actionnables au lieu de les convertir silencieusement en `user`.
- Ignorer les réponses de rôle devenues obsolètes après changement de compte/déconnexion. Prévoir un rafraîchissement réel après un changement de rôle.
- Retirer les références de projet/adresse codées en dur des instructions concernées au profit de placeholders/configuration publique. Distinguer callback Google → Supabase et retour applicatif → `/dashboard`.
- Traiter les erreurs de connexion/déconnexion et le cas iframe/popup sans journaliser de jeton. N’inventer ni clés ni état du provider distant.

**Critères de validation :**
- Configuration absente, placeholders français, valeurs invalides, stockage navigateur bloqué et panne réseau : aucun faux badge connecté, aucune fixture utilisée comme donnée de production.
- `amphix_force_admin` ne confère plus le rôle React en mode réel.
- Visite directe de `/admin` avec un profil admin : attente du rôle puis accès ; avec user : refus attendu ; avec erreur de profil : message et réessai, pas conclusion trompeuse.
- Changement rapide de compte ou déconnexion pendant le chargement : aucune réponse tardive ne rétablit l’ancien rôle.
- Connexion Google, retour, restauration de session et déconnexion testés sur un environnement autorisé ; erreurs et cas iframe documentés réellement.
- Contrôles locaux et tests ciblés réussis. Les manipulations Google/Supabase restent décochées tant qu’elles n’ont pas été exécutées.

### P0-04 — Erreurs, chargement et confirmation des mutations

- [ ] **Supprimer les tableaux vides/faux succès issus d’erreurs ignorées.**

**Difficulté : M.** Fichiers : `src/lib/supabase.ts`, `DashboardPage.tsx`, `AdminPage.tsx`, cartes, `PendingList.tsx`, `UsersTable.tsx`.

**Actions :**
- Examiner chaque résultat `{ data, error }` du SDK, notamment bibliothèque, catégories, utilisateurs, comptages, opérations collectives et compensation Storage. Le SDK n’émet pas une exception pour toute erreur.
- Définir des résultats/erreurs typés cohérents et distinguer collection vide, chargement, erreur et réussite.
- Pour UPDATE/DELETE, confirmer les identifiants ou lignes effectivement affectés selon l’opération. Une réponse sans erreur et zéro ligne touchée n’est pas une preuve de succès.
- Rendre `loadingDocs` et les chargements admin visibles ; présenter une erreur en français avec une action Réessayer, sans remplacer les données par des fixtures.
- Propager les erreurs d’ouverture, édition, suppression et modération jusqu’à l’utilisateur ; ne pas se contenter de `console.error`.
- Conserver les données/formulaires nécessaires après échec. Ne retirer un élément de l’interface qu’après confirmation de l’opération complète.

**Critères de validation :**
- Réponses SDK avec `error`, exceptions, réponse vide et absence réelle de résultats testées séparément.
- Une lecture refusée ne devient ni « bibliothèque vide », ni « aucune demande », ni liste de personnes démo.
- Une mutation refusée ou n’affectant aucune cible ne retire pas un élément et n’affiche pas de succès.
- Réessai fonctionnel sans doublon et sans perte de saisie ; chargement visible et messages sans données sensibles.
- Contrôles locaux et tests de non-régression des helpers/composants réussis.

### P0-05 — Suppressions document/dossier et reprise Storage/SQL

- [ ] **Éviter les objets orphelins, les lignes sans fichier et les suppressions admin mensongères.**

**Difficulté : L.** Fichiers : `src/lib/supabase.ts`, `DashboardPage.tsx`, `FileCard.tsx`, `FolderCard.tsx`, SQL/policies et éventuelle opération serveur à créer après choix d’architecture.

**Actions :**
- Définir un protocole de suppression avec suivi des étapes et reprise. Storage et SQL ne partagent pas une transaction ; ne pas promettre un rollback garanti d’un fichier déjà supprimé.
- Pour un dossier, conserver les chemins et l’état de l’opération **avant** la cascade SQL, afin de pouvoir nettoyer/reprendre les objets après un échec ou une interruption.
- Vérifier les résultats de chaque suppression Storage et SQL, y compris leur périmètre et l’existence réelle des cibles.
- Aligner le droit admin de suppression des objets avec celui des métadonnées, via des policies limitées au bucket/opération ou une frontière serveur contrôlée. Si un secret privilégié est nécessaire côté serveur, il reste uniquement dans ses secrets serveur et n’est jamais envoyé au navigateur.
- Gérer reprise, objets déjà absents et résultat indéterminé après perte de réponse. L’état UI doit refléter l’opération incomplète et proposer une récupération ; ne pas masquer un objet orphelin par un succès SQL.
- Réconcilier les compteurs et données du dashboard seulement après résultat confirmé.

**Critères de validation :**
- Suppression par propriétaire et par admin d’un document puis d’un dossier contenant plusieurs fichiers : lignes et objets attendus absents après confirmation.
- Compte B non autorisé : SQL et Storage refusent les suppressions.
- Pannes injectées Storage seul, SQL seul, milieu du lot, réponse perdue et reprise : état récupérable, aucun succès mensonger, aucun retrait prématuré de l’interface.
- Le protocole de reprise reste utilisable après rechargement ; il ne dépend pas seulement d’une variable en mémoire si l’opération a déjà produit des effets distants.
- Aucun objet non ciblé supprimé ; tests dans un projet de test explicitement autorisé.
- Contrôles locaux et tests des scénarios partiels réussis.

### P0-06 — Dépôt complet et progression honnête

- [ ] **Finaliser le parcours réel, y compris plusieurs fichiers et une reprise partielle.**

**Difficulté : L.** Fichiers : `UploadModal.tsx`, `src/lib/supabase.ts`, `DashboardPage.tsx`, contraintes SQL/Storage concernées.

**Actions :**
- Supprimer le pourcentage alimenté par minuteur en mode réel. Afficher des étapes honnêtes « préparation / transfert / enregistrement » et un état indéterminé si l’API ne fournit pas les octets ; afficher un pourcentage seulement s’il est mesuré.
- N’afficher un succès final qu’après confirmation de l’objet **et** des métadonnées.
- Valider fichier, taille, titre, description et destination aux niveaux appropriés ; conserver le contrôle serveur en plus de l’UI.
- Faire remonter **tous** les documents réussis, le dossier créé et les résultats/erreurs par fichier. Mettre à jour les compteurs sans doublon, pas seulement le dernier fichier du lot.
- Définir la reprise des fichiers en échec sans recommencer les succès. Utiliser des identifiants stables et une réconciliation lorsque le résultat d’une écriture est indéterminé.
- Ne pas supprimer aveuglément un objet en compensation s’il peut déjà être référencé par une insertion SQL réussie dont la réponse a été perdue. Vérifier le résultat et rendre l’échec de compensation récupérable.
- Traiter le dossier créé mais vide en cas d’échec, sans effacer un dossier contenant des succès ou un élément qui n’est pas la propriété de cette opération.
- Nettoyer les timers/ressources dans tous les chemins. Verrouiller les contrôles nécessaires pendant le transfert et éviter les réinitialisations dues à un changement de référence `categories`.
- Pour toute démo conservée : annoncer son caractère non durable et gérer la durée de vie des URL de blobs ; elle ne doit pas servir de preuve de transfert Supabase.

**Critères de validation :**
- Drag-and-drop et sélection/capture mobile, un fichier et plusieurs fichiers, dossier existant/nouveau, catégorie et description testés.
- Fichier de 20 Mo accepté, au-delà refusé ; description 200 caractères acceptée, dépassement rejeté aux niveaux pertinents.
- Réseau lent ou bloqué : progression non fictive, erreur explicite, fermeture/transfert gérés sans état ambigu.
- Trois fichiers réussis apparaissent une fois chacun ; un échec au milieu restitue les succès et permet une reprise sans duplication.
- Échecs de dossier, Storage, SQL, compensation et réponse perdue testés ; bilan fidèle et récupération possible.
- Fichiers nouvellement créés pending ; visibilité auteur/autres/admin conforme aux RLS validées.
- Contrôles locaux et tests ciblés réussis ; dépôt Supabase réel vérifié seulement sur environnement autorisé.

### P0-07 — Modération, approbation collective et rôles

- [ ] **Rendre chaque opération administrative exacte, autorisée et traçable.**

**Difficulté : L.** Fichiers : `PendingList.tsx`, `UsersTable.tsx`, `AdminPage.tsx`, `src/lib/supabase.ts`, SQL/opérations serveur concernées.

**Actions :**
- Valider le motif de refus selon le contrat retenu et distinguer refus de fichier/refus de dossier. Présenter les erreurs de façon actionnable.
- Finaliser l’aperçu fichier et dossier avec les droits effectifs ; gérer format non prévisualisable et URL signée expirée sans faux aperçu.
- Pour l’approbation collective, transmettre les **identifiants effectivement annoncés dans la confirmation**, selon les filtres actifs. Ne pas approuver tous les pending des deux tables lorsque le message annonce un sous-ensemble.
- Examiner chaque résultat ; utiliser une transaction SQL ciblée si l’opération doit être atomique, sinon présenter explicitement les succès/échecs partiels et leur reprise.
- Enregistrer de façon fiable reviewer/date/motif pour les ressources qui en ont besoin et rendre leur contrat SQL/TypeScript cohérent. Ne pas prétendre que folders possède déjà les colonnes de revue.
- Vérifier les promotions/rétrogradations via les RLS/opérations serveur ; confirmer les profils affectés et le rafraîchissement du rôle.
- Décider puis implémenter la règle du dernier admin et de la rétrogradation de soi-même. Le verrou UI actuel n’est pas une règle serveur.
- Clarifier la source de « dernière connexion » et l’identification des inscriptions Google ; ne pas étiqueter tous les profils comme Google sans donnée fiable. Réparer les erreurs de comptage et retirer les fallbacks démo en mode réel.

**Critères de validation :**
- A/B ne modèrent ni ne changent un rôle ; admin peut réaliser les opérations prévues, avec persistance après rechargement.
- Motif conservé et visible pour l’auteur ; métadonnées de revue fiables ; règles dossier/document cohérentes avec la décision produit.
- Avec le filtre « fichiers » ou « dossiers », approbation collective : seules les cibles confirmées changent, le compteur correspond au résultat, les autres pending restent inchangés.
- Refus SQL ou succès partiel : pas de message « tout approuvé » ; reprise et liste reflètent les résultats effectifs.
- Règle choisie pour dernier admin/soi-même vérifiée côté serveur avec des sessions réelles de test.
- Inscriptions, comptages et dates affichés selon leur source véritable, sans fixtures de secours.
- Contrôles locaux et recette A/B/admin de la checklist réussis. Ne pas cocher si une décision métier ou une validation externe requise manque.

## 4. P1 — parcours, mobile, accessibilité et PWA

### P1-01 — Recherche, accueil action d’abord et navigation mobile

- [ ] **Relier les cinq actions mobiles à un état cohérent du dashboard et rendre tous les résultats trouvables.**

**Difficulté : M.** Fichiers : `DashboardPage.tsx`, `AdminPage.tsx`, `SearchHero.tsx`, `MobileDashboardHero.tsx`, `MobileNav.tsx`, `CategoryChips.tsx`, `FolderView.tsx`, `EmptyState.tsx`.

**Actions :**
- À l’accueil, desktop **et mobile** : seulement grande recherche et bouton de dépôt. Catégories, dossiers et fichiers apparaissent après recherche, conformément au contrat.
- Remplacer la chaîne espace trimée par des états/navigation explicites : Accueil, Recherche, Dossiers, Profil et dépôt. La source de vérité choisie doit piloter contenu, focus et onglet actif, pas des hashes inertes.
- Depuis `/admin`, les actions ouvrent réellement l’état attendu sur `/dashboard`. Conserver le parcours `location.state.openUpload` ou son remplacement cohérent.
- Inclure les fichiers correspondant à la recherche même lorsqu’ils sont dans un dossier au nom différent ; afficher leur contexte et permettre d’ouvrir le dossier/fichier.
- Aligner la promesse de recherche par catégorie sur le comportement effectif. Distinguer absence de résultats et erreur ; corriger le texte de l’état vide.
- Réconcilier les compteurs après dépôt/modération/suppression ; rendre toute carte affichée interactive selon son action réelle.
- Tester safe areas, navigation fixe, clavier ouvert, scroll interne et absence de débordement horizontal à 320 px.

**Critères de validation :**
- Accueil avant recherche conforme sur desktop et mobile ; effacer la requête ramène à cet état.
- Recherche ouvre et focalise un champ monté ; Dossiers ouvre le bon contenu ; Accueil réinitialise correctement ; Profil et « + » fonctionnent aussi depuis admin.
- Onglet actif annoncé et synchronisé avec le contenu, y compris après retour navigateur et changement de route.
- Un fichier rangé dans un dossier non correspondant reste trouvable ; catégorie et ouverture de dossier fonctionnent avec les données réelles.
- Pas d’écran vide dû à un hash/whitespace ; pas de navigation recouverte par le clavier ou les safe areas.
- Contrôles locaux et tests de navigation/recherche réussis.

### P1-02 — Accessibilité des interactions, formulaires et dialogues

- [ ] **Compléter le contrat clavier, focus, labels et annonces sur les parcours branchés.**

**Difficulté : L.** Fichiers : cartes et badges, `UploadModal.tsx`, `SupabaseConfigModal.tsx`, `PendingList.tsx`, `UsersTable.tsx`, `AdminPage.tsx`, composants mobile/PWA concernés. Le footer protégé reste hors modification.

**Actions :**
- Remplacer les zones interactives non sémantiques par boutons/liens adaptés, sans créer d’éléments interactifs imbriqués. Ajouter labels associés, noms des boutons icônes et focus visible.
- Annoncer catégories sélectionnées, onglets/panels, progression/étapes, erreurs et mises à jour. Ne pas utiliser un tooltip au survol comme seule source du motif de refus.
- Dialogues et bottom sheets : nom, focus initial, confinement, fermeture Échap lorsqu’elle est sûre, restauration du focus et fond non interactif.
- Préserver le scroll de fond et les verrous existants, notamment si plusieurs interfaces sont ouvertes. Tester navigation entre dialogues et clavier virtuel.
- Rendre la face inactive d’une carte 3D non interactive/non exposée aux technologies d’assistance.
- Compléter les confirmations et popovers admin/profil ; annoncer les contrôles désactivés pendant une opération plutôt que piéger silencieusement l’utilisateur.

**Critères de validation :**
- Dépôt, recherche, ouverture, édition, suppression, modération et rôle utilisables intégralement au clavier.
- Focus conservé dans le dialogue et restauré au déclencheur ; Échap/backdrop/swipe ne produisent pas une interruption dangereuse.
- Noms, états sélectionnés, erreurs, motifs et progression intelligibles par lecteur d’écran.
- Aucun élément caché de carte 3D dans l’ordre de tabulation ; aucun scroll de fond inattendu ni perte de verrou.
- Recette à 320 px, zoom, clavier ouvert et safe areas ; contrôles locaux/tests concernés réussis.
- Les limites non paramétrables du footer sont consignées séparément : ne pas déclarer l’ensemble du site totalement accessible/français tant qu’une exigence reste bloquée.

### P1-03 — Reduced-motion, français et contrainte du footer

- [ ] **Couvrir les animations actives et les textes contrôlables, sans modifier le footer protégé.**

**Difficulté : M.** Fichiers : `App.tsx`, `PageTransitionOverlay.tsx`, cartes, loaders/badges, `UsersTable.tsx`, sections landing, `GlyphPortal.tsx`, composants PWA, `src/index.css`, appel du footer dans `LandingPage.tsx`.

**Actions :**
- Adopter une politique reduced-motion cohérente pour CSS et JavaScript : loops, compteur, springs, flips 3D, transitions et scroll. Une animation fonctionnelle peut avoir une alternative instantanée/statique plutôt que disparaître avec son contenu.
- Traduire les textes visibles et annonces accessibles contrôlables, notamment celles du portail et des erreurs.
- Configurer le footer uniquement via les props disponibles ; retirer le patch DOM `MutationObserver` de la landing dans le cadre d’une correction autorisée, sans le remplacer par un contournement.
- Maintenir `socials={[]}`, `credits={[]}`, la palette et les textes français paramétrables.
- **Décision requise :** l’API du footer ne permet pas de traduire toutes ses chaînes internes. Documenter les résidus et demander un arbitrage explicite sur le contrat ; ne pas supposer une permission de modifier l’implémentation ou le re-export.

**Critères de validation :**
- Préférence reduced-motion activée avant/après chargement : pas de boucles/rotations/flip imposés sur les parcours testés ; contenus et actions restent disponibles.
- Sans reduced-motion, identité visuelle, springs et interactions préservés.
- Textes contrôlables et annonces en français ; footer sans réseaux sociaux ni credits, configuré uniquement par props.
- Aucun diff de `components/ui/sticker-slap-footer.tsx` ni de son re-export destiné à contourner la règle.
- Contrôles locaux et recette visuelle/clavier réussis. L’exigence de français intégral reste non cochée tant que la contradiction du footer n’a pas reçu de décision explicite et vérifiable.

### P1-04 — PWA fiable, privée et honnête

- [ ] **Valider installation/mise à jour/hors-ligne sans cache des appels Supabase.**

**Difficulté : M.** Fichiers : `src/hooks/usePWA.ts`, `App.tsx`, `InstallPrompt.tsx`, `UpdateToast.tsx`, `OfflinePage.tsx`, `vite.config.ts`, ressources/icônes uniquement si leur modification est autorisée.

**Actions :**
- Mutualiser le suivi PWA et le registre SW afin que App/installation/update partagent un état cohérent, avec listeners nettoyés.
- Protéger les préférences navigateur et rendre un échec d’enregistrement/mise à jour observable et récupérable.
- Tester installation disponible/indisponible, standalone, refus/report d’installation et instructions iOS/iPadOS sans prétendre couvrir un appareil non testé.
- Supprimer les promesses d’accès aux documents privés hors-ligne et de synchronisation durable tant que ces mécanismes n’existent pas. Préserver une page hors-ligne utile et un retour en ligne actionnable.
- Vérifier les règles de cache effectives pour Auth, REST, Storage, liens signés et temps réel, y compris tout domaine réellement configuré. Ne pas confondre `cacheControl` d’un objet Storage et stratégie du service worker.
- Tester mise à jour entre deux builds, annonce accessible et positionnement safe-top/safe-bottom. Ne pas prendre les options PWA de développement pour une recette de production.

**Critères de validation :**
- Recette sur build de production servi localement, puis environnement HTTPS autorisé pour les appareils concernés.
- Installation/lancement/start URL, session connectée et non connectée, mode standalone et cycle de mise à jour testés réellement.
- Aucun appel/résultat privé Supabase dans les caches applicatifs du SW ; aucune règle générique ne capture Auth/REST/Storage/signatures. Le temps réel ne doit pas être assimilé à une ressource à précacher.
- Hors-ligne affiche ce qui est réellement disponible, sans faux document ni file de synchronisation imaginaire ; reconnexion/réessai cohérents.
- Stockage navigateur bloqué : rendu et commandes utilisables ; erreur SW/update : message et récupération.
- Contrôles locaux et tests pertinents réussis ; appareils/domaines non testés explicitement signalés.

## 5. P2 — qualité durable et livraison mesurée

### P2-01 — Socle de tests, lint et pipeline

- [ ] **Rendre les validations reproductibles, sans les réduire au build Vite.**

**Difficulté : M.** Fichiers : `package.json`, configurations et tests à prévoir, éventuelle configuration CI à prévoir après autorisation du périmètre.

**Actions :**
- Consolider les tests ciblés introduits pendant P0/P1 : erreurs SDK, session/rôle, recherche/navigation, lots et compensations.
- Choisir un outillage adapté React/TypeScript et navigateur ; annoncer les dépendances nécessaires avant installation. Ne pas forcer esbuild ou supprimer un lockfile pour adapter l’outillage.
- Configurer un véritable lint si retenu, en conservant un script explicite de typecheck ; durcir progressivement les options TS sans masquer les erreurs par casts.
- Pipeline : typecheck, lint réel lorsqu’il existe, tests, build et contrôle des artefacts. Séparer les tests SQL/RLS nécessitant un environnement autorisé des mocks/unitaires.
- Maintenir la checklist manuelle pour OAuth, RLS, appareils et PWA : les mocks ne remplacent pas ces preuves.

**Critères de validation :**
- Scripts documentés et reproductibles avec npm/lockfile aligné sur une version Node compatible maintenue.
- Une erreur TypeScript ou un test de non-régression échoué bloque la pipeline même si Vite construit.
- Tests couvrant au minimum erreur normale du SDK, zéro ligne affectée, rôle obsolète, fichier en dossier recherché, dépôt partiel et suppression partielle.
- Aucun secret de production dans les tests/CI ; résultats de RLS distincts des tests avec client simulé.
- Tous les contrôles applicables réussissent ; ce qui dépend d’un service externe reste explicitement non vérifié sans accès autorisé.

### P2-02 — Performance et taille du chargement

- [ ] **Mesurer puis réduire le chunk principal sans dégrader les parcours.**

**Difficulté : M.** Fichiers : `App.tsx`, pages/composants lourds, `vite.config.ts` seulement si justifié, imports dépendants du diagnostic.

**Constat :** chunk principal `802,84 kB` minifié (`231,69 kB` gzip), avertissement Vite > 500 kB. Ce n’est pas une mesure runtime mobile.

**Actions :**
- Mesurer composition du bundle, chargement initial et navigation sur profil mobile/réseau lent défini.
- Évaluer chargement différé des routes/admin/interfaces lourdes avec états de chargement accessibles et cohérents.
- Réduire seulement les imports réellement coûteux/inutiles confirmés ; préserver les composants et animations requis.
- Comparer avant/après. Ne pas relever le seuil de warning comme unique correction.

**Critères de validation :**
- Rapport avant/après avec tailles et mesures de chargement selon le même protocole.
- Routes directes, chargements différés, retour navigateur, Auth et PWA sans régression ni flash de rôle erroné.
- Gain démontré ; objectif chiffré fixé après mesure, pas inventé pendant l’audit.
- Contrôles locaux et tests pertinents réussis.

### P2-03 — Dépendances, ressources et documentation d’exploitation

- [ ] **Réconcilier les instructions avec un état réellement vérifié.**

**Difficulté : M.** Fichiers : `README.md`, `package.json`, `package-lock.json`, `bun.lock`, `public/`, `scripts/generate-icons.js`, documents de référence.

**Actions :**
- Réconcilier les deux lockfiles avec le gestionnaire retenu avant toute utilisation de Bun. Préserver esbuild `^0.28.0` ; demander l’accord pour toute autre évolution concernée.
- Examiner les dépendances héritées (`@google/genai`, `express`, `dotenv`) et l’état extraneous observé. Retirer/modifier uniquement après justification et autorisation appropriée, pas pour faire disparaître une sortie d’audit.
- Décider du composant non branché `DocumentCard.tsx` et de la ressource d’intégration AI Studio publiée depuis `public/`. Ne supprimer aucun fichier sans accord ; `main.tsx` n’est pas un résidu à supprimer et le footer est utilisé.
- Vérifier les icônes existantes et le script de génération ; ne régénérer les PNG que si cette écriture est autorisée.
- Mettre le README à jour : Node réellement requis, Motion/Tailwind v4, scripts, ordre SQL, placeholders, procédures Google/Supabase et état de validation. Retirer les promesses « 100% prêt » non démontrées et l’adresse personnelle codée en dur des exemples.
- Synchroniser architecture/roadmap/checklist avec les corrections et leurs preuves, sans réécrire l’audit historique en faux succès.

**Critères de validation :**
- Installation future reproductible avec le lockfile choisi, sans changement d’esbuild non approuvé ni résolution forcée.
- Dépendances/ressources conservées ou retirées selon décision documentée ; aucune suppression implicite.
- Exemples exclusivement avec placeholders, aucune valeur de `.env` ni secret recopié.
- README distingue build, typecheck, lint, tests et recette externe ; instructions Windows compatibles.
- Icônes vérifiées sur les appareils indiqués seulement si cette recette a eu lieu.
- Contrôles locaux et tests concernés réussis après toute modification de code/configuration.

### P2-04 — Recette finale et préparation d’une livraison

- [ ] **Constituer les preuves de fonctionnement et de sécurité avant toute déclaration de disponibilité.**

**Difficulté : L.** Références : tous les parcours corrigés, [CHECKLIST_MANUELLE.md](CHECKLIST_MANUELLE.md), `vercel.json`, documentation d’exploitation.

**Actions :**
- Réaliser la checklist sur un projet de test identifié et autorisé, avec deux comptes ordinaires A/B et un compte admin.
- Valider configuration, OAuth, profils, règles SQL/Storage, dépôt, recherche, suppressions, modération, rôles et récupération des pannes.
- Réaliser la recette clavier/lecteur d’écran, reduced-motion, 320 px, iOS/Android, standalone et mise à jour PWA entre versions.
- Vérifier l’artefact public et les en-têtes SPA/cache du domaine de recette. Un `vercel.json` présent n’est pas une vérification d’hébergement.
- Rendre un bilan avec résultats, réserves, manipulations externes effectuées et non effectuées.
- **Déployer uniquement après autorisation adaptée.** Aucun Git init, commit, push ou PR sans demande. Avant un futur commit demandé, contrôler les exclusions `.env*`/secrets et créer une branche de travail si nécessaire selon les instructions du projet.

**Critères de validation :**
- Tous les P0/P1 requis satisfaits ou réserve explicitement acceptée après arbitrage du contrat, sans inventer une exception aux contraintes.
- Typecheck, build, lint et tests applicables réussissent ; preuves distinctes pour OAuth, RLS et Storage.
- Résultats de la checklist conservés avec environnement, scénario et issue, sans clé ni jeton.
- Aucun compte démo, pourcentage fictif ou instruction manuelle présenté comme résultat de production.
- Aucun secret privilégié dans le bundle livré ; appels Supabase hors cache applicatif ; reprises partielles testées.
- Livraison/publication non exécutée si elle n’a pas reçu son autorisation spécifique.

## 6. Décisions et accès à obtenir pendant la phase 2

Ce registre ne constitue **ni une demande de clés dans la conversation, ni une autorisation externe**. Il permet de ne pas inventer les informations manquantes.

| Sujet | Étapes concernées | Décision/preuve attendue |
| --- | --- | --- |
| Environnement de test et comptes A/B/admin | P0-02 à P0-07, P1-04, P2-04 | Projet identifié, périmètre et opérations distantes autorisées ; valeurs sensibles gérées hors logs/docs. |
| Profil d’auteur et confidentialité | P0-02 | Champs publiables et relation/projection autorisée ; ne pas exposer tous les e-mails pour réparer une jointure. |
| Dépôt dans un dossier existant | P0-02, P0-06 | Droits propriétaire/admin ou collaboration à préciser avant implémentation d’une règle nouvelle. |
| Statuts dossier/document et motif de refus | P0-02, P0-07 | Règle de cohérence et exigence de motif, y compris conséquences d’une modération du dossier. |
| Dernier admin et rôle de soi-même | P0-07 | Règle métier explicite, appliquée/testée côté serveur. |
| Frontière serveur et reprise Storage/SQL | P0-02, P0-05 à P0-07 | Mécanisme retenu, droits minimaux, durabilité des opérations et autorisation d’installation distante. |
| Français intégral du footer immuable | P1-03 | Arbitrage sur les exigences incompatibles avec l’API actuelle ; aucune modification/contournement supposé. |
| Outillage, dépendances, ressources et lockfiles | P2-01 à P2-03 | Choix documenté ; accord pour toute suppression, changement d’esbuild ou résolution forcée. |
| Graphe Graphify et limites | Toutes les étapes de code | Graphe existant actualisé en `--code-only` ; documents/images exclus et parseur SQL absent. Aucun rebuild complet ni installation implicite. |
| Domaine et déploiement | P2-04 | Autorisation séparée, configuration réelle et contrôle de l’artefact/en-têtes. |

## 7. Trace de validation par étape

À compléter seulement pendant une implémentation autorisée :

| Étape | Changements réalisés | Contrôles locaux | Recette externe / environnement | Résultat / réserve |
| --- | --- | --- | --- | --- |
| Phase 1 (historique) | Documents uniquement | TypeScript et lint en échec ; build réussi avec avertissement | Aucune opération externe exécutée | Audit conservé dans ARCHITECTURE.md |
| P0-01 | `file_count` remplacé par `document_count ?? 0` dans le hero mobile | TypeScript, build/PWA et lint réussis ; rendu React réel vérifié pour absent/0/1/3 | Aucune opération externe requise ou exécutée ; appareils non testés | Réalisé et vérifié localement ; avertissement bundle P2-02 conservé |
| P0-02 — relations auteurs | Quatre sélections ciblent explicitement `profiles` ; nouvelle `supabase/migration_v3.sql` avec backfill non destructif, FK nommées et notification PostgREST | `node --test scripts/test-relations.mjs` : 4/4 ; TypeScript, build/PWA et lint réussis | Migration non exécutée ; idempotence PostgreSQL, cache PostgREST et sessions A/B/admin à vérifier manuellement | Sous-lot implémenté localement, P0-02 reste ouvert. Les mocks contrôlent les requêtes et leur mapping, pas les FK ou les RLS effectives. |
| P0-02 — droits SQL/Storage et compatibilité de la modération | V4 transactionnelle avec droits par colonne, triggers, contraintes et gardes restrictives ; protection contre la cascade sur les documents d'autres auteurs ; modération et approbation collective à cibles explicites, confirmation des lignes et erreurs visibles dans `PendingList` | `npx tsc --noEmit`, `npm run build` (PWA incluse) et `npm run lint` réussis ; relations/modération : 10/10 ; contrôles textuels V4 : 6/6 | Aucune exécution SQL ou opération Supabase distante ; syntaxe/runtime PostgreSQL, réexécution des migrations, concurrence et recette A/B/admin non vérifiés | Sous-lot réalisé localement. P0-02 et P0-07 restent ouverts ; contrats/types, décisions de rôles et reprise Storage/SQL restent à traiter. Avertissement bundle conservé : 799,52 kB minifiés, 231,16 kB gzip. |

Conserver les résultats positifs **et** négatifs. Une case laissée vide avec une explication est préférable à une validation supposée. Le bilan final de chaque étape distingue toujours code local, tests exécutés, manipulations externes et limites restantes.
