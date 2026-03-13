

# Auto-fetch Cal.com Event Types & Username from API Key

## Problem
User has to manually enter Event Type ID and Username when connecting Cal.com. They just want to paste the API key and have it work.

## Solution
When the user enters only the Cal.com API key and clicks Connect:
1. Call Cal.com v2 API `/v2/me` to fetch the username automatically
2. Call Cal.com v2 API `/v2/event-types` to fetch available event types
3. If only one event type exists, auto-select it
4. If multiple exist, show a dropdown for the user to pick one
5. Save the selected event type ID and fetched username automatically

### Changes

**1. `src/pages/CalendarIntegrations.tsx`**
- For Cal.com, simplify the form to only show the API key field initially
- After API key is entered and user clicks "Connect", call the `check-calendar-availability` edge function with `{ test: true, fetch_event_types: true }` to retrieve username + event types
- If one event type → auto-connect with that ID + username
- If multiple → show a select dropdown to pick one, then save
- Remove the manual Event Type ID and Username fields for Cal.com

**2. `supabase/functions/check-calendar-availability/index.ts`**
- Add a `fetch_event_types` mode to the Cal.com handler
- When `fetch_event_types: true`, call `/v2/me` for username and `/v2/event-types` for the list of event types
- Return `{ username, event_types: [{ id, title, slug }] }` so the frontend can use it

### Files
- **Edit:** `src/pages/CalendarIntegrations.tsx` — simplify Cal.com form, auto-fetch on connect
- **Edit:** `supabase/functions/check-calendar-availability/index.ts` — add event type fetching mode

