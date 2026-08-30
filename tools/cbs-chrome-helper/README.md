# Thunder Bowl CBS Helper

This unpacked Chrome extension performs one user-triggered, read-only capture of the 12 Thunder Bowl team pages. It does not read passwords, cookies, browsing history, or unrelated pages; it does not write to CBS. It opens one inactive CBS tab, visits the 12 known team pages, returns the structured roster/salary/contract snapshot to the Thunder Bowl Admin page, and closes the tab.

Installation is intentionally manual because Chrome requires the user to approve extension permissions:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Sign in to the Thunder Bowl CBS league in the same Chrome profile.
5. In Thunder Bowl, either open **Admin & data** and choose **Capture current CBS rosters**, or open **In-Season GM** and choose **Sync private league data**.

The helper is deliberately user-triggered. CBS has no stable league API used by this project, so the in-season service never stores CBS credentials, cookies, or session tokens and never pretends that the private league sync is unattended.

Do not install until the helper has passed browser QA and the user has explicitly approved installation.
