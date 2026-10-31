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
Expo account, cloud build or signing identity is needed for this fixture.
`npm run android` is available for development but is outside these evals.

Checks:

```sh
npm run check
npm run lint
npx expo export --platform web
npx expo export --platform ios
```

When the eval fixture already has Metro running, open the installed Expo Go with
`xcrun simctl openurl booted exp://127.0.0.1:4140`; do not start another Metro server.
Dismiss any development welcome/error overlays before recording. In Expo Go’s developer menu, turn off **Tools button** to hide the floating blue gear, then close the menu.

## Which route to use

- The trips, packing checkboxes, add-item input, progress and list preview work on
  web. Open `http://127.0.0.1:4140` for that demonstration. The layout stays narrow
  and portrait-shaped in a larger browser window.
- **Share packing list** opens the real native share sheet on iPhone. It has no
  web equivalent in this app; use Simulator to demonstrate it. Opening the sheet
  and cancelling is enough: do not select a recipient or send anything.

## Repeatable example

Reset the sample trips. Open **A weekend away** (Chiang Mai). It starts at 2 of 6
packed. Add **Travel adapter**, then tick **Phone charger**. The count becomes
3 of 7 and the progress changes. Preview the list and dismiss it. On iPhone, also
open **Share packing list**, then cancel the system sheet.

The source of truth is `src/packing.tsx`; screens are in `src/app/`. All sample
content is fictional. There are no testimonials, usage numbers or hidden services.
