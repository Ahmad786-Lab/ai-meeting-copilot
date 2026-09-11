# AI Meeting Copilot — load this straight into Chrome

No build step. No npm. No Plasmo. Unzip and load.

---

## 1. Unzip

Unzip `ai-meeting-copilot-extension.zip` somewhere permanent, e.g. your Desktop.
If you delete or move the folder, the extension breaks.

You should see:

```
ai-meeting-copilot-extension/
├── config.js        <- your API key goes here
├── manifest.json
├── background.js
├── content.js
├── offscreen.html
├── offscreen.js
├── popup.html
└── popup.js
```

## 2. Load it

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `ai-meeting-copilot-extension` folder

If your old Plasmo version is still loaded, **remove it** so the two don't
both inject a HUD into Meet.

## 3. Pin the icon

Click the puzzle-piece icon in the toolbar → pin AI Meeting Copilot.

This is required, not cosmetic. Clicking that icon is the user gesture Chrome
demands before it will allow tab capture.

## 4. Add your Deepgram key

Open **config.js** in any text editor. Replace `PASTE_YOUR_DEEPGRAM_KEY_HERE`
with your actual key, keeping the quotes:

```js
var AI_COPILOT_CONFIG = {
  DEEPGRAM_API_KEY: "a1b2c3d4e5f6...."
};
```

Save the file, then go to `chrome://extensions` and click the **reload** icon on
the extension card. Chrome does not pick up file edits on its own.

Note: `.env.local` does nothing here. That only worked in the Plasmo project
because a build step compiled it in. This version has no build step, so the key
has to live in `config.js`.

Local development only. Anyone who installs the extension can read `config.js`,
so before other people use this, the key moves behind a backend that issues
temporary credentials.

## 5. Use it

1. Join a Google Meet. The HUD appears top right.
2. Click **Start Listening** in the HUD → `YOU` pill turns green.
3. Click the extension icon → **Activate Copilot** → `MEETING AUDIO` pill turns
   green.
4. You talk → `YOU:` lines. Other person talks → `CLIENT:` lines.

---

## Testing it properly

A meeting with only you in it has no tab audio, so the CLIENT side will look
broken when it's actually fine. You need a second participant.

Easiest: join the same meeting from your phone.

- **Wear headphones on the laptop.** Otherwise client audio comes out your
  speakers, your mic picks it up, and the same sentence appears as both `YOU:`
  and `CLIENT:`.
- **Keep the phone's speaker muted** or in another room, for the same reason in
  reverse.

Talk into the laptop → `YOU:`. Talk into the phone → `CLIENT:`.

---

## Where to look when something breaks

Three separate consoles. The error is usually not in the one you're watching.

| Broken thing | Console |
|---|---|
| HUD, mic, `YOU:` lines | Right-click the Meet page → Inspect |
| Activation, tab capture | `chrome://extensions` → **service worker** |
| `CLIENT:` lines | `chrome://extensions` → Details → Inspect views → **offscreen.html** |

If `offscreen.html` never appears under "Inspect views", the offscreen document
was never created — that's a service worker problem, not a Deepgram one.

| Symptom | Cause |
|---|---|
| "Extension has not been invoked for the current page" | You activated from somewhere other than the popup, or the icon isn't pinned |
| Activate button greyed out | Not on a `meet.google.com` URL, or no key saved |
| Meeting audio goes silent after activating | The AudioContext loopback in `offscreen.js` failed |
| Pill green but no `CLIENT:` lines | Deepgram socket #2 — check the offscreen console |
| Same words on both channels | Headphones. See testing section. |

---

## After editing a file

`chrome://extensions` → reload icon on the card → then refresh the Meet tab.
Content script changes need the tab refresh; everything else needs the reload.
Do both when unsure.
