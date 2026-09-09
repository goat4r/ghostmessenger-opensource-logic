import {createLifecycle,requireDocument} from './lifecycle.js';
export function createOpener(options={}){
 const document=requireDocument(options),window=document.defaultView;const {Element,HTMLElement,KeyboardEvent,Event}=window;
 const lifecycle=createLifecycle(options);const Date={now:()=>lifecycle.clock.now()};
 const console={log(){},debug(){},warn(...a){lifecycle.emit('onDiagnostic',{level:'warning',message:a.map(String).join(' ')});},error(...a){lifecycle.emit('onError',{message:a.map(String).join(' ')});}};
 const config={singleDelay:300,multiDelay:200,...options};

  "use strict";

  // --- Multi Mode ---
  let multiModeNames = [];
  let isMultiRunning = false;
  let multiSnapsOpened = 0;
  let multiLoopPromise = null;
  let multiCycleCounter = 0;
  let multiDiagTick = 0;
  let multiStateId = 'multi_findOpenable';

  // --- Single Mode ---
  let isSingleRunning = false;
  let singleSnapsOpened = 0;
  let singleLoopPromise = null;
  let lastSingleElementClicked = null;
  let singleLastOpenableSeenAt = Date.now();
  let singleCycleCounter = 0;
  let singleCycle = null;
  let singleDiagTick = 0;

  // Single linked-state engine
  let singleStateId = "single_findOpenable";
  let singleStatePointer = "single_findOpenable";
  let singleStateFailCount = 0;
  let singleLastResyncAt = 0;

  const SINGLE_STATE_GRAPH = {
    single_findOpenable: { id: "single_findOpenable", prev: "single_interCycleDelay", next: "single_clickOpenable" },
    single_clickOpenable: { id: "single_clickOpenable", prev: "single_findOpenable", next: "single_waitOpened" },
    single_waitOpened: { id: "single_waitOpened", prev: "single_clickOpenable", next: "single_closeOpenedSnap" },
    single_closeOpenedSnap: { id: "single_closeOpenedSnap", prev: "single_waitOpened", next: "single_waitReturned" },
    single_waitReturned: { id: "single_waitReturned", prev: "single_closeOpenedSnap", next: "single_interCycleDelay" },
    single_interCycleDelay: { id: "single_interCycleDelay", prev: "single_waitReturned", next: "single_findOpenable" },
  };

  const OPEN_IDLE_TIMEOUT_MS = 5000;
  const OPEN_MIN_POLL_MS = 45;
  const OPEN_TRANSITION_TIMEOUT_MS = 1400;
  const OPEN_RETURN_TIMEOUT_MS = 1800;
  const OPEN_MIN_VIEW_DWELL_MS = 280;
  const OPEN_CLOSE_RETRY_MS = 80;
  const OPEN_MAX_CLOSE_ATTEMPTS = 3;
  const OPEN_HARD_CYCLE_TIMEOUT_MS = 4200;

  const SINGLE_RESYNC_MISS_THRESHOLD = 2;
  const SINGLE_RESYNC_CONFIDENCE_THRESHOLD = 0.62;
  const SINGLE_RESYNC_MIN_INTERVAL_MS = 120;

  const MULTI_RESYNC_MISS_THRESHOLD = 2;
  const MULTI_RESYNC_CONFIDENCE_THRESHOLD = 0.62;
  const MULTI_RESYNC_MIN_INTERVAL_MS = 120;

  const MULTI_STATE_GRAPH = {
    multi_findOpenable: { id: "multi_findOpenable", prev: "multi_interCycleDelay", next: "multi_clickOpenable" },
    multi_clickOpenable: { id: "multi_clickOpenable", prev: "multi_findOpenable", next: "multi_waitOpened" },
    multi_waitOpened: { id: "multi_waitOpened", prev: "multi_clickOpenable", next: "multi_closeOpenedSnap" },
    multi_closeOpenedSnap: { id: "multi_closeOpenedSnap", prev: "multi_waitOpened", next: "multi_waitReturned" },
    multi_waitReturned: { id: "multi_waitReturned", prev: "multi_closeOpenedSnap", next: "multi_interCycleDelay" },
    multi_interCycleDelay: { id: "multi_interCycleDelay", prev: "multi_waitReturned", next: "multi_findOpenable" },
  };

  function sleep(ms){return lifecycle.sleep(ms);}

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\u00A0/g, " ")
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isExtensionUiElement(element){return Boolean(options.isExcludedElement?.(element));}

  function isForegroundElement(element) {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    const points = [
      [0.5, 0.5],
      [0.25, 0.5],
      [0.75, 0.5],
    ];

    for (const [px, py] of points) {
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width * px));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height * py));
      const topElement = document.elementFromPoint(x, y);
      if (!topElement) continue;
      if (isExtensionUiElement(topElement)) {
        return true;
      }
      if (topElement === element || element.contains(topElement) || topElement.contains(element)) {
        return true;
      }
    }
    return false;
  }

  function isInteractable(element) {
    if (!isVisible(element)) return false;
    const style = window.getComputedStyle(element);
    if (!style) return false;
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.pointerEvents === "none") return false;
    if (Number.parseFloat(style.opacity || "1") === 0) return false;
    if (element.disabled) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  async function clickElement(element) { lifecycle.check();
    if (!element) return false;
    try {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    } catch (_) {}
    try {
      if (typeof element.focus === "function") element.focus();
    } catch (_) {}
    try {
      element.click();
      return true;
    } catch (_) {
      return false;
    }
  }

  function getMultiDelay(){return config.multiDelay;}

  function getSingleDelay(){return config.singleDelay;}

  function getPollMs(delayMs) {
    return Math.max(OPEN_MIN_POLL_MS, Math.min(90, Math.floor(delayMs / 3)));
  }

  function updateMultiStatus(){lifecycle.emit('onProgress',getState());}

  function updateSingleStatus(){lifecycle.emit('onProgress',getState());}







  function setMultiRunningUI(){lifecycle.emit('onState',getState());}

  function setSingleRunningUI(){lifecycle.emit('onState',getState());}

  function findSingleOpenableElement() {
    const candidates = Array.from(document.querySelectorAll("div.vwM69.OXbMa"));
    return candidates.find((candidate) => isVisible(candidate) && isForegroundElement(candidate)) || null;
  }

  function isSingleViewerVisible() {
    const buttons = Array.from(document.querySelectorAll("button"));
    let hasSendTo = false;
    let hasDownload = false;

    for (const button of buttons) {
      if (!isVisible(button) || isExtensionUiElement(button)) continue;
      const label = normalizeText(button.textContent || button.innerText);
      if (!label) continue;
      if (!hasSendTo && label.includes("send to")) hasSendTo = true;
      if (!hasDownload && label.includes("download")) hasDownload = true;
      if (hasSendTo && hasDownload) return true;
    }

    return hasSendTo;
  }

  function getMultiRows() {
    return Array.from(document.querySelectorAll(".deg2K .O4POs"));
  }

  function findOpenableMultiRowByName(targetName) {
    const normalizedTarget = normalizeText(targetName);
    if (!normalizedTarget) return null;

    const rows = getMultiRows();
    for (const row of rows) {
      const titleElement = row.querySelector(".FiLwP");
      const actionTextElement = row.querySelector(".giV53 .nonIntl");
      const openButtonContainer = row.querySelector(".HEkDJ");
      if (!titleElement || !actionTextElement || !openButtonContainer) continue;
      if (!isVisible(openButtonContainer)) continue;

      const title = normalizeText(titleElement.textContent);
      const action = normalizeText(actionTextElement.textContent);
      if (!title.includes(normalizedTarget)) continue;
      if (action !== "view") continue;

      return { row, actionTextElement, openButtonContainer };
    }

    return null;
  }

  function logMultiDiag(event, extra = {}, force = false) {
    multiDiagTick += 1;
    if (!force && multiDiagTick % 6 !== 0) return;
    console.log("[Open/MultiDiag]", {
      event,
      ...extra,
    });
  }

  function logSingleDiag(event, extra = {}, force = false) {
    singleDiagTick += 1;
    if (!force && singleDiagTick % 6 !== 0) return;
    console.log("[Open/SingleDiag]", {
      event,
      state: singleStateId,
      pointer: singleStatePointer,
      cycleId: singleCycle?.cycleId || null,
      failCount: singleStateFailCount,
      ...extra,
    });
  }

  function setSingleState(nextState, reason = "transition") {
    if (!SINGLE_STATE_GRAPH[nextState]) return;
    if (singleStateId === nextState) return;
    const prev = singleStateId;
    singleStateId = nextState;
    singleStatePointer = nextState;
    singleStateFailCount = 0;
    lifecycle.emit('onState',{...getState(),reason});
    logSingleDiag("single_state_jump", { from: prev, to: nextState, reason }, true);
  }

  function resetSingleCycle(reason = "reset") {
    if (singleCycle) {
      logSingleDiag("single_cycle_reset", { reason, cycleId: singleCycle.cycleId });
    }
    singleCycle = null;
    lastSingleElementClicked = null;
  }

  function createSingleCycle(openableElement) {
    singleCycleCounter += 1;
    singleCycle = {
      cycleId: singleCycleCounter,
      openableElement,
      clickedAt: null,
      transitionedAwayAt: null,
      closeAttemptedAt: null,
      returnedAt: null,
      ackReason: null,
      closeAttempts: 0,
      delayStartedAt: null,
      counted: false,
    };
  }

  function finalizeSingleCycle(reason, { allowClickFallback = false } = {}) {
    if (!singleCycle) {
      return false;
    }
    const hasStrictProof = Boolean(singleCycle.transitionedAwayAt);
    const hasClickFallbackProof = Boolean(options.allowLegacyClickFallback !== false && allowClickFallback && singleCycle.clickedAt);
    if (!hasStrictProof && !hasClickFallbackProof) {
      return false;
    }
    if (!singleCycle.returnedAt) {
      singleCycle.returnedAt = Date.now();
    }
    if (!singleCycle.ackReason) {
      singleCycle.ackReason = hasStrictProof ? reason : `fallback_${reason}`;
    }
    if (singleCycle.counted) {
      return true;
    }

    singleSnapsOpened += 1;
    updateSingleStatus();
    singleCycle.counted = true;
    lifecycle.emit('onDiagnostic',{event:'open_counted',cycleId:singleCycle.cycleId,reason,strictProof:hasStrictProof});
    logSingleDiag("single_open_proof_confirmed", {
      cycleId: singleCycle.cycleId,
      ackReason: singleCycle.ackReason,
      reason,
      strictProof: hasStrictProof,
    }, true);
    return true;
  }

  function hasSingleOpenProof() {
    return Boolean(singleCycle?.transitionedAwayAt && singleCycle?.returnedAt);
  }

  function hasSingleTransitionedAway() {
    if (!singleCycle?.openableElement) return false;
    if (isSingleViewerVisible()) return true;
    const target = singleCycle.openableElement;
    return !document.contains(target) || !isVisible(target) || !isForegroundElement(target);
  }

  function hasSingleReturnedToList() {
    return !isSingleViewerVisible() && Boolean(findSingleOpenableElement());
  }

  function findTopLeftBackCandidate() {
    const candidates = Array.from(document.querySelectorAll("button"))
      .filter((button) => isInteractable(button) && !isExtensionUiElement(button))
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top >= 0 && rect.left >= 0 && rect.top <= 180 && rect.left <= 180 && rect.width <= 160 && rect.height <= 160)
      .sort((a, b) => {
        if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
        if (a.rect.left !== b.rect.left) return a.rect.left - b.rect.left;
        return (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
      });

    return candidates[0]?.button || null;
  }

  function findSingleCloseButton() {
    const selectors = [
      'button[aria-label*="Back" i]',
      'button[aria-label*="Close" i]',
      'button[title*="Back" i]',
      'button[title*="Close" i]',
      'button[data-testid*="back" i]',
      'button[data-testid*="close" i]',
      "header button",
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (isInteractable(candidate) && !isExtensionUiElement(candidate)) {
        return candidate;
      }
    }
    return findTopLeftBackCandidate();
  }

  function dispatchCloseKey(key) { lifecycle.check();
    const target = document.activeElement || document.body || document;
    const downEvent = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    const upEvent = new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(downEvent);
    target.dispatchEvent(upEvent);
    document.dispatchEvent(downEvent);
    document.dispatchEvent(upEvent);
  }

  async function attemptCloseOpenedSnap() {
    const closeButton = findSingleCloseButton();
    if (closeButton) {
      const clicked = await clickElement(closeButton);
      if (clicked) return true;
    }

    // Keyboard fallback for viewer close/navigation
    dispatchCloseKey("Escape");
    dispatchCloseKey("Backspace");
    return true;
  }

  function classifySingleOpenScreen() {
    const markers = {
      listView: Boolean(findSingleOpenableElement()),
      viewerVisible: isSingleViewerVisible(),
      transitionedAway: hasSingleTransitionedAway(),
      closeButton: Boolean(findSingleCloseButton()),
    };

    if (markers.viewerVisible) {
      return { screenId: "viewer_opened", confidence: 0.92, markers };
    }

    if (markers.listView) {
      return { screenId: "list_view", confidence: 0.9, markers };
    }

    if (markers.transitionedAway || markers.closeButton) {
      return { screenId: "viewer_opened", confidence: markers.transitionedAway && markers.closeButton ? 0.86 : 0.72, markers };
    }

    return { screenId: "unknown", confidence: 0, markers };
  }

  function mapSingleClassificationToState(classification) {
    if (!classification) return null;
    if (classification.screenId === "list_view") {
      if (singleCycle?.transitionedAwayAt && !singleCycle?.counted) {
        return "single_waitReturned";
      }
      return "single_findOpenable";
    }
    if (classification.screenId === "viewer_opened") {
      if (singleCycle?.transitionedAwayAt) return "single_closeOpenedSnap";
      return "single_waitOpened";
    }
    return null;
  }

  function hasSingleExpectedMarker(stateId) {
    switch (stateId) {
      case "single_findOpenable":
        return Boolean(findSingleOpenableElement());
      case "single_clickOpenable":
        return Boolean(singleCycle?.openableElement);
      case "single_waitOpened":
        return Boolean(singleCycle?.clickedAt);
      case "single_closeOpenedSnap":
        return Boolean(singleCycle?.transitionedAwayAt);
      case "single_waitReturned":
        return Boolean(singleCycle?.transitionedAwayAt);
      case "single_interCycleDelay":
        return Boolean(singleCycle?.delayStartedAt);
      default:
        return false;
    }
  }

  async function resyncSingleState(expectedState, reason) {
    singleStateFailCount += 1;
    logSingleDiag("single_state_miss_expected", { expectedState, reason, failCount: singleStateFailCount });

    if (singleStateFailCount < SINGLE_RESYNC_MISS_THRESHOLD) {
      return false;
    }
    if (Date.now() - singleLastResyncAt < SINGLE_RESYNC_MIN_INTERVAL_MS) {
      return false;
    }

    singleLastResyncAt = Date.now();
    const classification = classifySingleOpenScreen();
    logSingleDiag("single_classifier_result", {
      expectedState,
      classifiedState: classification.screenId,
      confidence: classification.confidence,
      markers: classification.markers,
    }, true);

    if (classification.confidence >= SINGLE_RESYNC_CONFIDENCE_THRESHOLD) {
      const mappedState = mapSingleClassificationToState(classification);
      if (mappedState && mappedState !== singleStateId) {
        setSingleState(mappedState, `classifier:${reason}`);
        return true;
      }
      if (mappedState === singleStateId) {
        singleStateFailCount = 0;
      }
      return false;
    }

    const node = SINGLE_STATE_GRAPH[singleStateId];
    const neighborStates = [node?.prev, node?.next].filter(Boolean);
    for (const candidate of neighborStates) {
      if (hasSingleExpectedMarker(candidate)) {
        setSingleState(candidate, `neighbor_probe:${reason}`);
        return true;
      }
    }

    logSingleDiag("single_state_jump_rejected_low_conf", {
      expectedState,
      confidence: classification.confidence,
    }, true);
    return false;
  }

  function createMultiCycle(name, delayMs, pollMs) {
    multiCycleCounter += 1;
    return {
      cycleId: multiCycleCounter,
      targetName: name,
      delayMs,
      pollMs,
      stateId: "multi_findOpenable",
      stateFailCount: 0,
      lastResyncAt: 0,
      target: null,
      clickedAt: null,
      transitionedAwayAt: null,
      closeAttempts: 0,
      closeAttemptedAt: null,
      returnedAt: null,
      delayStartedAt: null,
    };
  }

  function setMultiState(cycle, nextState, reason = "transition") {
    if (!cycle || !MULTI_STATE_GRAPH[nextState]) return;
    if (cycle.stateId === nextState) return;
    const prev = cycle.stateId;
    cycle.stateId = nextState;
    multiStateId = nextState;
    lifecycle.emit('onState',{...getState(),reason});
    cycle.stateFailCount = 0;
    logMultiDiag("multi_state_jump", { cycleId: cycle.cycleId, from: prev, to: nextState, reason }, true);
  }

  function classifyMultiOpenScreen(targetName) {
    const anyRowsVisible = getMultiRows().some(isVisible);
    const targetOpenable = Boolean(findOpenableMultiRowByName(targetName));
    const closeButton = Boolean(findSingleCloseButton());

    const markers = { anyRowsVisible, targetOpenable, closeButton };

    if (targetOpenable) {
      return { screenId: "list_view", confidence: 0.9, markers };
    }
    if (anyRowsVisible) {
      return { screenId: "list_view", confidence: 0.74, markers };
    }
    if (closeButton) {
      return { screenId: "viewer_opened", confidence: 0.78, markers };
    }

    return { screenId: "unknown", confidence: 0, markers };
  }

  function mapMultiClassificationToState(cycle, classification) {
    if (!cycle || !classification) return null;
    if (classification.screenId === "list_view") {
      return cycle.transitionedAwayAt ? "multi_waitReturned" : "multi_findOpenable";
    }
    if (classification.screenId === "viewer_opened") {
      return cycle.transitionedAwayAt ? "multi_closeOpenedSnap" : "multi_waitOpened";
    }
    return null;
  }

  function hasMultiExpectedMarker(cycle, stateId) {
    if (!cycle) return false;
    switch (stateId) {
      case "multi_findOpenable":
        return Boolean(findOpenableMultiRowByName(cycle.targetName));
      case "multi_clickOpenable":
        return Boolean(cycle.target || findOpenableMultiRowByName(cycle.targetName));
      case "multi_waitOpened":
        return Boolean(cycle.clickedAt);
      case "multi_closeOpenedSnap":
      case "multi_waitReturned":
        return Boolean(cycle.transitionedAwayAt);
      case "multi_interCycleDelay":
        return Boolean(cycle.delayStartedAt);
      default:
        return false;
    }
  }

  async function resyncMultiState(cycle, expectedState, reason) {
    if (!cycle) return false;
    cycle.stateFailCount += 1;
    logMultiDiag("multi_state_miss_expected", {
      cycleId: cycle.cycleId,
      expectedState,
      reason,
      failCount: cycle.stateFailCount,
    });

    if (cycle.stateFailCount < MULTI_RESYNC_MISS_THRESHOLD) {
      return false;
    }
    if (Date.now() - cycle.lastResyncAt < MULTI_RESYNC_MIN_INTERVAL_MS) {
      return false;
    }

    cycle.lastResyncAt = Date.now();
    const classification = classifyMultiOpenScreen(cycle.targetName);
    logMultiDiag("multi_classifier_result", {
      cycleId: cycle.cycleId,
      expectedState,
      classifiedState: classification.screenId,
      confidence: classification.confidence,
      markers: classification.markers,
    }, true);

    if (classification.confidence >= MULTI_RESYNC_CONFIDENCE_THRESHOLD) {
      const mappedState = mapMultiClassificationToState(cycle, classification);
      if (mappedState && mappedState !== cycle.stateId) {
        setMultiState(cycle, mappedState, `classifier:${reason}`);
        return true;
      }
      if (mappedState === cycle.stateId) {
        cycle.stateFailCount = 0;
      }
      return false;
    }

    const node = MULTI_STATE_GRAPH[cycle.stateId];
    const neighborStates = [node?.prev, node?.next].filter(Boolean);
    for (const candidate of neighborStates) {
      if (hasMultiExpectedMarker(cycle, candidate)) {
        setMultiState(cycle, candidate, `neighbor_probe:${reason}`);
        return true;
      }
    }

    logMultiDiag("multi_state_jump_rejected_low_conf", {
      cycleId: cycle.cycleId,
      expectedState,
      confidence: classification.confidence,
    }, true);
    return false;
  }

  async function runMultiOpenCycleForName(name) {
    const delayMs = getMultiDelay();
    const pollMs = getPollMs(delayMs);
    const cycle = createMultiCycle(name, delayMs, pollMs);

    while (isMultiRunning) {
      switch (cycle.stateId) {
        case "multi_findOpenable": {
          const target = findOpenableMultiRowByName(name);
          if (!target) {
            return { transitionedAway: false, returnedToList: false, timedOut: false, skipped: true, reason: "target_not_found" };
          }
          cycle.target = target;
          setMultiState(cycle, "multi_clickOpenable", "target_found");
          break;
        }

        case "multi_clickOpenable": {
          let target = cycle.target;
          if (!target || !isVisible(target.openButtonContainer)) {
            target = findOpenableMultiRowByName(name);
            cycle.target = target || null;
          }

          if (!target) {
            const jumped = await resyncMultiState(cycle, "multi_clickOpenable", "target_missing_before_click");
            if (!jumped) {
              return { transitionedAway: false, returnedToList: false, timedOut: true, reason: "target_missing_before_click" };
            }
            await sleep(cycle.pollMs);
            break;
          }

          const clicked = await clickElement(target.openButtonContainer);
          if (!clicked) {
            const jumped = await resyncMultiState(cycle, "multi_clickOpenable", "click_failed");
            if (!jumped) {
              return { transitionedAway: false, returnedToList: false, timedOut: true, reason: "click_failed" };
            }
            await sleep(cycle.pollMs);
            break;
          }

          cycle.clickedAt = Date.now();
          setMultiState(cycle, "multi_waitOpened", "target_clicked");
          break;
        }

        case "multi_waitOpened": {
          if (!cycle.clickedAt) {
            setMultiState(cycle, "multi_findOpenable", "missing_clicked_at");
            break;
          }

          if (!findOpenableMultiRowByName(name)) {
            cycle.transitionedAwayAt = Date.now();
            setMultiState(cycle, "multi_closeOpenedSnap", "transitioned_away");
            break;
          }

          if (Date.now() - cycle.clickedAt >= OPEN_TRANSITION_TIMEOUT_MS) {
            const jumped = await resyncMultiState(cycle, "multi_waitOpened", "transition_timeout");
            if (!jumped) {
              return { transitionedAway: false, returnedToList: false, timedOut: true, reason: "transition_timeout" };
            }
            break;
          }

          await sleep(cycle.pollMs);
          break;
        }

        case "multi_closeOpenedSnap": {
          if (!cycle.transitionedAwayAt) {
            setMultiState(cycle, "multi_waitOpened", "missing_transition_flag");
            break;
          }

          if (Date.now() - cycle.transitionedAwayAt < OPEN_MIN_VIEW_DWELL_MS) {
            await sleep(Math.max(25, OPEN_MIN_VIEW_DWELL_MS - (Date.now() - cycle.transitionedAwayAt)));
            break;
          }

          if (getMultiRows().some(isVisible)) {
            cycle.returnedAt = Date.now();
            setMultiState(cycle, "multi_waitReturned", "returned_before_close");
            break;
          }

          if (cycle.closeAttempts < OPEN_MAX_CLOSE_ATTEMPTS) {
            await attemptCloseOpenedSnap();
            cycle.closeAttempts += 1;
            cycle.closeAttemptedAt = Date.now();
          } else {
            logMultiDiag("multi_close_fallback_used", {
              cycleId: cycle.cycleId,
              reason: "close_attempt_budget_exhausted",
            }, true);
          }

          setMultiState(cycle, "multi_waitReturned", "close_attempted");
          break;
        }

        case "multi_waitReturned": {
          if (!cycle.transitionedAwayAt) {
            setMultiState(cycle, "multi_findOpenable", "missing_transition_in_wait_returned");
            break;
          }

          if (getMultiRows().some(isVisible)) {
            cycle.returnedAt = Date.now();
            return { transitionedAway: true, returnedToList: true, timedOut: false, reason: "returned_to_list" };
          }

          if (
            cycle.closeAttempts < OPEN_MAX_CLOSE_ATTEMPTS &&
            (!cycle.closeAttemptedAt || Date.now() - cycle.closeAttemptedAt >= OPEN_CLOSE_RETRY_MS)
          ) {
            await attemptCloseOpenedSnap();
            cycle.closeAttempts += 1;
            cycle.closeAttemptedAt = Date.now();
          }

          if (Date.now() - cycle.transitionedAwayAt >= OPEN_RETURN_TIMEOUT_MS) {
            const jumped = await resyncMultiState(cycle, "multi_waitReturned", "return_timeout");
            if (!jumped && Date.now() - cycle.clickedAt >= OPEN_HARD_CYCLE_TIMEOUT_MS) {
              return { transitionedAway: true, returnedToList: false, timedOut: true, reason: "hard_cycle_timeout" };
            }
            if (!jumped) {
              return { transitionedAway: true, returnedToList: false, timedOut: true, reason: "return_timeout" };
            }
          }

          await sleep(cycle.pollMs);
          break;
        }

        case "multi_interCycleDelay": {
          if (!cycle.delayStartedAt) cycle.delayStartedAt = Date.now();
          if (Date.now() - cycle.delayStartedAt >= cycle.delayMs) {
            return { transitionedAway: Boolean(cycle.transitionedAwayAt), returnedToList: Boolean(cycle.returnedAt), timedOut: false, reason: "delay_elapsed" };
          }
          await sleep(Math.min(cycle.pollMs, Math.max(25, cycle.delayMs / 2)));
          break;
        }

        default:
          setMultiState(cycle, "multi_findOpenable", "unknown_multi_state");
          await sleep(cycle.pollMs);
      }
    }

    return { transitionedAway: false, returnedToList: false, timedOut: false, reason: "stopped" };
  }

  async function runSingleOpenLoop() {
    singleLastOpenableSeenAt = Date.now();
    singleStateId = "single_findOpenable";
    singleStatePointer = "single_findOpenable";
    singleStateFailCount = 0;
    singleLastResyncAt = 0;
    resetSingleCycle("single_start");

    while (isSingleRunning) {
      const delayMs = getSingleDelay();
      const pollMs = getPollMs(delayMs);

      switch (singleStateId) {
        case "single_findOpenable": {
          const openable = findSingleOpenableElement();
          if (!openable) {
            if (Date.now() - singleLastOpenableSeenAt >= OPEN_IDLE_TIMEOUT_MS) {
              if (singleCycle && !singleCycle.counted) {
                finalizeSingleCycle("idle_stop_fallback", { allowClickFallback: true });
              }
              console.log("[Open/Single] No openable snaps found, stopping.");
              stopSingleMode();
              break;
            }
            await sleep(pollMs);
            break;
          }

          // If we can already see the list again after an away-transition, finalize the prior cycle
          // before creating the next one.
          if (singleCycle?.transitionedAwayAt && !singleCycle?.counted) {
            finalizeSingleCycle("next_openable_visible_after_open");
            singleCycle.delayStartedAt = Date.now();
            setSingleState("single_interCycleDelay", "cycle_finalized_in_find_openable");
            break;
          }

          singleLastOpenableSeenAt = Date.now();
          createSingleCycle(openable);
          setSingleState("single_clickOpenable", "openable_found");
          break;
        }

        case "single_clickOpenable": {
          let target = singleCycle?.openableElement;
          if (!target || !document.contains(target) || !isVisible(target)) {
            target = findSingleOpenableElement();
            if (!target) {
              await resyncSingleState("single_clickOpenable", "target_missing_before_click");
              await sleep(pollMs);
              break;
            }
            if (singleCycle) singleCycle.openableElement = target;
          }

          const clicked = await clickElement(target);
          if (!clicked) {
            await resyncSingleState("single_clickOpenable", "click_failed");
            await sleep(pollMs);
            break;
          }

          if (singleCycle) {
            singleCycle.clickedAt = Date.now();
          }
          lastSingleElementClicked = target;
          setSingleState("single_waitOpened", "openable_clicked");
          break;
        }

        case "single_waitOpened": {
          if (!singleCycle?.clickedAt) {
            resetSingleCycle("missing_clicked_at");
            setSingleState("single_findOpenable", "missing_clicked_at");
            break;
          }

          if (hasSingleTransitionedAway()) {
            singleCycle.transitionedAwayAt = Date.now();
            setSingleState("single_closeOpenedSnap", "transitioned_away");
            break;
          }

          // Fallback: if direct away detection misses, use classifier evidence to keep
          // cycle progression/counter updates from stalling.
          const openClassification = classifySingleOpenScreen();
          if (openClassification.screenId === "viewer_opened" && openClassification.confidence >= 0.72) {
            singleCycle.transitionedAwayAt = Date.now();
            singleCycle.ackReason = singleCycle.ackReason || "classifier_viewer_opened";
            setSingleState("single_closeOpenedSnap", "classifier_detected_opened");
            break;
          }

          if (Date.now() - singleCycle.clickedAt >= OPEN_TRANSITION_TIMEOUT_MS) {
            const jumped = await resyncSingleState("single_waitOpened", "transition_timeout");
            if (!jumped) {
              finalizeSingleCycle("transition_timeout", { allowClickFallback: true });
              resetSingleCycle("transition_timeout_no_resync");
              setSingleState("single_findOpenable", "transition_timeout_no_resync");
            }
            break;
          }

          await sleep(pollMs);
          break;
        }

        case "single_closeOpenedSnap": {
          if (!singleCycle?.transitionedAwayAt) {
            setSingleState("single_waitOpened", "missing_transition_flag");
            break;
          }

          if (Date.now() - singleCycle.transitionedAwayAt < OPEN_MIN_VIEW_DWELL_MS) {
            await sleep(Math.max(25, OPEN_MIN_VIEW_DWELL_MS - (Date.now() - singleCycle.transitionedAwayAt)));
            break;
          }

          if (hasSingleReturnedToList()) {
            singleCycle.returnedAt = Date.now();
            singleCycle.ackReason = "returned_before_close";
            setSingleState("single_waitReturned", "already_returned");
            break;
          }

          if (singleCycle.closeAttempts < OPEN_MAX_CLOSE_ATTEMPTS) {
            await attemptCloseOpenedSnap();
            singleCycle.closeAttempts += 1;
            singleCycle.closeAttemptedAt = Date.now();
          } else {
            logSingleDiag("single_close_fallback_used", {
              cycleId: singleCycle.cycleId,
              reason: "close_attempt_budget_exhausted",
            }, true);
          }

          setSingleState("single_waitReturned", "close_attempted");
          break;
        }

        case "single_waitReturned": {
          if (!singleCycle?.transitionedAwayAt) {
            setSingleState("single_findOpenable", "missing_transition_in_wait_returned");
            break;
          }

          if (hasSingleReturnedToList()) {
            finalizeSingleCycle("returned_to_list");

            singleCycle.delayStartedAt = Date.now();
            setSingleState("single_interCycleDelay", "return_confirmed");
            break;
          }

          if (
            singleCycle.closeAttempts < OPEN_MAX_CLOSE_ATTEMPTS &&
            (!singleCycle.closeAttemptedAt || Date.now() - singleCycle.closeAttemptedAt >= OPEN_CLOSE_RETRY_MS)
          ) {
            await attemptCloseOpenedSnap();
            singleCycle.closeAttempts += 1;
            singleCycle.closeAttemptedAt = Date.now();
          }

          if (Date.now() - singleCycle.transitionedAwayAt >= OPEN_RETURN_TIMEOUT_MS) {
            const jumped = await resyncSingleState("single_waitReturned", "return_timeout");
            if (!jumped && Date.now() - singleCycle.clickedAt >= OPEN_HARD_CYCLE_TIMEOUT_MS) {
              finalizeSingleCycle("hard_cycle_timeout", { allowClickFallback: true });
              logSingleDiag("single_open_count_blocked_no_proof", {
                cycleId: singleCycle.cycleId,
                reason: "hard_cycle_timeout",
              }, true);
              resetSingleCycle("single_hard_cycle_timeout");
              setSingleState("single_findOpenable", "single_hard_cycle_timeout");
            }
            break;
          }

          await sleep(pollMs);
          break;
        }

        case "single_interCycleDelay": {
          if (!singleCycle?.delayStartedAt) {
            if (singleCycle) singleCycle.delayStartedAt = Date.now();
          }

          if (Date.now() - singleCycle.delayStartedAt >= delayMs) {
            resetSingleCycle("inter_cycle_delay_complete");
            setSingleState("single_findOpenable", "delay_elapsed");
            break;
          }

          await sleep(Math.min(pollMs, Math.max(25, delayMs / 2)));
          break;
        }

        default:
          setSingleState("single_findOpenable", "unknown_single_state");
          await sleep(pollMs);
      }
    }
  }

  async function runMultiOpenLoop() {
    let currentIndex = 0;
    while (isMultiRunning) {
      if (!multiModeNames.length) {
        await sleep(getPollMs(getMultiDelay()));
        continue;
      }

      const name = multiModeNames[currentIndex];
      currentIndex = (currentIndex + 1) % multiModeNames.length;

      const cycleResult = await runMultiOpenCycleForName(name);

      if (cycleResult.transitionedAway && cycleResult.returnedToList) {
        multiSnapsOpened += 1;
        updateMultiStatus();
        logMultiDiag("multi_open_proof_confirmed", {
          target: name,
          reason: cycleResult.reason,
          count: multiSnapsOpened,
        });
      } else if (cycleResult.timedOut) {
        console.warn(`[Open/Multi] Timed out waiting for "${name}" cycle (${cycleResult.reason}); skipping.`);
      } else if (cycleResult.skipped) {
        logMultiDiag("multi_target_skipped", {
          target: name,
          reason: cycleResult.reason,
        });
      }

      multiStateId = 'multi_interCycleDelay';
      lifecycle.emit('onState', {...getState(), reason:'cycle_complete'});
      await sleep(getMultiDelay());
    }
  }

  function startMultiMode() {
    if (isMultiRunning) return;
    if (!multiModeNames.length) {
      console.warn("[Open/Multi] Add at least one username before starting.");
      return;
    }

    isMultiRunning = true;
    multiSnapsOpened = 0;
    updateMultiStatus();
    setMultiRunningUI(true);
    multiLoopPromise = runMultiOpenLoop().catch(e=>lifecycle.error(e)).finally(() => {
      multiLoopPromise = null;
      stopMultiMode();lifecycle.stop();
    });
  }

  function stopMultiMode() {
    if (!isMultiRunning) return;
    isMultiRunning = false;
    setMultiRunningUI(false);
  }

  function startSingleMode() {
    if (isSingleRunning) return;
    isSingleRunning = true;
    singleSnapsOpened = 0;
    updateSingleStatus();
    setSingleRunningUI(true);
    singleLoopPromise = runSingleOpenLoop().catch(e=>lifecycle.error(e)).finally(() => {
      singleLoopPromise = null;
      stopSingleMode();lifecycle.stop();
    });
  }

  function stopSingleMode() {
    if (!isSingleRunning) return;
    isSingleRunning = false;
    setSingleRunningUI(false);
  }

  function addMultiName(name) {
    const normalized = normalizeText(name);
    if (!normalized) return false;
    const exists = multiModeNames.some((n) => normalizeText(n) === normalized);
    if (exists) return false;
    multiModeNames.push(name.trim());

    return true;
  }




 function getState(){return {running:isSingleRunning||isMultiRunning,mode:options.mode==='multi'?'multi':'single',state:options.mode==='multi'?multiStateId:singleStateId,snapsOpened:options.mode==='multi'?multiSnapsOpened:singleSnapsOpened,recipients:[...multiModeNames]};}
 function stop(){stopSingleMode();stopMultiMode();lifecycle.stop();return Promise.all([singleLoopPromise,multiLoopPromise]);}
 for(const name of options.recipients||[])addMultiName(name);
 function start(){if(singleLoopPromise||multiLoopPromise)return singleLoopPromise||multiLoopPromise;if(options.mode==='multi'&&!multiModeNames.length)throw Error('Multi mode requires recipients');lifecycle.begin();if(options.mode==='multi')startMultiMode();else startSingleMode();return singleLoopPromise||multiLoopPromise;}
 return {start,stop,getState,dispose(){const p=stop();lifecycle.dispose();return p;}};
}
