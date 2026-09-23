# Job Search

Private job search. Your resume stays in the browser. Search reads a saved feed from public company job boards.

The Mac app, mailbox sync, and scheduled runs live in the job autopilot project and are reached at `http://127.0.0.1:8787/` when that app is running.

## Install in Chrome with Load unpacked

The capture extension is not listed in the Chrome Web Store. Load it from this repository:

1. Download [job-autopilot-extension-1.0.0.zip](https://github.com/Ajeenckya5/job-search/releases/tag/ext-v1.0.0) and unzip it, or open the `extension` folder in a clone of this repository.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Choose **Load unpacked** and select that folder.
5. On [the public site](https://ajeenckya5.github.io/job-search/), open Settings, paste the extension id, and use **Import jobs saved by the extension**.

The extension reads a jobs page you already have open. It does not browse or log in for you.
