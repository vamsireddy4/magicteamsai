

## Problem

The Telnyx API key stored in the `phone_configs` table is `erNTtaAPUXtdSqs9DHnEXS2RCNI6FVC3RddEqi5On4Y=`, which is completely different from the user's actual key `KEY019CD80AA82DAEFC883EFFCE71DC92FA`. This is why Telnyx returns "Could not find any usable credentials."

## Root Cause

The stored value looks like a base64-encoded or garbled string — not the raw API key the user intended to save. This could be from a previous entry or a copy-paste issue.

## Plan

1. **Update the database record directly** — Set `telnyx_api_key` to the correct value `KEY019CD80AA82DAEFC883EFFCE71DC92FA` on the existing phone_config row (id: `99eefc48-7000-442d-9a42-37e430c44218`) via a migration.

2. **Add debug logging** — Add a log line in the edge function to print the first 8 characters of the API key being used, so future credential issues are easier to diagnose.

### Technical Details

- Run a SQL migration: `UPDATE phone_configs SET telnyx_api_key = 'KEY019CD80AA82DAEFC883EFFCE71DC92FA' WHERE id = '99eefc48-7000-442d-9a42-37e430c44218';`
- Add `console.log("Using Telnyx key starting with:", telnyxApiKey.substring(0, 8));` in the edge function before the API call.

