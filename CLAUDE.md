# AmphixDocs — instructions de travail

## Mission et étapes

AmphixDocs est une SPA française de partage de documents, avec authentification Google, dépôt dans Supabase Storage, métadonnées PostgreSQL et validation par une personne administratrice.

- **PHASE 1 : ANALYSE (lecture seule, ne modifie AUCUN fichier de code).** Seuls les documents demandés peuvent être créés. Exécuter les contrôles, documenter l'existant et les limites, puis s'arrêter.
- **PHASE 2 : uniquement après le feu vert explicite de l'utilisateur.** Suivre `docs/ROADMAP.md` dans l'ordre, par étapes cohérentes. Cocher une tâche seulement une fois réalisée et vérifiée.
- Après chaque étape d'implémentation : `npx tsc --noEmit`, puis `npm run build`. Corriger les échecs avant de poursuivre. Exécuter également le lint et les tests concernés lorsqu'ils existent.
- Ne pas confondre un build Vite réussi avec une validation TypeScript, une validation des RLS ou un test OAuth réel.

## Commandes — Windows / PowerShell

Les versions verrouillées de Vite et de son plugin React demandent Node.js `^20.19.0 || >=22.12.0`. Choisir une version maintenue compatible ; les prérequis Node 18 du README sont obsolètes pour ce verrouillage.

```powershell
node --version
npm --version
npm run dev              # http://localhost:3000, écoute sur 0.0.0.0
npx tsc --noEmit         # Contrôle des types
npm run lint            # Actuellement un alias de tsc --noEmit, pas ESLint
npm run build           # Génère dist/ et le service worker ; ne lance pas tsc
npm run preview         # Sert le build local
npm run generate:icons  # Régénère les PNG : seulement si cette écriture est autorisée
```

- `npm install` / `npm ci` ne sont pas des contrôles en lecture seule : ils peuvent changer les dépendances ou `node_modules`. Ne pas réinstaller pour masquer une erreur d'audit.
- Utiliser npm et `package-lock.json` pour les commandes ci-dessus. `bun.lock` est aussi présent et doit être réconcilié avec le manifeste avant d'utiliser Bun ; ne pas le supprimer sans accord.
- Aucun script de tests automatisés ni véritable lint ESLint n'est configuré dans `package.json` à la date de l'audit.
- **Ne pas exécuter `npm run clean` pendant l'audit** : ce script supprime `dist` et `server.js` et utilise une commande Unix.
- Ne lance pas `npm audit fix --force`.
- Pour tester une API sous PowerShell, préférer `Invoke-RestMethod` à `curl`. Ne jamais afficher une clé ou un jeton dans les logs.
- RTK peut réécrire les commandes via le hook global. Pour les commandes propres à RTK, appeler directement `rtk gain`, `rtk gain --history`, `rtk discover` ou `rtk proxy` selon le besoin.

### Graphify avant exploration

```powershell
Test-Path -LiteralPath "graphify-out/graph.json"
# Si le graphe existe :
python -m graphify query "<question ciblée>" --budget 800
python -m graphify query "<flux précis>" --dfs
python -m graphify path "<ConceptA>" "<ConceptB>"
```

Si le graphe est absent et le corpus petit, proposer `! python -m graphify . --html` pour le premier build, sans le lancer implicitement pendant une phase en lecture seule. Après chaque modification de code, utiliser `python -m graphify . --update`, jamais un rebuild complet. Une demande `/graphify` doit charger les instructions du skill installé avant toute autre action.

## Structure actuelle

```text
src/
  main.tsx                     # Entrée React et import CSS
  App.tsx                      # AuthProvider, router, PWA, configuration Supabase
  pages/
    LandingPage.tsx             # /
    DashboardPage.tsx           # /dashboard, protégé
    AdminPage.tsx               # /admin, rôle administrateur
  context/AuthContext.tsx       # Session et profil, état d'authentification
  lib/supabase.ts               # Client, types, helpers CRUD et branche démo existante
  components/
    ProtectedRoute.tsx / AdminRoute.tsx
    UploadModal.tsx             # Dépôt
    FileCard.tsx / FolderCard.tsx / FolderView.tsx
    PendingList.tsx / UsersTable.tsx
    mobile/                    # Navigation et bottom sheets
    pwa/                       # Installation, mise à jour, hors-ligne
    ui/                        # GlyphPortal et re-export du footer
  hooks/                       # PWA, viewport mobile, direction de scroll
  index.css                    # Tailwind v4, styles et utilitaires
components/ui/sticker-slap-footer.tsx  # Implémentation protégée, importée via re-export
supabase/
  schema.sql
  migration_v2.sql
public/                        # Icônes et ressources publiques
scripts/generate-icons.js      # Conversion des icônes avec sharp
vite.config.ts                 # React, Tailwind et vite-plugin-pwa
vercel.json                    # Déploiement SPA
```

Documents de référence :
- `docs/ARCHITECTURE.md` : état observé, diagrammes, audit fonctionnel et résultats des contrôles.
- `docs/ROADMAP.md` : corrections et travaux P0/P1/P2, avec critères de validation.
- `docs/CHECKLIST_MANUELLE.md` : configuration et vérifications Supabase / Google Cloud / navigateur.

## Conventions

- Interface, messages d'erreur et textes d'aide en **français**.
- React fonctionnel, TypeScript, hooks existants ; indentation de deux espaces.
- Tailwind **v4**, intégré avec `@tailwindcss/vite`. Ne pas ajouter une configuration v3 par habitude.
- Animations via **`motion/react`**, pas via une dépendance `framer-motion` supposée.
- L'alias `@/*` pointe actuellement vers la racine du projet ; ne pas supposer qu'il signifie `src/*`.
- Garder les types et contrats Supabase alignés avec les migrations. Éviter les casts qui cachent des erreurs de colonnes ou de nullabilité.
- Traiter séparément chargement, absence de résultat et erreur ; rendre une erreur actionnable, avec possibilité de réessayer. Ne pas se contenter de `console.error` pour un parcours utilisateur.
- Ne pas présenter des fixtures, des comptes démo ou un minuteur de progression comme des résultats de production.
- Toute écriture Storage + SQL doit prévoir l'échec partiel et la récupération/compensation. Ne retirer des éléments de l'interface qu'après confirmation effective de l'opération.
- Vérifier les opérations administratrices avec les RLS effectives, pas seulement avec les boutons et les guards React.

## Contrat produit à préserver

- `/` : navbar, hero, fonctionnalités, fonctionnement, CTA et footer.
- `/dashboard` : accueil **action d'abord**, seulement grande recherche et bouton de dépôt ; catégories, dossiers et fichiers après recherche. Ouvrir un dossier affiche ses fichiers.
- Dépôt réel : drag-and-drop, titre, description limitée à 200 caractères, catégorie, dossier existant ou nouveau, limite de 20 Mo par fichier, transfert Storage et métadonnées SQL, progression honnête et erreurs explicites.
- Fichiers et dossiers : `pending`, `approved`, `rejected`. L'auteur voit ses éléments avec badge ; les autres utilisateurs ne voient que les éléments approuvés. L'administration dispose des droits nécessaires à la modération.
- `/admin` : réservé à `profiles.role = 'admin'`, avec « À approuver » et « Inscriptions ». Le motif de refus, l'aperçu, l'approbation collective et la promotion de rôle doivent fonctionner réellement.
- Navigation mobile en pilule : Accueil, Recherche, « + » central orange, Dossiers, Profil. Les actions doivent être reliées à l'état du dashboard, pas à des hashes inertes.
- PWA : manifest et icônes, hors-ligne, installation et mise à jour ; **jamais de cache des appels Supabase** (Auth, REST, Storage, URL signée ou temps réel).

## Design et accessibilité

| Token | Couleur |
| --- | --- |
| Papier | `#f1ece4` |
| Cobalt | `#4a6cf0` |
| Encre | `#141414` |
| Orange | `#ff6a2b` |
| Orange clair | `#ff8a4c` |
| Jaune | `#ffd23f` |
| Bleu clair | `#9ab8ff` |
| Rose | `#ffb6e1` |
| Violet | `#1b1230` |

- Typographie **DM Sans**, coins très arrondis, effets slap/autocollants, ressorts rebondissants et animations de layout.
- Préserver cette identité pendant les corrections ; respecter `prefers-reduced-motion`, y compris dans les animations JavaScript, les boucles, les flips 3D et les transitions de pages.
- Utiliser de vrais boutons/liens pour les interactions ; labels associés, focus visible, états sélectionnés annoncés.
- Dialogues/bottom sheets : nom accessible, focus initial, confinement du focus, fermeture Échap lorsqu'elle est sûre, restauration du focus et gestion du scroll de fond.
- Mobile : safe areas, hauteurs dynamiques `100dvh`/`dvh`, clavier ouvert, scroll interne sans débordement horizontal de la page. Tester à 320 px et sur iOS/Android.
- Configurer le footer **uniquement par les props de son appel** : français, aucun réseau social, aucun bouton credits. Ne pas modifier son implémentation ni le re-export pour contourner cette règle.

## Contraintes impératives

- Environnement : Windows + PowerShell (utilise des commandes compatibles ; pour tester une API, préfère Invoke-RestMethod à curl).
- Ne modifie pas la version d'esbuild (`^0.28.0`) ni ne force de résolution de dépendances sans me demander.
- Ne modifie jamais `components/ui/sticker-slap-footer.tsx`.
- Ne commite aucun secret ; ne supprime aucun fichier sans me demander.
- Si une information manque (clés, choix produit), pose-moi la question au lieu d'inventer.

De plus :
- Aucune clé `service_role`, clé privée Google ou clé Gemini dans le code livré au navigateur. Une variable `VITE_*` est publique à la compilation.
- Ne pas lire/recopier les valeurs de `.env` dans la documentation. Utiliser des placeholders et vérifier les exclusions Git avant tout futur commit.
- Aucune opération Supabase distante, modification de provider OAuth, SQL exécuté en production ou publication/déploiement sans autorisation adaptée. Les instructions manuelles ne signifient pas que ces étapes ont été vérifiées.
- Ne pas initialiser Git, créer de commit ou pousser des changements sans demande. Si un commit est demandé et que la branche est la branche par défaut, créer une branche de travail d'abord.
- Lorsqu'un commit est demandé, terminer le message par `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Lorsqu'une PR est demandée, terminer sa description par `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
