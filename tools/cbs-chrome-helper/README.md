# Thunder Bowl CBS Helper

This unpacked Chrome extension performs one user-triggered, read-only capture of the 12 Thunder Bowl team pages. It does not read passwords, cookies, browsing history, or unrelated pages; it does not write to CBS. It opens one inactive CBS tab, visits the 12 known team pages, returns the structured roster/salary/contract snapshot to the Thunder Bowl Admin page, and closes the tab.

Installation is intentionally manual because Chrome requires the user to approve extension permissions:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Sign in to the Thunder Bowl CBS league in the same Chrome profile.
5. In Thunder Bowl, open **Admin & data** and choose **Capture current CBS rosters**.

Do not install until the helper has passed browser QA and the user has explicitly approved installation.

