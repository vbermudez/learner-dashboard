# LearnerDashboard

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

Important: `ng serve` is for development only. It does not represent final offline PWA behavior.

## Run As Real PWA (Offline-Ready)

Use the production build and static server to test install/offline behavior:

```bash
npm run start:pwa
```

This runs:

- `build:pwa`: production build with service worker
- `serve:pwa`: serves `dist/learner-dashboard` at `http://localhost:4300`

Then:

1. Open `http://localhost:4300`
2. Install the app from the Install button
3. Navigate through the app once while online so assets are cached
4. Turn off network and reopen the installed app (or reload page)

Expected behavior:

- App shell and cached content remain available offline
- Downloads and extractor backend calls require network
- Downloaded H5P, SCORM, and TinCan zip packages are extracted locally right before launch
- Only one extracted runtime is kept at a time; switching courses clears the previous extracted files but preserves downloaded zip caches

If you close local hosting completely and the browser cannot resolve the local origin anymore, behavior is browser/platform dependent. For fully robust offline launch, host this PWA on a stable HTTPS origin (or package as a native desktop app wrapper).

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Package Extractor Backend Contract

The learner dashboard includes a runtime preparation flow for H5P/SCORM/TinCan packages.

- Angular client service: `src/app/services/package-extractor-api.service.ts`
- Shared contract models: `src/app/models/package-extractor-contract.model.ts`
- Contract example payload: `public/api-contracts/package-extractor.contract.json`

Expected endpoint:

```text
POST /api/package-extractor/extract
Content-Type: multipart/form-data
```

The backend should return `contentBaseUrl` and either `recommendedLaunchUrl` or `recommendedLaunchPath`. The app will auto-populate the resource `Launch URL` from that response.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
