# Debt Tracker Web (3.0)

This is a minimal web port of the Debt Tracker using React + Vite and Firebase Firestore for online storage.

## Quick start

1. Create a Firebase project at https://console.firebase.google.com/ and enable Firestore (in test mode for development).
2. Add a Web app in Firebase and copy the config values.
3. Create a `.env.local` file in the project root with these values (replace with your values):

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

4. Install dependencies and run locally:

```bash
cd "C:\Users\chesc\OneDrive\Documents\Debt Tracker 3.0"
npm install
npm run dev
```

5. Open the app at the printed `localhost` URL. The app will read/write documents in the `transactions` collection of Firestore.

## Netlify deployment

To make the app save debts on Netlify, add these environment variables in Netlify > Site settings > Environment variables:

```
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## Production Firebase setup

1. In Firebase Console, enable Authentication and choose Email/Password.
2. In Firestore Database, create the database in production mode.
3. In Firestore Rules, use a rule that only allows signed-in users to access their own transactions:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /transactions/{document} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.userId;
    }
  }
}
```

When a user adds a debt, the app now stores the record with a `userId` field so the rule above can enforce access correctly.

## Notes
- This is a minimal example to get you started. For production, set Firestore security rules and enable authentication.
- You can deploy the site to Vercel, Netlify, or Firebase Hosting.
