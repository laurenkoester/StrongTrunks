# Strong Trunks

Stanford Lightweight Rowing holiday training tracker. Log core, mobility and lift sessions to grow your tree.

## Setup (one time)

1. **Upload these files** to the root of this repo (drag them into GitHub's "Add file → Upload files"):
   `index.html`, `app.js`, `backend.js`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `firestore.rules`.
2. **Publish the database rules.** Firebase console → Build → Firestore Database → **Rules** tab. Delete what's there, paste the contents of `firestore.rules`, click **Publish**.
3. **Approve the site address.** Firebase console → Authentication → **Settings** → Authorized domains → Add domain: `laurenkoester.github.io`.
4. **Turn on GitHub Pages.** Repo → Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save. After a minute or two the app is live at `https://laurenkoester.github.io/StrongTrunks/`.

## Using it

Everyone signs in with Google and picks their name once. That links the name to their account, so only they can log for that tree. Everyone can see the whole forest. Tapping "Not you?" releases a name picked by mistake.

To put it on a phone: open the link, then Share → Add to Home Screen (iPhone) or menu → Install app / Add to Home screen (Android).

## Admin

Wrong name claimed, or need to reset a tree? Firebase console → Firestore Database → Data → `trees` → edit or delete the document. Console edits bypass the rules.

## Seasons

The theme switches by date: fall through Thanksgiving (Nov 26, 2026), winter from Nov 27. The date is `THANKSGIVING` near the top of `app.js`.
