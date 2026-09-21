# Google Calendar and operational setup

## Family activation

Each initial person receives a separate private invitation link, valid for seven days after initial database creation and usable once. They choose a unique username and a passphrase of at least 14 characters. The lead coordinator can invite family members or restricted helpers, reset member access and remove access. The owner retains backup administration and can invite additional coordinators. Do not forward one person's invitation to another person. No invitation emails are sent by the application.

Removing access invalidates sessions and invitations immediately and releases that person's unfinished tasks. Account reset invalidates old sessions and invitations. Keep the owner's passphrase in a password manager; there is no public password-reset bypass.

## Google Calendar connection — one-time setup

Google Calendar draft links already work without API credentials. Reading calendars and selectively copying their events requires credentials created for THIS application; a ChatGPT Google connection does not provide the deployed application with access.

1. In Google Cloud / Google Auth Platform, create or select an appropriate project and enable Google Calendar API.
2. Configure the OAuth consent/branding and audience. For an initial external testing application, add the family members' chosen Google accounts as test users. Do not choose an employer-only Internal audience for a family application involving outside accounts. Test-mode authorisation can expire and Google may require additional consent, verification or configuration before lasting production use. Follow the console's current requirements.
3. Create an OAuth client of type Web application. Set the authorised redirect URI to the exact app origin plus `/auth/google/callback`. There is no trailing slash. For the current deployment it is:

   `https://sullivanfamily-production.up.railway.app/auth/google/callback`

4. Add these two read-only scopes to the app's requested data access:

   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

   `https://www.googleapis.com/auth/calendar.events.readonly`

5. In Railway, open the existing application service and add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as service variables. Do not put either credential file or the client secret into GitHub or a shared message. Deploy the configuration.
6. Sign in to the family app, open Calendar, choose Connect Google Calendar and complete Google's consent screen. Each family member connects their own account separately. Then Load my calendars, choose the desired family calendar, and Use this calendar.
7. Refresh calendar preview and copy ONLY the events intended for the family roster. This shares their title, time and location; previewing alone does not share events. A copied event is unassigned until someone takes responsibility.

The app requests read-only permissions that can cover multiple calendars accessible to the Google account. It restricts its preview to the calendar selected in the app; this UI selection is not a narrower Google permission grant. Use a dedicated family calendar and avoid an employer account unless approved. The app does not copy attendee lists or event descriptions. Disconnect removes the app's saved tokens and attempts to revoke Google authorisation.

OAuth provider behaviour still needs a real-account end-to-end check after credentials are configured. Do not label the connection active before that check succeeds.

## Google Calendar copy limitations

Imports and outbound draft links are snapshots, not automatic sync. Changing or cancelling the original does not change the roster. The app also does not write task assignment changes back to Google. Timed outbound drafts use a one-hour placeholder; check their duration. Check all-day and multi-day events against the original. The current task model stores a start date/time, not a full multi-day event duration.

## Google Maps

A saved place requires a user-entered exact address. Directions buttons open Google Maps using a Maps URL; there is no API key, embedded tracking map, geocoding service or stored travel-time estimate. Google receives the destination when the user clicks. Confirm the pin and address before driving.

## Persistent storage, backups and recovery

Keep one replica and the existing persistent `/data` volume attached. The current deployment is in the US West (sfo) region; discuss suitability with the family before storing sensitive information.

A persistent volume is NOT a backup. The automated setup staged the volume but could not enable a Railway backup schedule. In Railway open the application service's Backups tab and enable Daily, then verify that a backup has actually been created. Add a longer-retention schedule if appropriate. Store the DATA_KEY separately and securely; the database backup alone cannot decrypt the records. Test restore into a safe environment before treating recovery as dependable.

The owner can download a JSON roster export from Team. This export excludes credentials but contains family information: store it securely. Exports do not replace a full database-and-key backup for account recovery.

No notification delivery or uptime guarantee is provided. Confirm urgent changes directly. Obtain consent before storing health information. Medication administration is not implemented.

## Primary implementation references

- Google OAuth web-server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Calendar scopes: https://developers.google.com/workspace/calendar/api/auth
- Calendar event listing: https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
- Railway volume backups: https://docs.railway.com/volumes/backups
- Node SQLite: https://nodejs.org/api/sqlite.html
