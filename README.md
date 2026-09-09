# Ghost Messenger: send/open logic

Start with [the architecture](ARCHITECTURE.md), [building on top](BUILDING-ON-TOP.md), and [testing](TESTING.md). The MIT license permits modification, redistribution, and commercial use while retaining its copyright and license notice. No trademark or Snapchat platform permission is granted.

## License and credits

Licensed under the [MIT License](LICENSE). Copyright (c) 2025 Bluecool97 for the original work; copyright (c) 2026 goat4r for contributions and modifications. Retain the copyright and license notices when using or redistributing this code.

## No affiliation

Ghost Automations, Ghost Messenger, goat4r and this project are independent and are not affiliated with, sponsored by, endorsed by, or associated with Snapchat or Snap Inc. in any way. Snapchat names and trademarks belong to their respective owners. This project is not an official Snapchat product.

## API

```js
import { createSender, createOpener } from './index.js';

// Only run on an approved test account, with approved recipients.
const sender = createSender({
  document,
  recipients: ['Approved display name'],
  recipientMode: 'nickname', // or 'shortcut'
  actionDelay: 100,
  loopDelay: 50,
  targetSnapCount: 1,
  snapThreshold: 2000,
  onState: console.log,
  onProgress: console.log,
  onError: console.error,
  onDiagnostic: console.log,
  onReloadRequested: state => console.warn('Recovery requests reload', state),
});
// Explicit user action only; importing/constructing does not start automation.
// sender.start();
// await sender.stop();
// await sender.dispose();

const opener = createOpener({
  document,
  mode: 'multi', // 'single' opens visible openable entries, not a named list
  recipients: ['Approved display name'],
  singleDelay: 300,
  multiDelay: 200,
  allowLegacyClickFallback: false, // stricter single-open counting; see below
  isExcludedElement: element => Boolean(element?.closest('[data-my-controls]')),
  onState: console.log,
  onProgress: console.log,
});
// opener.start();
// await opener.stop();
```

Both expose `start`, `stop`, `getState`, `dispose`. `start()` returns a promise settling when that run ends; do not await it if you intend to stop later from another control. Repeated starts during a run return that run. Stop is immediate cancellation, not the legacy UI's finish-current-cycle behavior. It clears pending timers and listeners. Dispose permanently prevents restart. Sender count persists across restarts on the same instance; opener count resets at start. Recipient arrays are copied into instance state. Clock injection accepts `now()`, `setTimeout(fn, ms)`, `clearTimeout(id)` for controlled tests. Callbacks must not throw; callback exceptions are isolated.

Instances do not share automation state. A reference-counted, reversible canvas `toBlob` compatibility patch is installed only while sender instances run. This is not a scheduler: do not run competing actions on one Snapchat tab. External callers own scheduling and page navigation. A recovery reload is reported, never executed by this module.

## Actual state machines and recovery

Sending follows `searching → takePicture → sendTo → selectRecipients → prepareFinalSend → commitFinalSend → awaitSendAck → waitingForLoop`. It includes camera/capture fallbacks, recipient/shortcut selection, Select confirmation, DOM fingerprints, cached-element revalidation, confidence scoring, neighbor-state reconciliation, retry budgets, and stale-reference recovery. Recipient matching normalizes Unicode/whitespace; nickname matching is exact. The send acknowledgement window is 1,200 ms with 45 ms polling and a 4,500 ms hard timeout. Reconciliation uses 0.62 confidence after two misses. Missing camera states reset after five seconds. Repeated image-blob errors attempt camera closing, then request a reload through the adapter.

Send counting requires locked selection, final-click evidence, and post-send DOM transition evidence. It increments by the configured active-recipient list length, as in V5, not a server-confirmed delivered-recipient count. V5 skips a recipient after three selection failures but still uses configured list length. This legacy limitation is preserved, not silently corrected. Multiple synthetic/native click events are also retained; this does not guarantee exactly-once delivery on a changed website. The internal cycle is reset after an acknowledged send to prevent counting the same proof again. An acknowledgement timeout does not count a send; it retries commit without reselecting until the hard timeout.

Opening uses separate single/multi linked states: find → click → wait for viewer/away → close → verify list return → inter-cycle delay. It retains original `.vwM69.OXbMa` single markers, `.deg2K .O4POs` multi rows, name/action matching, foreground detection, viewer markers, close-button selectors, Escape/Backspace fallback, and confidence-based resynchronization. Default transition timeout is 1,400 ms, return timeout 1,800 ms, minimum viewer dwell 280 ms, close retries three, hard cycle timeout 4,200 ms. Single mode stops after five seconds without an openable. Multi mode rotates recipients; a name match uses substring matching as in V5.

Multi counts only a detected away transition followed by list return. Single preserves V5's timeout click-count fallback by default: that can count an attempted click without verified viewing. `allowLegacyClickFallback: false` disables that optional fallback, though DOM transition evidence still is not server evidence. `onDiagnostic` reports `open_counted`, `cycleId`, and `strictProof`; one cycle is counted at most once.

## Scope and limitations

This self-contained package provides sender, opener, DOM matching and lifecycle modules. Callers supply configuration and handle callbacks and reload requests. It does not include an extension UI, account system, credentials, backend or configurable hotkeys. Keyboard events used for viewer navigation remain. Actual selectors and recovery logic are visible source.

This is DOM automation, not a supported Snapchat API. Website changes can invalidate selectors and confidence assumptions. Synthetic fixtures cannot prove live delivery or all viewport/locale variants. No real recipients were messaged by these tests. No automatic reload or resumption occurs. Synthetic clocks control core waits/cache timestamps, not the browser's own event scheduling.

## Verification

Use Node 22+: `npm ci` then `npm test` (development tests only). Alternatively set `GHOST_TEST_JSDOM` to an existing jsdom installation. The 51 tests cover import safety, independent instances, cancellation/restart/disposal, missing DOM, failed clicks, stale cached elements, low-confidence matching, delayed viewer/list return, counting/fallback rules, canvas patch leases, nickname and shortcut sending, acknowledgement timeout, bounded missing-Select recovery, cancellation at each reported sender/single-opener/multi-opener state, and six seeded timing scenarios per sender mode. This is substantial synthetic coverage, not exhaustive proof of every recovery branch or live website compatibility.

`random` can be supplied to `createSender` alongside `clock` for reproducible internal yield decisions. See `tests/helpers.js` for a seeded generator and controlled clock. Production defaults still use native time and `Math.random`.
