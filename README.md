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

### How the deploy works

A workflow defined at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builds the project on every push to `main` (or `master`) and publishes the contents of `dist/` to a dedicated **`gh-pages` branch** using [`peaceiris/actions-gh-pages@v4`](https://github.com/peaceiris/actions-gh-pages). GitHub Pages then statically serves that branch.

This pattern is intentionally chosen over the newer `actions/deploy-pages@v4` approach because it has the simplest, most reliable UI flow on the GitHub side — **Source = "Deploy from a branch"** works every time and always shows a Save button, regardless of how GitHub detects your repo's defaults.

### One-time setup

1. **Push to `main` (or `master`) once** to let the workflow run and create the `gh-pages` branch. (Until you've done this, the branch won't exist yet, so step 2 will have nothing to point at.)
2. **Settings → Pages → Build and deployment → Source**: choose **"Deploy from a branch"**.
3. In the Branch dropdown: pick **`gh-pages`** and **`/ (root)`**.
4. Click **Save** — this is the Save button you found earlier. Once the page refreshes, you'll see your site URL at the top: `https://(your-username).github.io/SBWPro/`.

The first deploy usually takes 30–60 seconds after the workflow run completes (Pages polls for changes on the `gh-pages` branch).

### Every push to `main` / `master`

The workflow automatically:

1. Checks out the repo and installs Node 20 (with npm cache).
2. Runs `npm ci` for a clean, reproducible install from `package-lock.json`.
3. Runs `npm run lint` to type-check the TypeScript sources.
4. Runs `npm run build` to produce the static `dist/` folder.
5. Force-overwrites the `gh-pages` branch with the `dist/` contents (one commit per deploy, no historical cruft).

### Manual deploys

You can also trigger a deploy from the **Actions → Build and Deploy → Run workflow** button on any branch — useful for previewing a PR's build before merging.

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

## 📚 User Guide — Getting started

When you open the app for the first time, your portfolio starts **empty** — no sample bonds are preloaded. You pick how the inventory begins. There are three ways:

### Option A — Import your real bonds from TreasuryDirect (recommended)

The fastest path: drop a saved HTML report from the official calculator straight into the import area. Step by step:

1. **Open the [TreasuryDirect Savings Bond Calculator](https://www.treasurydirect.gov/BC/SBCPrice)** in a new tab.
   - Sign in to your TreasuryDirect account (recommended — it fills in the bonds you own automatically).
   - Or, if you don't have an account, click **“Calculate”** in the **“Don't have a TreasuryDirect account?”** section at the very bottom of that page and enter each bond by hand. You'll need each bond's:
     - **Serial number** (printed on the paper bond)
     - **Denomination** (e.g. $50, $100, $500)
     - **Issue date** (Month / Year)
2. Click **Calculate.** The page displays your portfolio with current cash values and a 30-year final-maturity date for each bond.
3. **Save the page to your computer.** Keyboard shortcut: **Ctrl+S** (Windows / Linux) or **Cmd+S** (Mac). When your browser asks which format:
   - **Chrome / Edge:** choose *“Webpage, HTML Only.”* (Filename should end in `.html`.)
   - **Firefox:** choose *“Webpage, Complete.”* (Filename may end in `.html` or `.htm`.)
   - **Safari:** File → Save As, then change **Format** to *Page Source.*

   > ❌ Don't pick “Webpage, Single File” (`.mhtml`), “Web Archive” (`.webarchive`), or “PDF” — those formats won't parse.
4. **Back in Savings Bond Wizard Pro**, find the **“Drop files here or click to browse”** drop zone in the right sidebar (under *Import & Export Inventory*).
5. **Drag the saved file** onto that drop zone (or click to browse to it). The app will parse your bonds in under a second and populate the table.
6. **You're done.** You can now:
   - See your portfolio's total face value, accrued interest, average coupon rate, and the matured-bond warning at the top.
   - Click the pencil icon on any row to add a note (e.g. “Gift from Grandma”).
   - Check the gray square at the left of each bond to mark it for cash-out, then read the *Federal Tax Estimator* panel to see interest subject to tax, tax due, and net proceeds.
   - **Re-import later** when values have updated — duplicates (matched by serial number) are skipped automatically, so it's safe to drop in a fresh report anytime. **You never need to clear your portfolio first.**

### Option B — Add bonds manually

Click the amber **“New Bond Entry +”** button just above the bonds table. For each bond, fill in:

| Field          | Example                            |
| -------------- | ---------------------------------- |
| Series         | `I` (inflation-linked) or `EE`     |
| Serial number  | `C12345678EI`                      |
| Denomination   | `$50`, `$100`, `$500`, `$1,000`…   |
| Issue date     | `07/2010` (MM/YYYY)                |
| Interest rate  | `3.5` (percent)                    |
| Current value  | Auto-estimated — leave blank to use the heuristic |
| Note           | *(optional)* “Birthday 2020”, “Inherited”, etc. |

Click **Save Bond** to add it. Use this option if you have only one or two bonds or want to fill in any field manually that the TreasuryDirect report missed.

### Option C — Explore with the sample portfolio

Click **“Load Sample”** in the page header to populate a 53-bond portfolio that mirrors the official Treasury calculator's example output. Use this to:
- See the dashboard and tax estimator without entering any real data.
- Verify that page totals and tax math match what the Treasury site would show.
- Hand off a known shape to anyone who wants to test against it.

The sample is destructive — it replaces your current portfolio (with a confirmation dialog).

### CSV import (advanced)

If you maintain your bonds in a spreadsheet, export it as CSV with these columns (first row may be a header):

```
serial, series, denomination, issueDate, finalMaturity,
issuePrice, interest, interestRate, value, nextAccrual, note
```

Then drop the `.csv` onto the same import area. Duplicates (matched by serial number) are skipped.

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
