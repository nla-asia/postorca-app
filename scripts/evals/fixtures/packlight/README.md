# Packlight

A small packing checklist for a weekend away. Pick a sample trip, add an item,
tick things off and see how much is packed. Preview the whole list in one place.
The iPhone app can also open the system share sheet with that list.

This is a React Native / Expo SDK 58 app with Expo Router. It runs on web and in
Expo Go on an iPhone Simulator. It has no backend, login, network data, analytics
or saved user data. Sample lists live in memory: reloading the app or pressing
**Reset sample trips** starts over. Dates are labels, not bookings.

## Run

Node 22+ and npm:

```sh
npm ci
npm run web -- --port 4140
# Or, with an available iPhone Simulator and Xcode:
npm run ios -- --port 4140
```

`npm run ios` opens Expo Go in Simulator (Expo may offer to install it). No paid
Expo account, cloud build or signing identity is needed.
`npm run android` runs it on Android.

Checks:

```sh
npm run check
npm run lint
npx expo export --platform web
npx expo export --platform ios
```
