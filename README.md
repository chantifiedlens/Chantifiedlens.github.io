# Chantified Lens · Repository showcase

A lightweight, technology-first discovery site for the public repositories of **chantifiedlens**. Built with **Eleventy 3**, reusable **Nunjucks** templates, plain CSS and optional vanilla JavaScript. GitHub data is retrieved at build time; published pages require **no server, runtime API calls or visitor authentication**.

## Local development

Requires Node.js 22 or later (CI uses Node 24) and npm.

1. Install dependencies with `npm ci`.
2. Run `npm start` to fetch current public data and serve the site at `http://localhost:8080`.
3. Run `npm run check` to test, refresh, build and validate generated links/images.

`npm run build` retrieves data and writes static pages to `_site/`. `npm run refresh` only updates the data. Once a valid snapshot exists, `npm run build:cached` and `npm run start:cached` work without an API refresh. Stop a development server with Ctrl+C. Edit `src/`, `config/` or the original images to trigger a rebuild; fetching is deliberately not repeated on each file change.

The ignored `.env` file optionally accepts `GITHUB_TOKEN` for authenticated local builds. An empty value uses GitHub’s public API (normally 60 requests/hour per IP versus 5,000/hour for many authenticated requests). Never commit tokens. `.env.example` documents the optional variable. CI uses the built-in `${{ secrets.GITHUB_TOKEN }}` with read-only contents permissions—no personal access token setup is needed. Tokens are used only in server-side build request headers, never included in generated HTML, browser JavaScript or snapshots. No `.env` file is copied to `_site`.

## Publish to GitHub Pages

1. Commit this source, including `package-lock.json`, to `Chantifiedlens.github.io` under the **chantifiedlens** account. Push to `main` or `master`. The current directory did not contain Git metadata when this site was created; initialise/connect your repository if needed.
2. In GitHub **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Run **Build and deploy repository showcase** from the Actions tab or push a change.

The workflow checks out code, installs locked dependencies, runs tests, restores a last-known-good public data cache, fetches GitHub repositories, builds and validates the static pages, uploads the Pages artifact and deploys it. Only the deploy job receives `pages: write` and `id-token: write`. Pull requests build/test but do not deploy or save trusted snapshots.

Refreshes happen on pushes, manually and daily at **03:17 UTC**, so changing topics in another repository does not require editing this site. Scheduled runs use the default branch; GitHub can delay schedules and disables scheduled workflows in inactive public repositories after 60 days. Re-enable the workflow if needed.

An account-site repository such as this one publishes at `https://chantifiedlens.github.io/`. Project sites also work: Pages provides its base path to the build. Locally, `SITE_PATH_PREFIX=/repository-name/` can test a project-site build; it must start/end with `/`. The generated routes remain clean, trailing-slash URLs.

## Organisation and topic rules

Technology-first navigation answers **“I use X with Y; where should I look?”** The homepage links to technology hubs and every workflow category. `/repositories/` is the full catalog with search, category filtering, sorting and a templates-only filter. All public repositories—including forks, archived repositories and this website repository—are included. None are silently excluded because they lack topics or descriptions.

Rules live only in `config/categories.mjs`, independently of UI templates:

| Category | Required topics | Additional rule |
| --- | --- | --- |
| Fabric + GitHub Actions | `microsoft-fabric`, `github-actions` | — |
| Fabric + Azure DevOps | `microsoft-fabric`, `azure-devops` | — |
| Miscellaneous Fabric | `microsoft-fabric` | Neither `github-actions` nor `azure-devops` |
| Synapse + GitHub Actions | `azure-synapse-analytics`, `github-actions` | — |
| Synapse + Azure DevOps | `azure-synapse-analytics`, `azure-devops` | — |
| SQL Server + GitHub Actions | `github-actions` | Either `sqlserver` or `sql-server` |
| SQL Server + Azure DevOps | `azure-devops` | Either `sqlserver` or `sql-server` |
| Azure SQL + GitHub Actions | `azure-sql-database`, `github-actions` | — |
| Other | — | No primary category matches |

**Predictable overlap:** topic strings are trimmed, lowercased and deduplicated. Matching is exact, not substring-based; names and descriptions never influence categorisation. Every non-fallback rule is evaluated independently. A repo tagged with Fabric, Synapse and both CI/CD platforms appears in all four matching workflow categories, **once per page**. There is no arbitrary winner or hidden primary category. Global and technology listings deduplicate by repository ID. Category ordering controls presentation, not priority. Fabric miscellaneous is explicitly mutually exclusive with either CI/CD topic. Other is a fallback only, never an extra duplicate category. Search/filtering does not make new API requests and works on the already-rendered cards; without JavaScript, every card and navigation link remains available.

### Add a category or technology

1. Add a definition to `categories` in `config/categories.mjs`, giving it a unique `id`, `technology`, `platform`, `title` and `path`.
2. Supply topic arrays: `all` requires every topic, `any` requires at least one if present, and `none` excludes every listed topic. Use lowercase exact topic names.
3. Set `icons` to existing icon keys, or add an `icons` entry with the image filename, useful alt text and original dimensions. Put new original assets in `images/`.
4. For a new technology, add its `id`, `name`, `description`, optional `icon` and `accent` (`green`, `blue`, `violet`, `slate`) to `technologies`.
5. Add matching tests and rebuild. Navigation, counts, hubs, category pages and filter options generate automatically. Reserve `other` for the fallback; use distinct route paths for hubs and categories.

For example, add a `power-bi` technology and a category with `all: ['power-bi', 'github-actions']`; no UI code needs to change. More workflows for Fabric, Data Factory, Purview and other data technologies follow the same pattern.

## Data handling and resilience

`lib/repositories.mjs` resolves `/users/chantifiedlens` to determine whether to use a user or organisation endpoint, requests **public** repositories with 100 results per page, and follows GitHub’s `Link` pagination until complete. Public repository ID is the deduplication key. Optional metadata is normalised, invalid/private/foreign records are ignored with a warning, and repository URLs are constructed from validated names and owner identifiers. Missing descriptions receive a useful README prompt; unknown dates, languages and stars are not fabricated. Archive/fork/template status and SPDX license names add useful context. Actual repository licensing governs reuse; a template label is not a license grant.

Requests time out after 15 seconds. Network failures and 5xx responses get up to three attempts with bounded backoff. Rate limits/access errors fail promptly rather than waiting indefinitely. Unexpected payloads or pagination origins/paths fail the refresh. Only a complete successful fetch is atomically saved to `data/repositories.json`; partial pages never replace a working snapshot.

On API failure, a schema-versioned, owner-matching, validated snapshot is used if available. The build logs the fallback and every page displays its retrieval date; snapshots over 48 hours old additionally display a freshness warning. GitHub Actions caches only the normalised public fields. If the cache has expired/been evicted and GitHub is unavailable, the build fails clearly instead of deploying a misleading empty catalog, leaving the previous successful Pages deployment intact. A successful API response with zero repositories is valid and displays graceful empty states. The local snapshot and `_site` are ignored—not manually maintained or committed.

## Project map

- `config/site.mjs` — account, identity and official documentation links.
- `config/categories.mjs` — technology/category definitions, image metadata and matching rules.
- `lib/repositories.mjs` — API pagination, normalisation, cache validation and classification decoration.
- `scripts/update-repositories.mjs` — build-time refresh; never runs in visitors’ browsers.
- `src/_includes/` — shared layout, headers, repository cards and listing macros.
- `src/*.njk` — homepage, full catalog and data-driven collection templates.
- `src/assets/` — responsive styles and optional browser filtering.
- `images/` — supplied originals, passed through **byte-for-byte** without filters or recolouring; CSS uses proportional sizing/object containment. The black GitHub mark stays on a light background. Both SQL Server workflow headers deliberately use the GitHub mark as specified.
- `test/` — Node’s built-in test runner; no test framework dependency.
- `scripts/check-site.mjs` — generated page count, local routes/anchors, document structure, global deduplication and unchanged image bytes.
- `.github/workflows/pages.yml` — automatic build, refresh and Pages deployment.

Accessibility includes semantic landmarks, one main heading per page, skip navigation, visible keyboard focus, labelled search controls, live result counts, explanatory empty states, useful product-image alternatives, explicit new-tab announcements, reduced-motion support and responsive layouts. Original logos are not used as substitutes for text labels. No external fonts, analytics, advertising or third-party client scripts are required.