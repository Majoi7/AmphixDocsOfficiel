# Léo AI — configuration et recette

Léo retrouve des fichiers dans la bibliothèque actuelle (V5/V6). Aucun contenu de
fichier n'est envoyé au modèle. Le navigateur effectue successivement trois
appels à **la même Edge Function `leo-search`** : `plan`, `search`, `rank`.
L'affichage « Réflexion de Léo » décrit ces opérations, pas un raisonnement privé.

## 1. Appliquer les migrations, manuellement

1. Sauvegarder la base et choisir d'abord un projet Supabase de test.
2. Vérifier que les migrations V2 à V6 ont été appliquées dans l'ordre. V7 ne
   remplace pas V6 et ne crée aucune future table d'écoles.
3. Dans l'éditeur SQL Supabase, exécuter **`supabase/migration_v7.sql`** en entier.
4. Rejouer V7 dans le projet de test, puis effectuer les contrôles RLS ci-dessous.
   Un échec de prérequis doit être corrigé, pas contourné en retirant le contrôle.
5. Appliquer ensuite V7 au projet cible seulement après validation humaine.

V7 ajoute `unaccent`, `pg_trgm`, un index GIN partiel sur les métadonnées des
fichiers actifs, trois RPC et un registre privé sans texte de demande :

- `leo_search_documents` : **SECURITY INVOKER**, RLS activées, filtre supplémentaire
  `deleted_at IS NULL AND (status = 'approved' OR user_id = auth.uid())`, au plus 30.
  Même une personne administratrice ne reçoit pas les fichiers privés de tiers.
- `leo_begin_request` : 20 demandes par compte sur une fenêtre glissante de dix
  minutes, verrou transactionnel par compte. Le cache ne contourne pas le quota.
- `leo_advance_request` : étapes à usage unique, liées au compte, à un identifiant
  expirant après dix minutes et à l'empreinte canonique du plan. Les candidats
  viennent du registre serveur et sont relus sous RLS avant ET après Gemini.

Les deux dernières RPC sont DEFINER uniquement pour leur petit registre privé ;
elles ne lisent jamais `documents`. Les appeler directement ne permet ni de
remettre le quota à zéro, ni de lire un fichier : les relectures restent INVOKER.
Les marqueurs périmés d'un compte sont retirés à sa prochaine demande ; un compte
inactif conserve au plus 20 marqueurs sans prompt. Les IDs candidats sont effacés
à la fin d'un classement. Aucun `service_role` n'est utilisé dans l'Edge Function.

L'index suppose le dictionnaire `unaccent` stable. Après une modification manuelle
de ce dictionnaire, reconstruire l'index `amphix_v7_documents_search_idx` pendant
une fenêtre de maintenance. V7 ne déplace pas les extensions déjà installées.

## 2. Créer la clé Gemini et choisir le modèle

1. Ouvrir [Google AI Studio](https://aistudio.google.com/) avec le compte choisi.
2. Choisir le projet Google, vérifier ses conditions d'utilisation et le traitement
   des données, activer l'API et la facturation/les quotas appropriés.
3. Créer une clé pour l'API Gemini, restreinte au service nécessaire si disponible.
4. Dans la [liste officielle des modèles](https://aistudio.google.com/docs/models),
   choisir un modèle **Flash stable avec sorties structurées** disponible au compte.
   Lors de la vérification de ce lot, la fiche officielle indique
   **`gemini-3.8-flash` — Stable, Structured outputs supported** :
   <https://aistudio.google.com/docs/models/gemini-3.8-flash>.
   Vérifier à nouveau cette fiche au déploiement ; disponibilité/quotas évoluent.
5. Fournir son identifiant par **`GEMINI_MODEL`**, jamais par une valeur dans le code.

La clé n'est ni dans `.env.example`, ni dans `src/`, ni dans une variable `VITE_*`.
Ne jamais la coller dans Git, les journaux, une capture d'écran ou cette documentation.
Le dépôt n'a pas besoin de la clé pour construire ou exécuter ses tests locaux.

Référence REST utilisée :
<https://aistudio.google.com/api-reference/generate-content>, endpoint
`/v1beta/models/{model}:generateContent`, `systemInstruction`,
`generationConfig.responseMimeType = application/json` et `responseJsonSchema`.
Les noms des champs ont aussi été contrôlés dans la définition publique de l'API :
<https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta>.
Le JSON du modèle est ensuite validé indépendamment côté serveur (clés, types,
longueurs, dates, unicité et appartenance des IDs), même si le fournisseur annonce
une sortie conforme. Les pensées intermédiaires éventuelles ne sont pas lues.

## 3. Configurer et déployer l'Edge Function — PowerShell

**Commandes à exécuter par vous uniquement. Aucune n'a été exécutée à distance
pendant ce lot.** Choisir le bon projet avant de lier ou déployer.

```powershell
npx supabase login
npx supabase link --project-ref TON_PROJECT_REF
```

Injecter les secrets depuis un environnement terminal sûr. Exemple avec variables
**déjà renseignées de manière confidentielle**, sans en afficher les valeurs :

```powershell
npx supabase secrets set "GEMINI_API_KEY=$env:GEMINI_API_KEY" "GEMINI_MODEL=$env:GEMINI_MODEL"
npx supabase functions deploy leo-search
```

Forme explicite à remplacer, pour référence seulement :

```powershell
npx supabase secrets set GEMINI_API_KEY=TA_CLE_PRIVEE GEMINI_MODEL=IDENTIFIANT_FLASH_VERIFIE
```

Éviter cette dernière forme dans un terminal qui conserve l'historique ou capture
les arguments. `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont fournis par l'environnement
Supabase hébergé ; **ne pas les remplacer par une clé privilégiée**.
Ne pas utiliser `--no-verify-jwt` : garder la vérification JWT de la passerelle.
La fonction vérifie en plus le jeton avec `auth.getUser(token)`.

Deno charge le SDK serveur par `supabase/functions/leo-search/deno.json`, version
verrouillée. Pour contrôler ce point d'entrée localement si Deno est installé :

```powershell
deno check --config supabase/functions/leo-search/deno.json supabase/functions/leo-search/index.ts
```

Le `tsc` de l'application contrôle le moteur portable et le contrat partagé, pas
le point d'entrée Deno. Un build Vite réussi ne prouve pas que Deno déploie la fonction.
Le mode de diagnostic `LEO_DEBUG=true` est réservé au projet de développement : il
journalise seulement des codes fixes, sans clé, jeton, prompt ou métadonnée. Ne pas
activer de traces de corps de requête en production.

## 4. Tester les trois actions sous JWT utilisateur

Se connecter avec un vrai compte utilisateur du **même projet** et fournir son JWT
courant de manière confidentielle dans `$env:LEO_USER_JWT`. Fournir la clé publique
publishable/anon dans `$env:SUPABASE_PUBLIC_KEY` et l'URL projet dans
`$env:SUPABASE_URL`. Ces valeurs de test ne sont ni écrites dans le dépôt ni affichées.
Ne pas utiliser une clé `service_role` comme jeton utilisateur.

```powershell
$uri = "$env:SUPABASE_URL/functions/v1/leo-search"
$headers = @{ Authorization = "Bearer $env:LEO_USER_JWT"; apikey = $env:SUPABASE_PUBLIC_KEY }
$prompt = "les sujets d'examen d'algèbre de l'EPAC"
$plan = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ action = 'plan'; prompt = $prompt } | ConvertTo-Json -Depth 8)))
if ($plan.inScope) {
  $next = @{ action = 'search'; prompt = $prompt; requestId = $plan.requestId; plan = $plan.plan; fallback = $plan.fallback }
  $search = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($next | ConvertTo-Json -Depth 8)))
  $next.action = 'rank'
  $rank = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($next | ConvertTo-Json -Depth 8)))
  $rank.documents | Select-Object title, school_name, subject_name, status
}
```

Ne pas imprimer `$headers`, le JWT ou les réponses Auth. Si une étape échoue,
recommencer par `plan` : une étape consommée n'est pas rejouable et une nouvelle
recherche consomme une demande. Le panneau « Réessayer » suit ce comportement.
Les variables locales sont sensibles ; fermer le terminal de test après usage.

## 5. Recette sécurité / recherche, non remplacée par les tests Node

Sur le projet de test, prévoir compte A, compte B et compte administrateur.

- Sans jeton, jeton expiré ou jeton d'un autre projet : refus avant Gemini.
- A retrouve les approuvés et ses propres pending/rejected ; aucun pending/rejected
  de B. Même vérification avec le compte admin : Léo ne fait pas de modération.
- Aucun fichier en corbeille. Retirer/modérer un candidat pendant le classement :
  il ne doit pas être retourné après perte de visibilité.
- Rechercher « algèbre », « algebre » et une faute plausible « algebre epca » ;
  vérifier titre, description, école et matière, filtres de date d'ajout et tri.
  Les années d'examens restent des mots-clés, pas de faux filtres de date d'ajout.
- Tester les anciens documents dont école/matière sont NULL.
- Envoyer 21 plans (y compris en parallèle) : seuls 20 doivent être autorisés sur
  dix minutes. Après l'échéance, nouvelle demande possible. Un 429 Gemini produit
  le fallback, un 429 du quota Léo produit le message de quota utilisateur.
- Réutiliser une étape, changer de plan ou de compte entre étapes : refus propre.
- Titre/descriptif contenant « ignore les règles » : simple donnée ; aucun secret,
  aucune instruction suivie, aucun identifiant externe accepté.
- Projet sans V7/V6 : message français générique et bouton Réessayer, pas de SQL.
- Secret Gemini absent, modèle invalide, quota fournisseur ou panne : recherche SQL
  et « Léo est indisponible, voici une recherche classique. », sans fausse explication.
- « Raconte une blague » : « Je peux seulement t'aider à retrouver des fichiers. »
- Vérifier le plan d'exécution avec une vraie volumétrie. Les filtres et droits sont
  appliqués avant LIMIT 30 ; la recherche utilise mots/sous-chaînes/trigrammes.

## 6. Limites et confidentialité

- Historique **en mémoire de la session du dashboard**, pas de localStorage,
  sessionStorage ou base d'historique. Fermeture/réouverture du panneau conserve
  les échanges ; rechargement, déconnexion ou changement de projet les efface.
- Cache des plans : mémoire d'une instance Edge, deux minutes, 200 entrées maximum,
  séparées par compte. Ce cache opportuniste n'est pas partagé entre instances.
  Les résultats ne sont jamais mis en cache par Léo ou le service worker.
- Gemini reçoit la demande, le plan et au plus 30 métadonnées : id, titre (240),
  description (200), école, matière, type, date. Aucun octet, lien signé, chemin
  Storage, email ou avatar utilisateur. Les métadonnées privées restent néanmoins
  des données transmises au fournisseur ; vérifier ses conditions avant activation.
- Retour final : dix fichiers maximum, jusqu'à trois explications françaises
  brèves et factuelles. Elles peuvent se tromper : les métadonnées restent visibles.
- Repli lexical sans Gemini : extraction déterministe de mots-clés ; compréhension
  moins précise qu'un plan modèle. Les étapes restent de vrais appels réseau.
- Budget réseau d'une action : 18 s, appel Gemini au plus 8,5 s, interruption par
  AbortSignal. Aucun faux délai d'animation. Les échecs ne sont pas automatiquement
  rejoués côté serveur : cela évite les doublons et la multiplication des coûts.

## 7. Vérifications locales et navigateur

```powershell
npx tsc --noEmit
npm run build
npm run lint
node --test scripts/test-leo-backend.mjs scripts/test-leo-sql.mjs
```

Les tests du moteur utilisent Auth/SQL/Gemini simulés ; les tests V7 sont textuels.
Ils ne remplacent ni PostgreSQL réel, ni le déploiement Deno, ni le parcours OAuth.

Recette du panneau : 320/375/430 px puis desktop, clavier iOS/Android ouvert,
safe areas, absence de débordement horizontal, champ ancré dans visualViewport,
Tab/Maj+Tab confinés, Échap/fermer et retour du focus, navigation mobile masquée.
Tester Entrée, Maj+Entrée et composition IME ; réduction des animations ; trois
étapes observées dans l'onglet Réseau, suggestions, vide, erreurs et quota.
Ouvrir un résultat dans la grille ou les liens internes puis revenir à Léo.
Aucune URL Supabase (Auth/REST/Storage/Functions) ne doit figurer dans Cache Storage.

Les résultats des commandes réellement exécutées pendant le lot figurent dans
le rapport de livraison. Toutes les actions Supabase/Google et la recette sur
appareils physiques restent à effectuer manuellement, sauf mention vérifiée.
