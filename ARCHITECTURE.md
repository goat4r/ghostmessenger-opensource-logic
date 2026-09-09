# The core model

The public model is **observe → classify → act → verify → recover**. It is a browser DOM state machine, not an AI model, private API client, or backend service. A button click is an attempted action; a subsequent DOM transition is evidence. Neither is proof of server delivery.

## Modules and boundaries

| Module | Responsibility |
| --- | --- |
| `index.js` | Exports `createSender` and `createOpener` |
| `sender.js` | Camera, capture, recipient/shortcut selection, final send, acknowledgement, recovery |
| `opener.js` | Separate single and multiple-target open/view/close/return loops |
| `patterns.js` | Actual V5 fingerprints, selectors, confidence matching and stale-cache handling |
| `lifecycle.js` | Instance-owned cancellable waits, callbacks, injected clock, disposal |

Importing does not start a loop or install uncontrolled global listeners. Constructing binds configuration and document adapters. `start()` owns the run; `stop()` cancels it; `dispose()` prevents future starts. UI, configuration persistence, scheduling, and navigation belong to the caller. There is no shared scheduler, account state, license gate, network API engine, or extension API in this package.

## Sender

`searching → takePicture → sendTo → selectRecipients → prepareFinalSend → commitFinalSend → awaitSendAck → waitingForLoop`

1. Observe the current page, identify camera/capture/compose controls, and reconcile with nearby states when a transition has already happened.
2. Acquire fresh elements and check connection/visibility before attempting input. Primary selectors are cheap; fingerprint matching is a bounded fallback, not permission to click an arbitrary similar element.
3. Select exact normalized nicknames or an existing shortcut, including its Select confirmation. List creation and editing are outside the core.
4. Lock selection before final send. Preserve final-click evidence separately from DOM acknowledgement evidence.
5. Count once for the acknowledged internal cycle, then clear that cycle's proof. On acknowledgement timeout, retry within the existing bounded window; a hard timeout resets the attempt without counting it.

The implementation retains V5's native/synthetic click reinforcement. This may deliver more than one click event and is not an exactly-once messaging guarantee. Count increments reflect configured recipients, even if V5 skipped a recipient after repeated selection failure. Treat them as compatibility counters, not billing or delivery records.

## Opener

Both modes follow `findOpenable → clickOpenable → waitOpened → closeOpenedSnap → waitReturned → interCycleDelay`, with `single_` or `multi_` state prefixes.

Single mode scans visible openable markers. Multi mode rotates configured names and matches V5's conversation rows. An away/viewer transition starts a cycle; a close attempt is followed by explicit list-return verification. Close-button matching precedes necessary keyboard Escape/Backspace fallbacks. Keyboard events here operate page controls; they are not configurable user hotkeys.

Multi mode requires away-and-return proof before counting. Single mode retains a legacy clicked-timeout fallback by default; pass `allowLegacyClickFallback: false` for stricter transition-based counting. A `cycleId` is counted at most once internally. A different website layout can still produce misleading evidence.

## Recovery decisions

Recovery uses observations, confidence thresholds, elapsed deadlines, retry limits, and cached-element invalidation. See the README for the preserved numerical defaults. Recovery can move to a neighboring state, re-find an element, close a viewer, reset the cycle, or request a reload. `onReloadRequested` is an explicit host decision; the core never reloads silently.

Do not replace a failed observation with an unconditional click or unlimited retry. Preserve cancellation checks across waits and state boundaries. If you change selectors or confidence thresholds, add failing synthetic examples first and test false positives as well as success.

## Isolation and compatibility

Mutable counts, recipients, active flags, cycle evidence, timers, and state identifiers belong to each instance. A sender-only canvas compatibility patch uses shared reference-counted leases and restores the original function after the last user stops. This is the only intentionally shared compatibility resource; it does not coordinate competing actions. Two independent engines can still interfere if they manipulate the same page simultaneously. Schedule them outside this library.
