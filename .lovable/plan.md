
## Adding Google OAuth and Simplifying Twilio Configuration

### Current State Analysis
I can see the project already has email/password authentication set up with:
- `useAuth` hook with signUp/signIn/signOut functions  
- Auth page with login/signup forms
- Protected routes using `ProtectedRoute` component
- User profiles system with automatic profile creation

### Plan: Google OAuth Integration

**1. Configure Google OAuth Provider**
- Use Lovable Cloud's managed Google OAuth (no setup required)
- Add the `@lovable.dev/cloud-auth-js` package and lovable integration
- Update the Auth page to include "Sign in with Google" button
- Modify useAuth hook to handle OAuth sign-ins alongside email/password

**2. Update Authentication Flow**
- Add Google sign-in button to the Auth page
- Handle OAuth redirects properly 
- Ensure existing profile creation trigger works for OAuth users
- Maintain existing email/password functionality

### Plan: Simplified Twilio Configuration

**3. Streamline Phone Config Form**
- Remove the separate "friendly_name" field complexity
- Focus on the 3 essential fields: Account SID, Auth Token, Phone Number
- Simplify the UI to be more straightforward
- Keep the existing phone_configs table structure but make form simpler

**4. Technical Implementation**
- Update `PhoneConfig.tsx` to have cleaner, more focused form
- Remove unnecessary fields from the UI (keep database schema as-is for flexibility)
- Improve form validation and error handling
- Make the phone number display cleaner in the list

### Files to Modify:
- `src/pages/Auth.tsx` - Add Google sign-in button and OAuth handling
- `src/hooks/useAuth.tsx` - Add OAuth sign-in method  
- `src/pages/PhoneConfig.tsx` - Simplify form to focus on 3 core fields
- Install required packages for Google OAuth

### Technical Details:
- Use Lovable Cloud's managed Google OAuth (automatic setup)
- OAuth users will get profiles auto-created via existing trigger
- Existing email/password flows remain unchanged
- Simplified Twilio form removes visual clutter while keeping data flexibility
