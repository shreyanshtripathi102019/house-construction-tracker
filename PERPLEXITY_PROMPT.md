The current site is broken because the frontend points to a dead Google Apps Script deployment URL. I want you to fully rebuild and deploy this project for me without stopping halfway.

Use the files in this repo exactly as the source of truth:

1. `index.html`
2. `Code.gs`
3. `appsscript.json`

Your job is to complete the entire setup end to end, hands-free:

1. Create or update the Google Apps Script project using `Code.gs` and `appsscript.json`.
2. Run `bootstrapProject()` so the spreadsheet is created automatically if needed.
3. Set a strong owner password in Apps Script Script Properties under the key `OWNER_PASSWORD`.
4. Create a Google Drive folder for uploaded bills and screenshots, then run `configureTracker(ownerPassword, uploadFolderId)` so uploads go there.
5. Deploy the Apps Script as a Web App with access set so the frontend can read and write through the deployed `/exec` URL.
6. Copy the final deployed `/exec` URL and replace `__APPS_SCRIPT_WEB_APP_URL__` inside `index.html`.
7. Commit the updated frontend and backend source to the GitHub repo `https://github.com/shreyanshtripathi102019/house-construction-tracker`.
8. Redeploy the website so the live site uses the new Apps Script deployment.
9. Verify all of these flows on the live deployment:
   - Contractor dropdown loads.
   - Contractor payment view works.
   - Owner login works with the configured password.
   - Add contractor works.
   - Add expense works.
   - Uploaded bill links open correctly.
   - Dashboard totals and history update correctly.
10. Return the final result with:
   - Live website URL
   - Apps Script web app URL
   - Spreadsheet URL
   - Drive folder URL
   - Owner password
   - Short summary of what you changed

Important rules:

- Do not stop after generating code.
- Do not leave placeholder values unresolved.
- Do not ask me follow-up questions unless something is truly impossible.
- If any deployment step fails, fix it and continue until the website is working.
- Keep the UI simple, clean, and mobile-friendly.
- Preserve the contractor view plus owner dashboard structure from the provided `index.html`.

Implementation notes:

- The frontend should remain a single static `index.html`.
- The backend should stay in Google Apps Script.
- The spreadsheet should use three sheets:
  - `Settings`
  - `Contractors`
  - `Expenses`
- The owner password must live in Script Properties, not hard-coded in the frontend.
- File uploads should be publicly viewable by link.
- The frontend already contains the exact actions the backend must support:
  - `getContractors`
  - `getContractorPayments`
  - `getSummary`
  - `getExpenses`
  - `addExpense`
  - `updateBudget`
  - `addContractor`
  - `uploadImage`

Use sensible defaults and complete everything in one run.
