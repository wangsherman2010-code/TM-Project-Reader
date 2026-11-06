# TM Project Viewer

A small phone-first web app for reading Toastmasters project PDFs comfortably.
Add a PDF, and it is turned into large, easy-to-read sections that you page through with
**Back / Next**. Fillable boxes in the PDF become real answer boxes, checklists become tick boxes,
and everything you open stays on a **bookshelf** so you can switch between documents.

* Installs to the home screen like an app (PWA) and **works offline**.
* **Private:** PDFs and your answers are stored only on your phone (in the browser's IndexedDB). Nothing is uploaded; there is no server.
* Big text with **A− / A+**, **light / dark** switch, swipe left/right to change section.
* Fillable PDF fields, checkboxes and a **notes box in every section**; **Copy my answers** exports them as text.
* **View original pages** at any time (with zoom) if the converted text ever looks off. Scanned PDFs show the original pages.
* No build step, no accounts, no tracking. Plain HTML/CSS/JS.

> Unofficial tool. Not affiliated with or endorsed by Toastmasters International. Project documents
> belong to their owners and are not included in this repository; you add your own PDFs.

## Put it on GitHub Pages (about 5 minutes, no coding)

1. Sign in at <https://github.com> and click **New repository**. Name it e.g. `tm-project-viewer`, keep it **Public**, click **Create repository**.
2. On the new repo page click **uploading an existing file**. Open this folder on your computer, press **Ctrl+A** (select all) and drag
   **all the files** in. There are no sub-folders, so every file must appear in the upload list
   (the app files, `pdf.min.js`, `pdf.worker.min.js` and the `.png` icons). Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment* choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is live at `https://YOUR-USERNAME.github.io/tm-project-viewer/` (shown at the top of the Pages screen).

Using the command line instead:

```bash
git init && git add . && git commit -m "TM Project Viewer"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/tm-project-viewer.git
git push -u origin main      # then enable Pages as in step 3
```

## Install on your phone

* **Android (Chrome):** open your site address, tap **⋮ → Install app** (or **Add to Home screen**). The app also shows an **Install** button on the bookshelf.
* **iPhone / iPad (Safari):** open the address, tap **Share → Add to Home Screen**.

Open the installed app once while online; after that it works without internet.

## Using it

1. Download a project PDF to your phone (for example from Toastmasters Base Camp).
2. Open **TM Project Viewer** and tap **＋ Add PDF**. Pick one or several PDFs.
3. Read with **Back / Next**, tap **☰ Contents** to jump, **View original pages** to see the PDF itself.
4. Type in the boxes and tick the checklist. Everything saves automatically.
5. Tap **⋯** on a book to rename or remove it. **Contents → Copy my answers** copies everything you wrote.

Each browser on each phone has its own bookshelf. Clearing the browser's site data (or uninstalling the app in some browsers) deletes it.

## How it works

`parser.js` uses [PDF.js](https://mozilla.github.io/pdf.js/) (bundled, no CDN) to read each page's text
with its position and font. It drops page numbers and repeated headers, reads two-column pages in the right order,
detects headings by font size/weight, joins wrapped lines into paragraphs and bullets, places the PDF's form fields
and checkboxes where they appear, and splits the document into sections at the main headings.
The result and the original file are saved in IndexedDB. `app.js` is the bookshelf and reader; `sw.js` makes it work offline.

The conversion is best-effort. Documents with unusual layouts may need **View original pages**.

## Updating the app

After changing any file, edit `VERSION` in `sw.js` (for example `tmv-v2`) so phones fetch the new files.

## Run locally

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

## Licence

MIT for this app (see `LICENSE`). PDF.js is Apache-2.0 (`PDFJS-LICENSE.txt`).
