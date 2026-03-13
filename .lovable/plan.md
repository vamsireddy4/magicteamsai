

# Fix Cal.com API Integration & Calendar Availability

## Problem
The Cal.com availability check fails with "Bad Request" because:
1. The code uses the **deprecated Cal.com v1** `/availability` endpoint
2. The stored `calendar_id` value is `"cal.com"` — not a valid event type ID
3. Cal.com v2 API requires a `cal-api-version: 2024-09-04` header and different parameters (`start`, `end`, `eventTypeId` or `eventTypeSlug+username`)

## Solution

### 1. Update Calendar Integrations UI (`src/pages/CalendarIntegrations.tsx`)
- For Cal.com provider: change the `calendar_id` field label to **"Event Type ID"** with helper text explaining where to find it
- Add a **"Username"** field stored in the `config` JSONB column (Cal.com v2 needs username for slug-based lookups)
- This ensures proper data is collected at setup time

### 2. Fix `check-calendar-availability` edge function
- Switch Cal.com from v1 `/availability` to **v2 `/v2/slots`** endpoint
- Add required `cal-api-version: 2024-09-04` header and `Authorization: Bearer` header (v2 uses Bearer auth, not query param)
- Use `eventTypeId` if numeric, otherwise fall back to `eventTypeSlug + username` from config
- Format `start`/`end` as ISO date strings as required by v2
- Handle graceful fallback if event type ID is missing — fetch user's default availability

### 3. Fix `book-calendar-appointment` edge function
- Switch Cal.com booking from v1 to **v2 `/v2/bookings`** endpoint
- Add `cal-api-version` header and Bearer auth
- Update request body format to match v2 schema (`attendee` object instead of `responses`)

### 4. Fix `check-calendar-availability` test flow
- Update the test connection handler for Cal.com to use v2 `/v2/me` endpoint with Bearer auth

### Files to edit
- `supabase/functions/check-calendar-availability/index.ts` — migrate to v2 API
- `supabase/functions/book-calendar-appointment/index.ts` — migrate to v2 API
- `src/pages/CalendarIntegrations.tsx` — fix field labels and add username field for Cal.com

