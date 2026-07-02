# Savings Bond Wizard Pro

A free, browser-based portfolio manager for **U.S. Treasury I & EE Savings Bonds**.

Track your paper-bond inventory, model cash-out scenarios, estimate the federal tax you may owe on accrued interest, and import or export the official U.S. Treasury inventory format — all without sending a single byte of your data to a server.

🌐 **Live demo:** `https://(your-username).github.io/SBWPro/`
_(after enabling GitHub Pages — see deployment below)_

---

## ✨ Features

- 📊 **Portfolio dashboard** — face value, accrued interest, average coupon rate, and a Series I vs. EE breakdown.
- 🧮 **Federal tax estimator** — pick your marginal bracket, select bonds you plan to cash out, and instantly see taxable interest, tax due, and net proceeds (with a higher-education exclusion toggle).
- 📥 **Import** from the official U.S. Treasury Savings Bond Calculator HTML file or a generic CSV inventory.
- 📤 **Export** your inventory back out as a Treasury-compatible HTML file or standard CSV.
- 🌗 **Light & dark mode**, with persisted preferences.
- 🔍 **Search, filter, and sort** by serial, series, maturity status, or marked-for-cash-out.
- ➕ **Manual entry** of bonds not yet in your Treasury file.
- 🔒 **100 % client-side** — all bonds, notes, theme, and tax preferences live in your browser's `localStorage`. Nothing is uploaded.

---

## 🚀 Local development

**Prerequisites:** Node.js 18+ and `npm`.

```bash
# 1. Install dependencies
npm install

# 2. Start the Vite dev server on http://localhost:3000
npm run dev

# 3. Build a production bundle into ./dist
npm run build

# 4. Preview the production bundle locally
npm run preview
```

### Useful scripts

| Script          | What it does                                |
| --------------- | ------------------------------------------- |
| `npm run dev`   | Start the dev server with HMR on port 3000  |
| `npm run build` | Type-check + produce a static `dist/` folder |
| `npm run preview` | Serve the built `dist/` locally            |
| `npm run lint`  | Run the TypeScript type-checker (`tsc --noEmit`) |
| `npm run clean` | Remove the `dist/` build folder            |

---

## 🌐 Deploying to GitHub Pages

This repo is pre-configured for GitHub Pages at **`https://(your-username).github.io/SBWPro/`** — the `base` path in `vite.config.ts` is set to `/SBWPro/` to match the repository name.

### One-time setup

The workflow at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) automatically enables GitHub Pages for you (via the `enablement: 'true'` input on `actions/configure-pages@v5`), so in most cases you don't need to touch any settings yourself — just push to `main` and the site will appear at your Pages URL within a minute.

> **If the very first deploy fails with `Get Pages site failed... Error: Not Found`:**
> that means GitHub hasn't initialized the Pages resource for the repository yet. Open **Settings → Pages**, pick **GitHub Actions** as the build source (you don't need to commit anything), then push again. On every subsequent run the workflow handles enablement itself.

_(Optional but recommended)_ Confirm that the repository visibility is **Public** so Pages can serve it.

### Every push to `main`

A workflow defined at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) takes care of everything:

1. Checks out the repository.
2. Sets up Node.js 20 with the npm cache primed.
3. Runs `npm ci` for a clean, reproducible install from `package-lock.json`.
4. Runs `npm run lint` to type-check the TypeScript sources.
5. Runs `npm run build` to produce the static `dist/` folder.
6. Uploads the artifact and publishes it to GitHub Pages via the official `actions/deploy-pages` action.

The site will go live within ~60 seconds of every commit to `main`. The action creates a `github-pages` deployment environment so each release shows up under the **Environments** tab with its URL.

### Manual deploys

You can also trigger a deploy from the **Actions → Deploy to GitHub Pages → Run workflow** button on any branch — useful for previewing a PR's build before merging.

### ⚙️ Publishing from a different repo name?

Edit the `base` value in [`vite.config.ts`](./vite.config.ts):

```ts
base: '/your-repo-name/',   // ← change this to match your repo
```

If you intend to publish at a custom user/organization root (`https://(user).github.io`) and rename the repo to `(user).github.io`, use `base: '/'` instead.

---

## 🗂️ Project structure

```
.
├── LICENSE                 # MIT License
├── README.md               # You are here
├── index.html              # Vite entry HTML (sets <title>)
├── package.json            # npm manifest (scripts + dependencies)
├── package-lock.json       # Lockfile consumed by `npm ci` in CI
├── tsconfig.json           # TypeScript config (paths, JSX, lib)
├── vite.config.ts          # Vite config (base path, plugins, aliases)
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions: build + publish to Pages
└── src/
    ├── main.tsx            # React entry — mounts <App />
    ├── App.tsx             # Top-level component (dashboard, table, forms, charts)
    ├── index.css           # Tailwind CSS v4 entry
    ├── types.ts            # Shared TypeScript types
    ├── data/
    │   └── sampleBonds.ts  # 53-bond sample portfolio matching the Treasury calculator
    └── utils/
        └── bondParser.ts   # HTML/CSV parser & generator for Treasury imports
```

The repository also contains a `.gitignore` that excludes `node_modules/`, `dist/`, and other build artifacts.

---

## 🧾 Importing from the U.S. Treasury Savings Bond Calculator

1. Visit the official [Treasury Savings Bond Calculator](https://www.savingsbonds.gov/sb/calc.htm).
2. Enter your bonds and click **Calculate**.
3. In your browser, choose **File → Save Page As…** and save the result as **`.html`** (not `.htm`).
4. Open **Savings Bond Wizard Pro**, drop the saved file onto the import area in the sidebar.
   (It can also be a `.csv` you exported from this app or any spreadsheet with the same column layout.)

Duplicates are detected automatically by serial number and skipped.

---

## 🛡️ Privacy

- **No tracking, no analytics, no backend.**
- All portfolio data, theme, and tax preferences are stored in **`localStorage`** on your device.
- Import and export operations read/write files **entirely in your browser** via the standard `FileReader` / `Blob` APIs.

---

## 📜 Disclaimer

Savings Bond Wizard Pro is an **educational and informational tool**. It does not provide tax, legal, or financial advice and does not replace official U.S. Treasury records. Always verify critical figures against [TreasuryDirect.gov](https://www.treasurydirect.gov/) or a qualified tax professional before acting.

---

## 📄 License

Released under the [MIT License](./LICENSE). You can fork, modify, and redistribute this project (including for commercial purposes) provided the copyright notice and permission notice are preserved.

> The license file ships with placeholder copyright-holder text — edit `LICENSE` to put your name or organization on line 3 before publishing if you'd like to be credited as the copyright holder.
