# Checklist manuelle — Supabase, Google Cloud et validation du site

> **Phase 2 locale autorisée — aucune étape externe ci-dessous n'a été exécutée.** Le code local ne permet pas de vérifier l'état d'un projet Supabase, d'un client Google OAuth ou d'un déploiement. Toutes les cases externes restent donc volontairement décochées. Ne pas transmettre de clé, de jeton ou de secret dans une capture ou un compte rendu.
>
> Lire d'abord les P0 de [ROADMAP.md](ROADMAP.md). `schema.sql` et `migration_v2.sql` sont conservés sans modification : sur la base existante, utiliser les nouvelles migrations après comparaison de l'état installé. V3 répare les relations auteurs ; V4 prépare le durcissement RLS/Storage. Leur présence et les tests locaux ne prouvent pas les droits réellement installés. Les exemples utilisent uniquement des placeholders.

### Registre des contrôles locaux — 5 novembre 2026

Ce registre décrit des commandes exécutées localement ; **il ne coche aucune recette manuelle ou externe**. Les détails de reprise figurent en [section 13 de l’architecture](ARCHITECTURE.md#13-reprise-locale-des-contrats--5-novembre-2026).

| Contrôle exécuté | Résultat et portée |
| --- | --- |
| `npx tsc --noEmit` | Réussi ; validation TypeScript locale. |
| `npm run build` | Réussi, manifest et service worker générés ; avertissements de taille du chunk principal et de durée de callbacks PWA. Ne valide ni OAuth ni les RLS. |
| `npm run lint` | Réussi ; alias de TypeScript, pas ESLint. |
| `scripts/test-upload-batch.mjs` | 27/27 ; orchestration et journal, sans transfert réel. |
| `scripts/test-dashboard-library.mjs` | 21/21 ; contrôleur indépendant de React, sans DOM/StrictMode réel. |
| `scripts/test-relations.mjs` | 18/18 ; API Auth/SQL/Storage simulées, aucune opération distante. |
| `scripts/test-security-sql.mjs` | 6/6 ; contrôles textuels, pas PostgreSQL/RLS installées. |
| Run groupé des quatre scripts par `node --test --test-reporter=spec` | **72/72**, exit 0, fermeture normale et aucun avertissement WebSocket ; isolation Vite sans configuration applicative ni fichiers `.env`. |
| Exclusions Git | `.env`, `.env.local`, `.env.production`, `dist/` et `graphify-out/` exclus ; parmi les chemins `.env*` suivis, seul `.env.example` est présent. Aucun secret lu ou recopié pour ce contrôle. |
| Graphify du delta courant | Non confirmé : dernières tentatives bloquées avant lancement par le classificateur indisponible ; ne pas assimiler le graphe historique à une mise à jour réussie. |

Commande reproductible, sans accès Supabase réel :

```powershell
node --test --test-reporter=spec scripts/test-upload-batch.mjs scripts/test-dashboard-library.mjs scripts/test-relations.mjs scripts/test-security-sql.mjs
```

Toutes les cases ci-dessous restent ouvertes jusqu’à exécution et consignation du résultat attendu/obtenu sur l’environnement approprié.

## 1. Préparer l'environnement de vérification

- [ ] Identifier le projet Supabase réellement visé : organisation, environnement de test ou production et URL. Ne pas confondre un projet configuré dans `.env` avec un autre enregistré dans le navigateur.
- [ ] Prévoir une sauvegarde et utiliser d'abord un environnement de test pour les migrations et les tests de droits.
- [ ] Recenser ce qui existe déjà avant toute exécution : tables, fonctions, triggers, contraintes, policies et bucket.
- [ ] Utiliser un compte Google de test pour la personne administratrice et deux comptes ordinaires distincts, A et B. Ne pas tester la confidentialité uniquement avec une session administratrice.
- [ ] Choisir une version de Node compatible avec le verrouillage : Vite et son plugin React exigent `^20.19.0 || >=22.12.0`.
- [ ] Fixer npm comme gestionnaire pour les commandes et le déploiement tant que les deux lockfiles n'ont pas été réconciliés. `package.json`/`package-lock.json` attendent esbuild `^0.28.0`, mais le manifeste de `bun.lock` annonce encore `^0.25.0`. Ne pas supprimer un lockfile ou forcer une résolution sans accord.

### Repères OAuth à ne pas confondre

| Élément | Valeur de référence à adapter |
| --- | --- |
| URL du projet Supabase | `https://PROJECT_REF.supabase.co` |
| Callback du **provider Google**, côté Google Cloud | `https://PROJECT_REF.supabase.co/auth/v1/callback` |
| Origine du site de production | `https://YOUR_DOMAIN` |
| Retour applicatif OAuth | URL réellement passée à `redirectTo` dans `src/context/AuthContext.tsx`, notamment la destination `/dashboard` |
| Origine locale de développement | `http://localhost:3000` |

Le callback Google vers Supabase n'est **pas** la Redirect URL finale de l'application.

## 2. Base PostgreSQL — scripts installés et nouvelles migrations

- [ ] Sur une base neuve de test, appliquer les scripts dans l'ordre demandé : `supabase/schema.sql`, puis `supabase/migration_v2.sql`, puis les nouvelles migrations, **après traitement des défauts SQL P0**. Sur une base existante, comparer son état aux scripts avant toute migration ; ne pas rejouer aveuglément les scripts déjà appliqués.
- [ ] Après sauvegarde et vérification des prérequis, exécuter manuellement `supabase/migration_v3.sql` dans le SQL Editor. Cette migration conserve les scripts et FK antérieurs, complète uniquement les profils absents depuis `auth.users`, ajoute les relations auteurs vers `profiles` et demande le rechargement du cache PostgREST. Elle ne durcit pas les RLS.
- [ ] Vérifier que V3 termine sans erreur, qu'aucun rôle existant n'est modifié et que les contraintes validées `documents_user_id_profiles_fkey` et `folders_user_id_profiles_fkey` ciblent `public.profiles(id)`.
- [ ] Réexécuter V3 sur la base de test pour vérifier son idempotence réelle : aucun profil dupliqué, aucune contrainte homonyme ajoutée. Une contrainte homonyme incompatible doit faire échouer la transaction, sans remplacement automatique.
- [ ] Après le rechargement du cache, retester avec une session réelle le chargement de la bibliothèque, la création d'un dossier et le dépôt d'un document. Vérifier la disparition de l'erreur de relation vers `user_id`, sans accepter une bibliothèque vide ou des fixtures comme preuve de succès.
- [ ] Tester les auteurs avec A/B/admin : les lignes restent présentes lorsque le profil est masqué ; aucune lecture supplémentaire des e-mails n'est accordée par V3. Les tests locaux de `scripts/test-relations.mjs` simulent les relations et les mutations de modération, mais ne valident ni PostgreSQL ni les RLS effectives.

### Migration V4 — durcissement à vérifier d'abord sur une base de test

- [ ] Après sauvegarde, inventaire et validation de V3, exécuter manuellement `supabase/migration_v4.sql` sur la base de test. Ne pas rejouer `schema.sql` ou V2 sur la base existante. V4 est transactionnelle et ne supprime aucune donnée métier.
- [ ] Si V4 refuse une description trop longue, une taille absente/invalide, un chemin hors du préfixe propriétaire, un chemin dupliqué ou une métadonnée Storage absente : analyser et récupérer les données concernées avant de réessayer. Ne pas supprimer des lignes ou désactiver une contrainte pour faire passer la migration. Une ligne `storage.objects` ne prouve pas la présence des octets distants.
- [ ] Réexécuter V4 sur la base de test pour vérifier sa convergence réelle et l'absence de changement de rôles/données métier. Les six tests de `scripts/test-security-sql.mjs` sont des contrôles textuels seulement, pas une validation de syntaxe ou d'exécution PostgreSQL.
- [ ] Vérifier les privilèges de table **et de colonne**, y compris ceux hérités d'autres rôles. Le navigateur n'écrit pas `reviewed_by`/`reviewed_at`, le propriétaire, le chemin ou les caractéristiques du fichier après insertion ; un compte admin reste dans le rôle PostgreSQL `authenticated`.
- [ ] Vérifier les triggers `amphix_v4_document_write`, `amphix_v4_folder_write` et `amphix_v4_folder_delete`, leurs fonctions, leur propriétaire, leur `search_path` et leurs droits `EXECUTE`. Inventorier les autres fonctions privilégiées exposées par l'API.
- [ ] Avec A/B/admin et des appels API directs, vérifier les colonnes immuables, le refus des statuts/reviewer/dates forgés par un compte ordinaire, puis la modération admin. `reviewed_by` doit correspondre à la session admin et `reviewed_at` à l'horloge PostgreSQL, pas aux valeurs du navigateur.
- [ ] Vérifier que A ne peut pas supprimer un dossier contenant des fichiers de B, y compris pending/rejected invisibles à A ; tester aussi une insertion concurrente de B pendant cette suppression. La cascade FK ne doit pas contourner ce contrôle. L'administration doit pouvoir intervenir selon ses droits SQL **et** Storage.
- [ ] Vérifier les policies permissives et leurs gardes restrictives sur chaque opération. Une ancienne policy permissive ne doit pas élargir la garde ; une policy restrictive supplémentaire peut bloquer un parcours et doit être analysée, pas supprimée aveuglément.
- [ ] Vérifier Storage après V4 : bucket privé/20 Mo, dépôt dans le préfixe propre à l'auteur, lecture approuvée, suppression propriétaire/admin, refus de tout UPDATE/UPSERT/renommage dans `documents`. Vérifier aussi l'absence de régression sur les autres buckets.
- [ ] Refaire bibliothèque, dépôt, modération individuelle et « Tout approuver » dans chaque filtre. Une mutation sans ligne affectée ou un succès sur une seule des deux tables doit produire une erreur explicite, sans succès global trompeur.

### Contrôles généraux du schéma installé

- [ ] Vérifier la création de `public.profiles`, `public.categories`, `public.folders` et `public.documents`.
- [ ] Vérifier les colonnes effectivement présentes, leur nullabilité et leurs valeurs par défaut : propriétaire, catégorie, dossier, chemin Storage, tailles, statut, motif et métadonnées d'approbation.
- [ ] Vérifier les FK installées et leur comportement `ON DELETE`. Le SQL local déclare `documents.folder_id` avec `ON DELETE CASCADE` : supprimer un dossier supprime ses lignes documents, mais pas leurs objets Storage. Vérifier le nettoyage et la reprise des objets avant d'annoncer une suppression complète.
- [ ] Vérifier les contraintes `pending / approved / rejected`, la taille maximale côté serveur et les règles de métadonnées. Les limites du formulaire React ne constituent pas des limites de l'API.
- [ ] Vérifier que les catégories attendues sont créées, lisibles et compatibles avec les valeurs envoyées par le formulaire.
- [ ] Vérifier le trigger sur `auth.users` et la fonction de création de profil : après une nouvelle inscription Google, exactement un profil correspondant existe avec un rôle ordinaire.
- [ ] Vérifier la fonction `public.is_admin()`, son comportement pour une session ordinaire, administratrice et non authentifiée, ainsi que ses droits et son `search_path`.
- [ ] Vérifier que RLS est activé sur les quatre tables et que **toutes** les policies effectivement installées sont celles attendues.
- [ ] Inventorier aussi les anciennes policies. V4 remplace celles connues de `schema.sql`/V2, y compris la lecture personnelle Storage, par des règles permissives accompagnées de gardes restrictives. Les policies inconnues ne sont pas supprimées automatiquement. Les permissives d'une même opération se combinent par **OR**, puis les restrictives applicables les limitent par **AND** : vérifier leur périmètre réel et les éventuels blocages.
- [ ] Vérifier qu'un utilisateur ordinaire ne peut modifier ni son rôle, ni un statut de modération, ni l'identité du propriétaire, ni les métadonnées administratives par un appel API direct.
- [ ] Vérifier qu'une insertion explicitant `status = 'approved'` ou `'rejected'` par un compte ordinaire est refusée, ou transformée côté serveur vers l'état initial autorisé.
- [ ] Vérifier que les fonctions privilégiées ne donnent pas indirectement des droits d'administration à une session ordinaire.

### Inventaire SQL en lecture seule

À lancer manuellement dans le SQL Editor du **projet choisi**, sans diffuser les résultats contenant des données personnelles :

```sql
-- Policies applicatives et Storage réellement installées
select schemaname, tablename, policyname, permissive,
       roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public'
       and tablename in ('profiles', 'categories', 'folders', 'documents'))
   or (schemaname = 'storage' and tablename = 'objects')
order by schemaname, tablename, cmd, policyname;

-- Activation RLS
select n.nspname as schema_name, c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles', 'categories', 'folders', 'documents');

-- Contraintes et FK effectives
select conrelid::regclass as table_name, conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.profiles'::regclass,
                   'public.categories'::regclass,
                   'public.folders'::regclass,
                   'public.documents'::regclass)
order by table_name, conname;
```

L'exécution via SQL Editor avec des privilèges élevés **ne teste pas** le comportement d'une session utilisateur soumise aux RLS. Les scénarios A/B doivent être joués avec leurs propres sessions publiques.

## 3. Storage — bucket `documents` privé

- [ ] Vérifier que le bucket `documents` existe et que `public = false`.
- [ ] Si le bucket existait avant les scripts, vérifier son état actuel. Le `schema.sql` local prévoit explicitement `ON CONFLICT ... DO UPDATE SET public = false, file_size_limit = 20971520`, mais cette instruction n'a pas été exécutée pendant l'audit ; elle ne prouve donc pas la configuration distante.
- [ ] Configurer/vérifier une limite de 20 Mo par fichier, soit `20 * 1024 * 1024 = 20 971 520` octets, en cohérence avec le formulaire et les règles serveur.
- [ ] Vérifier les types de fichiers autorisés sans inventer une liste qui exclurait un besoin produit. Utiliser des fichiers de test non sensibles.
- [ ] Vérifier les policies `INSERT`, `SELECT`, `UPDATE` et `DELETE` sur `storage.objects`, restreintes au bucket et aux identités autorisées.
- [ ] Vérifier qu'un auteur peut envoyer dans son espace et qu'un autre utilisateur ne peut pas usurper ce chemin ou écraser son objet.
- [ ] Vérifier que la lecture d'un objet suit la visibilité des métadonnées : auteur pour ses éléments non approuvés, administration pour la modération, autre utilisateur seulement pour les documents approuvés.
- [ ] Vérifier que les fonctions de signature ne peuvent pas obtenir un document pending/rejected d'un autre auteur à partir d'un chemin connu.
- [ ] Vérifier le téléchargement réel des documents approuvés par le compte B, pas seulement l'apparition de la carte dans la liste.
- [ ] Vérifier la suppression effective de l'objet et de la ligne SQL, y compris le cas de la personne administratrice intervenant sur un document d'autrui.
- [ ] Vérifier le comportement d'échec partiel : objet envoyé mais insertion SQL refusée, ligne supprimée mais objet non supprimé, dossier créé mais dépôt interrompu. Aucun état partiel ne doit être annoncé comme un succès complet.
- [ ] Vérifier qu'une URL publique directe n'est pas utilisée à la place d'une URL signée ; contrôler la durée de validité retenue. Une URL signée déjà distribuée peut rester valable jusqu'à son expiration : ne pas promettre une révocation instantanée sans mécanisme correspondant.

## 4. Google Cloud et provider Supabase

### Google Cloud

- [ ] Utiliser le projet Google Cloud prévu pour AmphixDocs.
- [ ] Configurer l'écran de consentement OAuth : nom, assistance, domaines autorisés et audience adaptée au projet. Si l'application est en mode test, ajouter les comptes de test autorisés.
- [ ] Créer/vérifier un client OAuth de type **Application Web**.
- [ ] Renseigner l'URI de redirection autorisée exacte du provider : `https://PROJECT_REF.supabase.co/auth/v1/callback`.
- [ ] Vérifier les origines JavaScript nécessaires selon l'intégration utilisée ; ne pas les confondre avec les URI de redirection. Ajouter uniquement les origines prévues, sans chemin applicatif.
- [ ] Si un domaine Supabase personnalisé est utilisé, reprendre le callback affiché dans le tableau de bord du provider plutôt que d'inventer une URL.
- [ ] Conserver le secret client Google côté configuration Supabase uniquement. Ne jamais le mettre dans une variable `VITE_*`.

### Supabase Auth

- [ ] Activer le provider Google et renseigner son Client ID et son secret dans le tableau de bord Supabase.
- [ ] Configurer la Site URL du site de production, normalement `https://YOUR_DOMAIN`, et vérifier la destination applicative explicite du code.
- [ ] Ajouter les Redirect URLs exactes nécessaires au `redirectTo` utilisé : développement `http://localhost:3000/dashboard`, production `https://YOUR_DOMAIN/dashboard`, et autres destinations uniquement si le code les utilise réellement.
- [ ] Si `npm run preview` sert sur un autre port, autoriser son URL précise pour les tests locaux qui en ont besoin.
- [ ] Éviter un wildcard de production trop large. Ajouter les environnements preview de façon maîtrisée et retirer les URLs qui ne sont plus utilisées.
- [ ] Tester Google → Supabase → application, puis rechargement de `/dashboard`, expiration/renouvellement de session et déconnexion.
- [ ] Tester le refus du consentement, une erreur du provider et une configuration manquante : message compréhensible, pas de compte démo présenté comme une connexion Google réussie.
- [ ] Vérifier que la création du profil ne dépend pas uniquement d'un upsert côté navigateur et qu'une erreur de profil est visible sans boucle ni chargement infini.

### Configuration, session et réponses obsolètes — recette non exécutée

Utiliser uniquement des projets et comptes de test autorisés ; observer les états et requêtes sans afficher les clés ou jetons.

- [ ] Tester configuration absente, paire locale incomplète, placeholders et valeurs invalides : client indisponible et message actionnable, pas de badge connecté ni de données de secours présentées comme réelles.
- [ ] Tester deux configurations publiques de projets différents : aucune paire URL/clé mélangée, une paire locale invalide ne doit pas basculer silencieusement vers un autre projet.
- [ ] Bloquer le stockage du site : formulaire de configuration et restauration Auth doivent exposer la limite réelle sans exception non traitée ni promesse de session durable.
- [ ] Visiter directement `/admin` avec rôle encore en chargement, puis admin/user et erreur de profil : attente, accès/refus ou réessai appropriés, sans `amphix_force_admin` effectif.
- [ ] Changer rapidement de compte/projet ou se déconnecter pendant une réponse de session/profil : aucun rôle, donnée ou erreur de l’ancien scope ne réapparaît dans le nouveau.
- [ ] Faire échouer la déconnexion puis réessayer : le dashboard reste cohérent, l’erreur est visible et aucun délai arbitraire ne simule un succès. Tester aussi le démontage/changement de scope pendant cette opération.
- [ ] Vérifier le rafraîchissement effectif du rôle après une promotion/rétrogradation autorisée ; la simple présence du guard ne constitue pas cette preuve.

## 5. Promotion du premier compte administrateur

- [ ] Faire une première connexion Google avec le compte prévu ; vérifier que son profil a été créé avec le rôle ordinaire attendu.
- [ ] Identifier manuellement son UUID dans `public.profiles` et le comparer au compte Auth. Ne pas promouvoir une adresse de secours ou un compte de démonstration.
- [ ] Depuis le SQL Editor privilégié du projet choisi, promouvoir **uniquement** cet UUID. Remplacer le placeholder avant exécution :

```sql
update public.profiles
set role = 'admin'
where id = 'REPLACE_WITH_THE_VERIFIED_USER_UUID'
returning id, role;
```

- [ ] Vérifier qu'une seule ligne a été modifiée.
- [ ] Recharger la session/le profil selon le mécanisme réel du code et confirmer l'accès à `/admin`.
- [ ] Avec le compte B, confirmer le refus de `/admin` **et** des opérations API de modération/promotion ; un guard React seul ne suffit pas.
- [ ] Vérifier les promotions/rétrogradations suivantes via l'onglet Inscriptions et le traitement du rôle pendant une session déjà ouverte.
- [ ] Définir avant implémentation la règle relative au dernier compte administrateur et à la rétrogradation de soi-même. Le masquage d'un bouton ne fournit pas cette garantie côté serveur.

## 6. Variables d'environnement et déploiement

- [ ] Créer une configuration locale non versionnée, par exemple `.env.local`, en s'appuyant sur `.env.example` et sans copier les valeurs dans la documentation :

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=REPLACE_WITH_THE_PUBLIC_CLIENT_KEY
```

- [ ] Vérifier que la clé est une clé publique prévue pour le client Supabase (`anon`/publishable selon le projet), **jamais `service_role` ou une clé secrète**. Son caractère public ne remplace pas les RLS.
- [ ] Vérifier les éventuelles configurations persistées par la modal Supabase dans le navigateur. Une ancienne URL/clé locale peut changer le projet utilisé ; examiner cela en privé, sans journaliser les valeurs.
- [ ] Vérifier que les variables Gemini héritées d'AI Studio ne sont pas nécessaires à la SPA métier et qu'aucune clé privée n'est injectée dans le bundle.
- [ ] Vérifier les exclusions de `.env`, `.env.local` et des variantes avant tout futur commit ; ne pas retirer un secret déjà versionné sans traiter sa révocation.
- [ ] Définir les variables publiques dans chaque environnement de déploiement concerné. Vite les intègre à la compilation : redéployer après modification.
- [ ] Configurer les commandes npm de déploiement et le répertoire `dist`. Ajouter une validation TypeScript au pipeline : le `npm run build` actuel ne la lance pas.
- [ ] Vérifier les rewrites SPA : `/dashboard` et `/admin` chargés directement doivent servir l'application, puis appliquer leurs guards.
- [ ] Vérifier HTTPS, le manifest, les icônes et les en-têtes du service worker. Ne pas appliquer un cache `immutable` de longue durée au SW ou à l'HTML.
- [ ] Vérifier si le texte d'intégration `public/assets/aistudio/Paste_November_03__2026_-_6_58PM_03565a3f`, copié dans `dist` lors du build audité, doit réellement être distribué. Aucun fichier ne doit être supprimé sans accord.

## 7. Recette des droits avec A, B et administration

Pour chaque ligne, vérifier **liste SQL visible via le client**, **carte UI** et **accès Storage**, avec des sessions séparées :

| Situation | Auteur A | Compte B ordinaire | Administration |
| --- | --- | --- | --- |
| Document pending de A | Visible, badge En attente, accès à son fichier | Invisible et fichier inaccessible | Visible pour modération et aperçu |
| Document approved de A | Visible | Visible et téléchargeable | Visible |
| Document rejected de A | Visible avec motif | Invisible et fichier inaccessible | Visible pour gestion |
| Dossier pending/rejected de A | Visible avec statut | Invisible | Visible pour modération |
| Dossier approved de A | Visible | Visible | Visible |
| Profil/rôle de A | Données personnelles nécessaires seulement | Pas d'accès injustifié aux données privées | Liste Inscriptions selon besoin |
| Modification de rôle/statut par A | Champs privilégiés interdits | Champs privilégiés interdits | Opération permise et contrôlée |

- [ ] Tester les lignes ci-dessus sans utiliser de clé privilégiée dans le client.
- [ ] Tester un appel direct qui tente de modifier le rôle, le propriétaire ou le statut ; obtenir un refus serveur, même si le bouton n'existe pas dans React.
- [ ] Vérifier les couples de statuts dossier/document. Fixer la règle produit si un document approuvé appartient à un dossier non approuvé : aucune décision implicite ne doit masquer des documents ou élargir leurs droits.
- [ ] Vérifier l'insertion dans un dossier existant : les destinations proposées par le formulaire doivent correspondre aux destinations réellement autorisées.
- [ ] Vérifier le changement de profil/rôle avec une session déjà ouverte et après rechargement ; aucun override local ne doit permettre une opération privilégiée réelle.

## 8. Recette fonctionnelle du dépôt, de la recherche et de l'administration

- [ ] Accueil connecté desktop **et mobile** : uniquement recherche et dépôt selon la spécification, sans dossiers/récents/catégories présentés prématurément.
- [ ] Recherche par titre, nom de fichier, description et dossier ; vérifier aussi un document situé dans un dossier dont le nom ne correspond pas à la requête.
- [ ] Vérifier le comportement promis pour la recherche par catégorie et les compteurs après ajout/suppression.
- [ ] Ouvrir un dossier et retrouver tous ses fichiers autorisés ; revenir à l'état de recherche attendu.
- [ ] Déposer un fichier, puis un lot de plusieurs fichiers : retrouver **tout le lot** immédiatement et après rechargement.
- [ ] Tester fichier exactement à la limite et fichier supérieur à 20 Mo ; description de 200 caractères et validation des champs côté serveur.
- [ ] Tester une erreur au milieu d'un lot : éléments réussis conservés et affichés, erreur explicite, possibilité de reprise sans doublon.
- [ ] Vérifier la progression sur une connexion lente : elle doit représenter des octets réellement envoyés, ou être explicitement indéterminée, jamais un pourcentage inventé par un minuteur.
- [ ] Tester les erreurs Storage/SQL, le réseau interrompu et la configuration manquante : ne pas afficher une bibliothèque vide ou un succès trompeur.
- [ ] Modifier et supprimer un fichier en tant qu'auteur puis en tant qu'admin intervenant sur autrui ; recharger pour vérifier le résultat persistant.
- [ ] Supprimer un dossier : comparer le texte de confirmation, les lignes SQL restantes et les objets Storage restants.
- [ ] Approuver et refuser fichiers/dossiers, avec motif réellement conservé et visible par l'auteur.
- [ ] Tester « Tout approuver » dans chacun des filtres : la confirmation doit décrire exactement les éléments effectivement modifiés.
- [ ] Tester l'aperçu et le téléchargement avec les bloqueurs de fenêtres usuels.
- [ ] Vérifier les inscrits Google, les rôles, les dates/comptages présentés et les valeurs manquantes possibles.

### Dépôt, journal et reprise — recette non exécutée

Les 27 tests de module du journal et les API simulées ne remplacent pas ces scénarios. Injecter les pannes uniquement dans un environnement de test autorisé, avec des documents non sensibles ; ne pas supprimer une trace/objet distant pour forcer artificiellement un succès.

- [ ] Déposer trois fichiers avec une panne au milieu : chaque succès apparaît une seule fois, le dossier et les compteurs sont cohérents et le bilan explique chaque échec. Réessayer sans rejouer les confirmations du lot en mémoire.
- [ ] Perdre une réponse Storage après réception des octets, puis une réponse SQL après insertion : retrouver les mêmes UUID/chemins, sans second objet/ligne et sans compensation supprimant un objet déjà référencé.
- [ ] Fermer puis rouvrir le modal après un résultat partiel ; recharger ensuite la page sans originaux disponibles : la trace est conservée et toutes les identités sont revérifiées, sans supposer une confirmation ancienne ni créer de nouvel UUID.
- [ ] Si un original est requis, resélectionner un fichier de même nom/taille mais de contenu différent : refus explicite, aucun transfert, métadonnées figées et originaux compatibles déjà conservés inchangés.
- [ ] Tester dossier existant/nouveau, erreur avant création du dossier, réponse de dossier perdue, conflit de contenu et absence Storage ambiguë : pas de nouveau transfert ou de nettoyage aveugle sur simple 404 générique.
- [ ] Bloquer le stockage du journal, faire échouer sa relecture ou présenter une autre trace/incompatible : aucun nouvel envoi, erreur actionnable et trace existante conservée. Inspecter le journal uniquement en privé : aucune clé, jeton, profil ou donnée binaire de fichier ne doit y figurer.
- [ ] Faire échouer le retrait du journal après un lot complet : avertissement récupérable, succès distants conservés et prochaine ouverture en vérification. La fin d’un lot ne doit pas retirer la trace d’un autre lot.
- [ ] Faire échouer la notification locale du bilan après confirmation distante : le réessai d’affichage ne doit déclencher ni nouveau transfert ni INSERT.
- [ ] Changer de compte/projet pendant préparation, transfert ou réponse SQL : les entrées suivantes s’arrêtent et aucune confirmation tardive n’est projetée sur l’autre dashboard ; la reprise reste liée au scope d’origine.
- [ ] Tester la limite réelle de 20 971 520 octets et une description de 200 points de code Unicode, dont des caractères hors BMP : validation du formulaire, helper, SQL et bucket cohérente. Les tests de métadonnées ne prouvent pas le transfert à cette limite.
- [ ] Examiner deux onglets et la suppression des données du site : consigner les limites du journal local, sans conclure à un verrou atomique ou à une reprise serveur durable.

### Bibliothèque et raccordement React — recette non exécutée

- [ ] En développement React StrictMode, monter/nettoyer/remonter le dashboard : aucun résultat de l’ancienne lecture n’est publié dans le nouveau contrôleur ; tester aussi compte, client, projet et rôle changés rapidement.
- [ ] Pendant un chargement lent, confirmer dépôt, édition puis suppression : la réponse tardive ne doit ni perdre les ajouts ni rétablir les métadonnées/éléments supprimés.
- [ ] Faire arriver deux lectures dans l’ordre inverse, puis une erreur ancienne : la dernière lecture démarrée est l’autorité ; les données déjà affichées restent disponibles après une vraie erreur avec Réessayer.
- [ ] Répéter un rapport cumulatif après modification/suppression puis après relecture serveur : pas de doublon, retour d’anciennes métadonnées ou dossier/enfant supprimé ; une lecture autoritative peut retirer un élément devenu invisible.
- [ ] Vérifier les états chargement, collection réellement vide et erreur séparément, y compris la recherche : une erreur ne doit pas devenir un EmptyState trompeur. Vérifier les compteurs sur les enfants effectivement visibles.
- [ ] Fermer/rouvrir le modal, modifier la référence des catégories et laisser expirer la surbrillance après démontage : pas de perte du formulaire/lot ni de callback/timer appliqué à un autre scope.

## 9. PWA et hors-ligne — sur un build de production

- [ ] Servir le build avec HTTPS ou localhost ; ne pas conclure à partir de `npm run dev` seul.
- [ ] Vérifier le manifest généré : français, `/dashboard`, scope `/`, standalone et icônes 192/512/maskable.
- [ ] Vérifier les dimensions, le rendu maskable, le favicon et l'icône iOS sur appareils ; le générateur dépend des polices présentes sur la machine.
- [ ] Dans DevTools → Application → Service Workers / Cache Storage, vérifier le SW actif et les caches précache/polices.
- [ ] Effectuer des opérations Auth/REST/Storage, notamment des téléchargements signés : **aucune réponse Supabase ne doit être ajoutée au cache du service worker**. Répéter avec le domaine réellement configuré.
- [ ] Vérifier l'isolation entre comptes après déconnexion ; aucune donnée privée d'une précédente session ne doit être présentée à la suivante.
- [ ] Passer hors ligne après une première visite, puis recharger une route : la page hors-ligne prévue doit apparaître. Ne pas promettre l'accès aux documents ou la synchronisation d'une file d'envoi que l'application n'implémente pas.
- [ ] Revenir en ligne : vérifier la reprise réelle du chargement. Distinguer un nouveau fetch d'une synchronisation durable.
- [ ] Tester l'installation Chromium, les instructions iPhone et iPadOS en user-agent desktop, puis le lancement standalone.
- [ ] Tester le refus de l'installation, le délai de réapparition et le stockage navigateur indisponible/bloqué.
- [ ] Déployer deux versions de test : constater la notification de mise à jour, activer Actualiser et vérifier le chargement de la nouvelle version.
- [ ] Vérifier l'annonce accessible du toast, sa position avec la safe area et le traitement visible d'un échec d'enregistrement du SW.

## 10. Mobile, accessibilité et français

- [ ] Tester à 320/360 px, paysage, zoom 200 %, iOS/Android, navigateur et PWA installée : pas de défilement horizontal de la page.
- [ ] Tester Accueil, Recherche, « + », Dossiers et Profil depuis `/dashboard` et `/admin` ; vérifier contenu, focus et indicateur actif, pas seulement l'URL.
- [ ] Tester le clavier ouvert, les safe areas, le scroll interne des sheets et l'espace sous la pilule mobile.
- [ ] Pour chaque dialogue : focus initial, Tab/Shift+Tab confiné, Échap lorsque l'opération le permet, restauration du focus et fond non interactif.
- [ ] Tester `data-autofocus` sur un contrôle désactivé directement ou par `fieldset disabled`, caché/inert, puis un dialogue sans contrôle utilisable : focus sur un contrôle réellement utilisable ou le dialogue, jamais sur la cible indisponible.
- [ ] Empiler deux dialogues, fermer le dernier puis le premier : confinement/restauration du focus et du verrou de scroll corrects. Pendant un transfert, vérifier la fermeture Échap permise/interdite selon l’état, sans perte de trace.
- [ ] Tester cartes de fichiers/dossiers et tooltips au clavier, labels persistants, focus visible, boutons icônes et états sélectionnés.
- [ ] Activer `prefers-reduced-motion` : portail, footer, slap, transitions de page, cartes 3D, boucles et springs doivent respecter la préférence.
- [ ] Vérifier le français visible **et annoncé par lecteur d'écran**. Le footer contient encore des chaînes internes non paramétrables : ne pas modifier `components/ui/sticker-slap-footer.tsx` ni contourner la contrainte par un patch DOM. Consigner la limite et attendre une décision explicite sur les exigences incompatibles.
- [ ] Vérifier l'absence de réseaux sociaux et de bouton credits dans le footer, configurés par `socials={[]}` et `credits={[]}`.

## Trace de validation à conserver

- [ ] Pour chaque groupe : date, environnement, compte/role de test anonymisé, résultat attendu/obtenu et références des défauts restants.
- [ ] Conserver uniquement des logs expurgés et des captures sans clés, jetons, liens signés encore valables ou documents personnels.
- [ ] Ne cocher une tâche de la roadmap qu'après correction et vérification ; les cases de cette checklist représentent des opérations manuelles, pas des réalisations automatiques de l'audit.
