# Feedback System Documentation

## Overview

The Victron Designer now includes a comprehensive feedback system that allows users to submit feedback along with their current design state and screenshots. This makes it easy to understand the context of bug reports and feature requests.

## Features

### For Users

1. **Feedback Button**: Located in the top navigation bar
2. **Easy Submission**: Simple form with message and optional email
3. **Automatic State Capture**: Your current design (components, wires, voltage) is automatically saved
4. **Screenshot Capture**: The canvas is automatically captured and included
5. **Privacy**: Email is optional - only provide if you want follow-up

### For Admins

1. **Feedback Admin Page**: Accessible at `/feedback-admin`
2. **View All Feedback**: See all submissions with timestamps and metadata
3. **Load Design States**: Click "Load This State in Designer" to reproduce user issues
4. **Screenshot Preview**: View the exact canvas state when feedback was submitted
5. **Delete Feedback**: Remove feedback items once addressed

## Technical Details

### Storage

- **Location**: `/usr/local/victron/feedback-data/feedback.json`
- **Format**: JSON file with all feedback entries
- **Persistence**: File-based storage, survives service restarts

### Data Structure

Each feedback entry contains:
```json
{
  "id": "uuid",
  "message": "User's feedback text",
  "email": "optional@email.com",
  "userAgent": "Browser/OS info",
  "timestamp": "ISO 8601 timestamp",
  "state": {
    "components": [...],
    "wires": [...],
    "systemVoltage": 12
  },
  "screenshot": "data:image/png;base64,..."
}
```

### API Endpoints

- `POST /api/feedback` - Submit new feedback
- `GET /api/feedback` - Get all feedback (admin)
- `GET /api/feedback/:id` - Get specific feedback
- `DELETE /api/feedback/:id` - Delete feedback
- `GET /api/feedback-count` - Get total count

### Client Components

- **FeedbackDialog**: User-facing feedback form
- **FeedbackAdmin**: Admin interface to view/manage feedback
- **TopBar**: Includes the feedback button

## Usage

### Submitting Feedback (Users)

1. Click the "Feedback" button in the top right
2. Type your feedback message (required)
3. Optionally provide your email for follow-up
4. Click "Submit Feedback"
5. Your design state and screenshot are automatically included

### Viewing Feedback (Admins)

1. Navigate to `https://www.victrondesigner.com/feedback-admin`
2. Browse all submitted feedback
3. Click the eye icon to view full details including screenshot
4. Click "Load This State in Designer" to reproduce the exact design
5. The designer will load with the user's components, wires, and settings

### Reproducing Issues

1. In the feedback admin, find the relevant submission
2. Click "Load This State in Designer"
3. You'll be redirected to the main designer with the exact state loaded
4. Use the screenshot for reference to verify the issue

## Files Modified/Created

### New Files
- `server/feedback-storage.ts` - Storage layer for feedback
- `client/src/components/FeedbackDialog.tsx` - User feedback form
- `client/src/pages/FeedbackAdmin.tsx` - Admin interface
- `FEEDBACK_SYSTEM.md` - This documentation

### Modified Files
- `server/routes.ts` - Added feedback API endpoints
- `client/src/components/TopBar.tsx` - Added feedback button
- `client/src/pages/SchematicDesigner.tsx` - Integrated feedback dialog and state loading
- `client/src/App.tsx` - Added feedback admin route

## Security & Authentication

### Admin Access Control

The feedback admin panel is protected by Google OAuth authentication:

1. **Authorized Admins**: Only `megaman5@gmail.com` can access the admin panel
2. **Authentication Flow**:
   - Users click "Sign in with Google" on the admin page
   - After OAuth, the system checks if the email is in the admin whitelist
   - Non-admin users see an "Access Denied" message
3. **Session**: 7-day session cookies for authenticated users

### Modifying Admin Access

To add/remove admin users, edit `/usr/local/victron/server/auth.ts`:

```typescript
// Admin email whitelist
const ADMIN_EMAILS = ["megaman5@gmail.com", "another@email.com"];
```

After modifying, rebuild and restart the service:
```bash
cd /usr/local/victron
sudo rm -rf dist && npm run build
sudo systemctl restart victron-designer
```

### Other Security Notes

- Feedback submission is open to all users (no auth required)
- Screenshot data is base64 encoded PNG
- Email addresses are optional and stored in plaintext
- User agent strings captured for debugging purposes

## Future Enhancements

Potential improvements:
- Add authentication for admin page
- Email notifications when feedback is submitted
- Categorize feedback (bug/feature/question)
- Add status tracking (new/in-progress/resolved)
- Export feedback to CSV/JSON
- Search and filter functionality
- Pagination for large feedback lists
