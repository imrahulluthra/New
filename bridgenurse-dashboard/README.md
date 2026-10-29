# BridgeNurse survey dashboard on Google

The same dashboard as the Claude version (intent score, intent mix, gauge, candidate list with
details, pipeline, motivations and profile charts), hosted by Google Apps Script. Your team
opens a normal web link on any phone or computer. They need no Claude account and no
connector, and the Google Sheet can stay private.

It reads the sheet live: every time someone opens the page, taps **Refresh**, or comes back
to the tab, and every 5 minutes while it is open.

## What is in this folder

| File | What it is |
|---|---|
| `Code.gs` | Runs on Google's servers. Reads the sheet and removes emails, phone numbers and proof-file links before anything reaches a browser. |
| `Index.html` | The dashboard page. |

## Set it up (about 5 minutes, once)

1. Open the **BridgeNurse Google Sheet** while signed in to the Google account that owns it.
2. Go to **Extensions → Apps Script**. A new tab opens with a file called `Code.gs`.
3. Delete everything in `Code.gs`, then paste in the full contents of this folder's `Code.gs`.
4. Click the **+** next to *Files* → **HTML**, and name it exactly `Index` (Apps Script adds `.html`).
   Delete what is in it and paste in the full contents of this folder's `Index.html`.
5. Click **Save** (the disk icon).
6. Click **Deploy → New deployment**. Click the gear next to *Select type* and choose **Web app**.
   - **Description:** BridgeNurse dashboard
   - **Execute as:** **Me** (your account reads the sheet, so viewers don't need access to it)
   - **Who has access:** pick one:
     - **Anyone**: anyone with the link can open it, no Google sign-in needed.
     - **Anyone with a Google account**: viewers must be signed in to any Google account.
     - **Anyone within *your domain***: only people in your Google Workspace (shown only if you use Workspace).
7. Click **Deploy**. Google asks you to **Authorize access**: choose your account. If you see
   *"Google hasn't verified this app"*, click **Advanced → Go to (project name) (unsafe)**. This is
   normal for your own script; it only asks to read your spreadsheets.
8. Copy the **Web app URL** (ends in `/exec`) and share it with your team.

## Changing it later

- **Hide candidate names:** in `Code.gs`, set `SHOW_NAMES = false`. Names then show as "Candidate 12".
- **After any edit**, publish it: **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy**.
  The link stays the same.
- **Sheet or tab renamed:** update `SPREADSHEET_ID` or `SHEET_NAME` at the top of `Code.gs`.

## Privacy

- Emails, phone numbers and links to uploaded proof files never leave Google's servers. The page
  only learns whether a proof was uploaded.
- With **Who has access: Anyone**, anyone who gets the link sees candidate names, cities and
  workplaces. Use a Google-account or domain option, or set `SHOW_NAMES = false`, if that is too open.
- The sheet itself can be set back to **Restricted** in Google Sheets' Share settings. The web app
  still works because it runs as you.

## If something goes wrong

- **"The survey data couldn't be loaded"**: open the Apps Script project, run `getSurveyValues`
  once from the toolbar to see the error, and check the sheet ID and tab name.
- **"Authorization is required" or the page asks viewers to sign in**: check *Execute as: Me* and
  *Who has access* in **Deploy → Manage deployments**.
- **Old version showing**: you edited but didn't deploy a new version (see *Changing it later*).
