## AI Receptionist Phone Application

A multi-tenant SaaS where users sign up, configure AI-powered phone receptionists with custom knowledge bases, and handle both inbound and outbound calls via Ultravox + Twilio.

---

### 1. Authentication & User Management

- Sign up / login pages with email & password
- User profile with company name and settings
- Role-based access (user roles table)

### 2. Dashboard

- Overview of all configured receptionists (agents)
- Call statistics: total calls, duration, recent activity
- Quick actions to create new agent or make outbound call

### 3. Agent (Receptionist) Management

- **Create/Edit Agent page** with:
  - Agent name & personality configuration
  - System prompt / instructions (what the receptionist should say and do)
  - Voice selection (from Ultravox built-in voices)
  - Temperature & behavior settings
  - Phone number assignment (Twilio number)
  - First speaker settings (agent speaks first for inbound, user for outbound)

### 4. Knowledge Base

- **Text/FAQ entry**: Add Q&A pairs or freeform text that the AI receptionist can reference  
  
They can even give their website as well. So Ultravox already had all their capabilities, all you need to do is check Ultravox docs in everything and need to make sure you have all these things needed 
- **Document upload**: Upload PDFs and documents that get parsed and stored as knowledge context
- Knowledge base items linked per agent — each receptionist gets its own knowledge
- Storage bucket for uploaded documents

### 5. Phone Number Configuration

- Users provide their Twilio credentials (Account SID, Auth Token)
- List and select Twilio phone numbers to assign to agents
- Configure Twilio webhook to point to our edge function for inbound calls

### 6. Call Handling (Edge Functions)

- **Inbound call handler**: Twilio webhook → Edge function creates Ultravox call with agent config + knowledge base → returns TwiML to connect the call stream
- **Outbound call initiator**: User triggers outbound call from dashboard → Edge function creates Ultravox call with `medium: { twilio: {} }` and outgoing phone number

### 7. Call History & Logs

- List of all calls with timestamp, duration, direction (inbound/outbound), caller number
- Call transcript/messages viewer (fetched from Ultravox API)
- Call recording playback (if enabled)

### 8. Database Schema (Lovable Cloud)

- **profiles** — user profile data
- **user_roles** — role management
- **agents** — receptionist configurations (name, system prompt, voice, settings)
- **knowledge_base_items** — text entries linked to agents
- **phone_configs** — Twilio credentials and phone number assignments per user
- **call_logs** — call history with metadata

### 9. Edge Functions

- `handle-inbound-call` — Twilio webhook, creates Ultravox call, returns TwiML
- `make-outbound-call` — creates Ultravox outbound call via API
- `manage-agent` — CRUD operations for Ultravox agents via API
- `parse-document` — processes uploaded documents for knowledge base

### 10. Design

- Clean, professional dashboard UI
- Dark/light mode support
- Mobile-responsive layout
- Card-based agent overview with status indicators