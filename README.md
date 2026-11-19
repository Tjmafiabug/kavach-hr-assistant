# Kavach HR Assistant

A chat assistant that answers Kavach Insurtech employees' HR questions **only from the Kavach HR Policy Pack**, personalised to the employee asking (band, role type, probation status, city). It asks when information is missing, says "I don't know" with the employee's HRBP name and email, handles POSH / exit / distress messages differently, and logs every message and flag to a Google Sheet.

Built as a **Google Apps Script web app bound to a Google Sheet**, with one LLM call per message through OpenRouter (`openai/gpt-6-luna`, strict JSON output).

- **Live chat:** https://tjmafiabug.github.io/kavach-hr-assistant/
  Try `KV1003` vs `KV1021` → "What is my notice period?" (90 vs 15 days).
  The page calls the Apps Script backend with a plain `fetch` (no Google login involved). The same page is also served directly by Apps Script at https://script.google.com/macros/s/AKfycbxSurlrcpDyEFG5yN5Ydi05PbGfsdI7Lfu-WUzjgLG_bozFls-VfY8ZE65XUWKc-9te/exec, but Google breaks that link for browsers signed in to several Google accounts ("Page not found"), so the GitHub Pages link is the reliable one.
- **Design note:** [`docs/design-note.pdf`](docs/design-note.pdf)
- **Results on the 6 sample questions:** [`docs/sample-results.md`](docs/sample-results.md)

## How it works

```
index.html ──google.script.run──> Code.js
  startChat(id)   roster lookup (Roster tab) → session in CacheService (6 h) → greeting
  chat(id, msg)
    1. keyword check: POSH / distress / exit (precise regex lists)
    2. POSH or distress → fixed template with the IC / EAP route (no AI call)
       otherwise        → one LLM call → JSON {topic, flag, answer_type, sections, reply}
                          (if the AI flags POSH/distress, the template replaces its reply)
    3. guard: every number in the reply must exist in the pack, the profile or the user's words;
       every cited section must exist. Fail → one retry → still fail → safe "can't answer" reply
    4. code adds "Source: Separation §5.1" and, for not-covered/partial/refused, the HRBP's name + email
    5. Log tab (2 rows per message) · Flags tab (1 row per flag type per chat) · email for POSH/distress
```

| File | What it is |
|---|---|
| `src/Code.js` | Server: web app, decision flow, guards, templates, LLM call, logging, Sheet setup |
| `src/index.html` | Chat page (Employee ID screen → chat). Uses `google.script.run` when served by Apps Script, `fetch` → `doPost` anywhere else |
| `docs/index.html` | Copy of `src/index.html` served by GitHub Pages (`cp src/index.html docs/` after edits) |
| `src/tests.js` | 33 test cases (6 samples + policy traps) and the `runTests` Sheet menu item |
| `src/policy.js` | The policy pack, verbatim, as a string constant |
| `src/roster.js` | The roster CSV, verbatim — only used by Setup to fill the Roster tab |
| `src/appsscript.json` | Manifest: time zone, scopes, web app settings |
| `local/harness.js` | Runs the same `src/` code in Node for fast prompt tuning and tests |

**Sheet tabs:** `Roster` · `Log` (every message + reply, topic, answer type, flag, sections, model, tokens, cost, latency, notes) · `Flags` (one row per flag, Open/Closed dropdown) · `HRBP view` (open flags grouped by HRBP) · `Results` (test run).

## Run your own copy

You need a Google account and an [OpenRouter](https://openrouter.ai) API key.

1. Install clasp and log in:
   ```bash
   npm i -g @google/clasp
   clasp login
   ```
   Turn on the Apps Script API at https://script.google.com/home/usersettings.
2. Create a Sheet with a bound script and push the code:
   ```bash
   git clone <this repo> && cd kavach-hr-assistant
   rm .clasp.json
   clasp create-script --type sheets --title "Kavach HR Assistant" --rootDir src
   clasp push --force
   ```
3. Open the new Sheet (link printed by clasp), reload it, then **HR Bot → Setup (run once)**.
   Google asks you to authorise the script (click *Advanced → Go to Kavach HR Assistant*). Setup creates the tabs, fills the roster, and asks for your OpenRouter key and an alert email. Both are stored in **Script Properties**, never in the code or the Sheet.
4. Deploy the web app: `clasp create-deployment --description v1`. The chat URL is
   `https://script.google.com/macros/s/<deploymentId>/exec`.
   To ship later code changes to the same URL: `clasp push --force && clasp update-deployment <deploymentId>`.

Optional Script Property: `OPENROUTER_MODEL` (default `openai/gpt-6-luna`).

## Tests

- **In the Sheet:** HR Bot → Run tests. Writes every case, the bot's actual reply, flags and PASS/FAIL to the `Results` tab. Test chats are not written to Log/Flags and send no email.
- **Locally:** create `.env` with `OPENROUTER_API_KEY=...`, then
  ```bash
  node local/harness.js test            # all 33 cases
  node local/harness.js test S1 T05     # selected cases
  node local/harness.js chat KV1003     # chat in the terminal
  ```

## Secrets

The API key and alert email live only in Apps Script **Script Properties** (and a git-ignored `.env` for local runs). Nothing secret is in this repository.

## Data

All people, policies, phone numbers and emails are fictional, from the assignment attachments.
