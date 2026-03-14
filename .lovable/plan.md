

## Plan: Fix Telnyx Call Transfer — Missing `from` Number

### Root Cause

From the edge function logs, the Telnyx transfer API returns:

```
"Unverified origination number D51. The source number is a non-Telnyx number that has not been verified."
```

The `handleTelnyxTransfer` function sends only `{ to: destination }` in the transfer request body. Telnyx requires a `from` field specifying the verified Telnyx phone number. Without it, Telnyx picks a default origination number that isn't verified, causing the error.

### Fix

**File: `supabase/functions/transfer-call/index.ts`** — line 292

Add the `from` field using the phone number from `phoneConfig.phone_number`:

```typescript
body: JSON.stringify({ 
  to: destination,
  from: phoneConfig.phone_number
}),
```

This is a one-line change in the `handleTelnyxTransfer` function. The `phoneConfig` object is already passed into the function and contains `phone_number` — the verified Telnyx number used to place the original call.

