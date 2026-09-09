import {createLifecycle,requireDocument} from './lifecycle.js';
import {createPatternFinder} from './patterns.js';
export function createSender(options={}){
 const document=requireDocument(options),window=document.defaultView;
 const {Element,HTMLElement,Node,MouseEvent,PointerEvent,TouchEvent,Touch,Event,HTMLCanvasElement}=window;
 const lifecycle=createLifecycle(options);const Date={now:()=>lifecycle.clock.now()};
 const random=options.random||Math.random;
 const console={log(){},debug(){},warn(...a){lifecycle.emit('onDiagnostic',{level:'warning',message:a.map(String).join(' ')});},error(...a){lifecycle.emit('onError',{message:a.map(String).join(' ')});}};
 const config={actionDelay:100,loopDelay:50,targetSnapCount:0,snapThreshold:2000,...options};
 const {finder:smartFinder,configs:elementConfigs}=createPatternFinder(document,{now:()=>lifecycle.clock.now(),onDiagnostic:data=>lifecycle.emit('onDiagnostic',data)});
 let loopPromise=null,errorHandlers=null,releaseCanvas=()=>{};
 function installCanvas(){
        const native = HTMLCanvasElement.prototype.toBlob;
        if (!native) return;
        if (native._gmCoreCanvasLease) {
            native._gmCoreCanvasLease.references++;
            let released=false;
            releaseCanvas=()=>{if(released)return;released=true;const lease=native._gmCoreCanvasLease;if(--lease.references===0&&HTMLCanvasElement.prototype.toBlob===native)HTMLCanvasElement.prototype.toBlob=lease.original;};
            return;
        }
        if (native._snapPatch) return;

        const dataURLtoBlob = (url) => {
            const [meta, b64] = url.split(",");
            const mime = (/^data:(.*?);/i.exec(meta) || [,"application/octet-stream"])[1];
            const bin = atob(b64);
            const len = bin.length;
            const u8  = new Uint8Array(len);
            for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
            return new Blob([u8], { type: mime });
        };

        HTMLCanvasElement.prototype.toBlob = function patched(cb, type = "image/jpeg", quality = 0.95) {
            let settled = false;
            const safe = (blob) => {
                if (!settled) {
                    settled = true;
                    try { cb(blob); } catch {}
                }
            };

            try {
                native.call(this, (b) => {
                    if (b) return safe(b);

                    const quals = [0.9, 0.85, 0.8, 0.75, 0.7];
                    let i = 0;

                    const tryNext = () => {
                        if (i >= quals.length) {
                            try { return safe(dataURLtoBlob(this.toDataURL(type))); } catch {}
                            try { return safe(dataURLtoBlob(this.toDataURL("image/png"))); } catch {}
                            return safe(null);
                        }
                        try {
                            native.call(this, (b2) => b2 ? safe(b2) : tryNext(), type, quals[i++]);
                        } catch {
                            tryNext();
                        }
                    };

                    tryNext();
                }, type, quality);
            } catch {
                try { return safe(dataURLtoBlob(this.toDataURL(type))); } catch {}
                try { return safe(dataURLtoBlob(this.toDataURL("image/png"))); } catch {}
                safe(null);
            }
        };

        Object.defineProperty(HTMLCanvasElement.prototype.toBlob, "_snapPatch", { value: true });
        const installed=HTMLCanvasElement.prototype.toBlob;
        const lease={references:1,original:native};
        Object.defineProperty(installed,'_gmCoreCanvasLease',{value:lease});
        let released=false;
        releaseCanvas=()=>{if(released)return;released=true;if(--lease.references===0&&HTMLCanvasElement.prototype.toBlob===installed)HTMLCanvasElement.prototype.toBlob=native;};
}

    'use strict';

    // --- PRIVATE VARIABLES ---
    let People = [];
    let Shortcuts = [];
    let recipientMode = 'nickname';
    let snapsSent = 0;
    let actionInProgress = false;
    let stopRequested = false;

    // State machine variables for the automation loop
    let currentState = 'searching';
    let peopleClickIndex = 0;
    let stateStartTime = Date.now();
    let lastClickedElement = null;
    let lastClickTime = 0;
    let sendButtonAttempts = 0;
    let recipientSelectionAttempts = 0;
    let recipientsPreparedForSend = false;
    let selectedCycleId = 0;
    let selectedRecipientCount = 0;
    let commitStartedAt = 0;
    let ackStartedAt = 0;
    let sendHardTimeoutStartedAt = 0;
    let finalSendClickIssued = false;
    let currentStateId = 'searching';
    let statePointer = 'searching';
    let stateFailCount = 0;
    let lastResyncAt = 0;
    let strictSendCycle = null;
    let diagnosticsTick = 0;

    const SEND_ACK_WINDOW_MS = 1200;
    const SEND_ACK_POLL_MS = 45;
    const SEND_HARD_TIMEOUT_MS = 4500;
    const STATE_RESYNC_MISS_THRESHOLD = 2;
    const STATE_RESYNC_CONFIDENCE_THRESHOLD = 0.62;
    const STATE_RESYNC_MIN_INTERVAL_MS = 120;

    const SEND_STATE_GRAPH = {
        searching: { id: 'searching', prev: 'waitingForLoop', next: 'takePicture' },
        takePicture: { id: 'takePicture', prev: 'searching', next: 'sendTo' },
        sendTo: { id: 'sendTo', prev: 'takePicture', next: 'selectRecipients' },
        selectRecipients: { id: 'selectRecipients', prev: 'sendTo', next: 'prepareFinalSend' },
        prepareFinalSend: { id: 'prepareFinalSend', prev: 'selectRecipients', next: 'commitFinalSend' },
        commitFinalSend: { id: 'commitFinalSend', prev: 'prepareFinalSend', next: 'awaitSendAck' },
        awaitSendAck: { id: 'awaitSendAck', prev: 'commitFinalSend', next: 'waitingForLoop' },
        waitingForLoop: { id: 'waitingForLoop', prev: 'awaitSendAck', next: 'searching' }
    };

    // DOM element references


    // Page visibility tracking for background execution
    let isPageVisible = !document.hidden;
    let backgroundExecutionMode = false;

    // Listen for page visibility changes


    /**
     * Background-compatible delay function that works even when tab is not visible
     */
    function robustDelay(ms){return lifecycle.sleep(ms);}

    // Removed user interaction tracking - keeping it simple

    // --- PRIVATE FUNCTIONS ---

    function normalizeRecipientLabel(value) {
        return String(value || '')
            .normalize('NFKC')
            .replace(/\u00A0/g, ' ')
            .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase();
    }

    function getActiveRecipients() {
        return recipientMode === 'shortcut' ? Shortcuts : People;
    }

    function isDuplicateRecipient(list, value) {
        const normalizedValue = normalizeRecipientLabel(value);
        return list.some((entry) => normalizeRecipientLabel(entry) === normalizedValue);
    }







    // Backward compatibility for legacy callers in content.js.


    function setRecipientMode(mode){recipientMode=mode==='shortcut'?'shortcut':'nickname';}

// User activation preservation removed - extension runs autonomously

/**
 * The main automation loop for sending snaps.
 */
function startSendAutomation() {
	if (actionInProgress) return;
	actionInProgress = true;
	stopRequested = false; // Reset stop flag when starting

	// Save the state as "Start"


	const ACTION_DELAY = config.actionDelay;
	const LOOP_DELAY = config.loopDelay;

	// Reset state machine for tracking progress
	currentState = 'searching';
	currentStateId = 'searching';
	statePointer = 'searching';
	stateFailCount = 0;
	lastResyncAt = 0;
	strictSendCycle = null;
	peopleClickIndex = 0;
	recipientSelectionAttempts = 0;
	recipientsPreparedForSend = false;
	selectedCycleId = 0;
	selectedRecipientCount = 0;
	commitStartedAt = 0;
	ackStartedAt = 0;
	sendHardTimeoutStartedAt = 0;
	finalSendClickIssued = false;
	diagnosticsTick = 0;
	stateStartTime = Date.now();
	lastClickedElement = null;
	lastClickTime = 0;
	sendButtonAttempts = 0; // Track send button attempts
	let cameraErrorCount = 0; // Track camera errors
	let takePictureAttempts = 0; // Track take picture attempts

	// Simplified error handler - toBlob patch should prevent most errors
	// Keep minimal error handling for edge cases and debugging
	const errorHandler = (event) => {
		if (event.message && event.message.includes('Failed to create image/jpeg image Blob')) {
			console.warn('[snapx] toBlob error detected (should be rare with patch):', event.message);
			cameraErrorCount++;

			// Only intervene after multiple errors (patch should handle most cases)
			if (cameraErrorCount >= 5) {
				console.error('Multiple camera errors despite patch. Attempting recovery...');

				// Try to recover by resetting camera state
				const closeButton = document.querySelector('button[aria-label="Close"]') ||
								  document.querySelector('button.close') ||
								  document.querySelector('[role="button"][aria-label*="close"]');
				if (closeButton) {
					console.log('Clicking close button to reset camera state');
					closeButton.click();
					cameraErrorCount = 0;
					setAutomationState('searching', 'camera_error_recovery');
					lastClickedElement = null;
					return;
				}

				// Last resort - reload
				console.error('Could not recover from repeated camera errors. Refreshing page...');
				actionInProgress = false;
				lifecycle.emit('onReloadRequested',getState());stop();
			}

			// Don't prevent - let global handler deal with it
			return true;
		}
	};

	// Store handler for cleanup (rejection handler removed - global handler covers this)
	errorHandlers = { error: errorHandler };

	window.addEventListener('error', errorHandler);

		const activeRecipientsAtStart = getActiveRecipients();
		console.log('Starting automation with recipient mode:', recipientMode);
		console.log('Nickname recipients:', People);
		console.log('Shortcut recipients:', Shortcuts);
		console.log('Active recipients count:', activeRecipientsAtStart.length);
			if (activeRecipientsAtStart.length === 0) {
				console.error('ERROR: Active recipient array is empty. Cannot send snaps without recipients.');
				console.error(`Please add at least one ${recipientMode === 'shortcut' ? 'shortcut' : 'nickname'} before starting automation.`);
				actionInProgress = false;
				window.removeEventListener('error', errorHandler);
				return;
			}

		function logSendDiagnostic(event, extra = {}, force = false) {
			diagnosticsTick += 1;
			if (!force && diagnosticsTick % 8 !== 0) return;
			console.log('[SendDiag]', {
				event,
				cycleId: selectedCycleId,
				state: currentState,
				statePointer,
				recipientMode,
				peopleClickIndex,
				sendAttempt: sendButtonAttempts,
				ackResult: extra.ackResult || null,
				...extra
			});
		}

		function setAutomationState(nextState, reason = 'transition') {
			if (!SEND_STATE_GRAPH[nextState]) return;
			if (currentState === nextState) return;
			const previousState = currentState;
			currentState = nextState;
			currentStateId = nextState;
			statePointer = nextState;
			stateStartTime = Date.now();
			stateFailCount = 0;
            lifecycle.emit('onState', {state:nextState,previous:previousState,reason});
			logSendDiagnostic('state_jump', { from: previousState, to: nextState, reason }, true);
		}

		function resetStrictCycle(reason = 'reset') {
			if (strictSendCycle) {
				logSendDiagnostic('strict_cycle_reset', { reason, cycleId: strictSendCycle.cycleId });
			}
			strictSendCycle = null;
			recipientsPreparedForSend = false;
			selectedRecipientCount = 0;
			commitStartedAt = 0;
			ackStartedAt = 0;
			sendHardTimeoutStartedAt = 0;
			finalSendClickIssued = false;
			sendButtonAttempts = 0;
			recipientSelectionAttempts = 0;
		}

		function createStrictCycle(recipientCount) {
			selectedCycleId += 1;
			strictSendCycle = {
				cycleId: selectedCycleId,
				recipientsLocked: true,
				selectedRecipientCount: recipientCount,
				finalSendClickedAt: null,
				postSendTransitionAt: null,
				ackReason: null
			};
			selectedRecipientCount = recipientCount;
		}

		function markFinalSendClicked() {
			if (!strictSendCycle) return;
			strictSendCycle.finalSendClickedAt = Date.now();
			finalSendClickIssued = true;
		}

		function markPostSendTransition(reason) {
			if (!strictSendCycle) return;
			strictSendCycle.postSendTransitionAt = Date.now();
			strictSendCycle.ackReason = reason;
		}

		function hasStrictSendProof() {
			return Boolean(
				strictSendCycle &&
				strictSendCycle.finalSendClickedAt &&
				strictSendCycle.postSendTransitionAt
			);
		}

		function isElementInteractable(element) {
			if (!element || !element.isConnected) return false;
			const rect = element.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return false;
			const style = window.getComputedStyle(element);
			if (!style) return false;
			if (style.display === 'none') return false;
			if (style.visibility === 'hidden') return false;
			if (style.pointerEvents === 'none') return false;
			if (Number.parseFloat(style.opacity || '1') === 0) return false;
			if (element.disabled) return false;
			if (element.getAttribute('aria-disabled') === 'true') return false;
			return true;
		}

		async function findInteractableSendButton({ preferFast = true, silent = false } = {}) {
			const directSelectors = [
				'button.TYX6O.eKaL7.Bnaur[type="submit"]',
				'.OzZgU button[type="submit"]',
				'button[type="submit"]',
				'button:has(.s53_U)'
			];
			for (const selector of directSelectors) {
				const candidate = document.querySelector(selector);
				if (isElementInteractable(candidate)) {
					return candidate;
				}
			}

			// Fast path skips expensive pattern probing on most passes.
			if (preferFast && sendButtonAttempts % 4 !== 0) {
				return null;
			}

			const sendButton = await findElementQuick('sendButton', { silent });
			if (!isElementInteractable(sendButton)) return null;
			return sendButton;
		}

		function isCameraOrCaptureViewVisible() {
			const cameraBtn = document.querySelector('button.qJKfS');
			if (isElementInteractable(cameraBtn)) return true;
			const takePicBtn = document.querySelector('button.fE2D5, button.FBYjn');
			return isElementInteractable(takePicBtn);
		}

		function isElementVisible(element) {
			if (!element || !element.isConnected) return false;
			const rect = element.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		}

		function isSendToViewVisible() {
			const byClass = document.querySelector('button.YatIx');
			if (isElementVisible(byClass)) return true;

			const byText = Array.from(document.querySelectorAll('button')).find((button) => {
				const label = normalizeRecipientLabel(button.textContent || button.innerText);
				return label.includes('send to') && isElementVisible(button);
			});
			if (byText) return true;

			const hasDownloadButton = Array.from(document.querySelectorAll('button')).some((button) => {
				const label = normalizeRecipientLabel(button.textContent || button.innerText);
				return label.includes('download') && isElementVisible(button);
			});

			return hasDownloadButton;
		}

		function isRecipientSelectionViewVisible() {
			const selectionSelectors = [
				'li.Ewflr',
				'li.RbA83',
				'.L7aBq',
				'.JwhOC',
				'div.THeKv',
				'button.c47Sk',
				'button.Y7u8A'
			];
			return selectionSelectors.some((selector) =>
				Array.from(document.querySelectorAll(selector)).some((el) => {
					const rect = el.getBoundingClientRect();
					return rect.width > 0 && rect.height > 0;
				})
			);
		}

		async function hasExpectedMarkerForState(stateId) {
			switch (stateId) {
				case 'searching':
					return Boolean(
						document.querySelector('button.qJKfS') ||
						document.querySelector('button.fE2D5, button.FBYjn')
					);
				case 'takePicture':
					return Boolean(document.querySelector('button.fE2D5, button.FBYjn'));
				case 'sendTo':
					return isSendToViewVisible();
				case 'selectRecipients':
					return isRecipientSelectionViewVisible();
				case 'prepareFinalSend':
					return recipientsPreparedForSend;
				case 'commitFinalSend':
					return Boolean(await findInteractableSendButton({ preferFast: true, silent: true }));
				case 'awaitSendAck':
					return Boolean(ackStartedAt > 0);
				case 'waitingForLoop':
					return true;
				default:
					return false;
			}
		}

		async function classifyCurrentScreen() {
			const markers = {};
			const sendButton = await findInteractableSendButton({ preferFast: true, silent: true });
			markers.commitFinalSend = Boolean(sendButton);
			if (markers.commitFinalSend) {
				return { screenId: 'commitFinalSend', confidence: 0.95, markers };
			}

			markers.selectRecipients = isRecipientSelectionViewVisible();
			if (markers.selectRecipients) {
				return { screenId: 'selectRecipients', confidence: 0.9, markers };
			}

			markers.sendTo = isSendToViewVisible();
			if (markers.sendTo) {
				return { screenId: 'sendTo', confidence: 0.86, markers };
			}

			markers.takePicture = Boolean(document.querySelector('button.fE2D5, button.FBYjn'));
			if (markers.takePicture) {
				return { screenId: 'takePicture', confidence: 0.82, markers };
			}

			markers.cameraHome = Boolean(document.querySelector('button.qJKfS'));
			if (markers.cameraHome) {
				return { screenId: 'searching', confidence: 0.76, markers };
			}

			return { screenId: 'unknown', confidence: 0, markers };
		}

		async function resyncStateFromClassifier(expectedState, reason) {
			stateFailCount += 1;
			logSendDiagnostic('state_miss_expected', {
				expectedState,
				failCount: stateFailCount,
				reason
			});

			if (stateFailCount < STATE_RESYNC_MISS_THRESHOLD) {
				return false;
			}

			if (Date.now() - lastResyncAt < STATE_RESYNC_MIN_INTERVAL_MS) {
				return false;
			}

			lastResyncAt = Date.now();
			const classification = await classifyCurrentScreen();
			logSendDiagnostic('state_classifier_result', {
				expectedState,
				classifiedState: classification.screenId,
				confidence: classification.confidence,
				markers: classification.markers
			}, true);

			if (classification.screenId !== 'unknown' && classification.confidence >= STATE_RESYNC_CONFIDENCE_THRESHOLD) {
				if (classification.screenId !== currentState) {
					setAutomationState(classification.screenId, `classifier:${reason}`);
					return true;
				}
				stateFailCount = 0;
				return false;
			}

			const graphNode = SEND_STATE_GRAPH[currentState];
			const neighborStates = [graphNode?.prev, graphNode?.next].filter(Boolean);
			for (const candidateState of neighborStates) {
				if (await hasExpectedMarkerForState(candidateState)) {
					setAutomationState(candidateState, `neighbor_probe:${reason}`);
					return true;
				}
			}

			logSendDiagnostic('state_jump_rejected_low_conf', {
				expectedState,
				confidence: classification.confidence
			}, true);
			return false;
		}

		async function isSendAcknowledged() {
			const hasFinalClickProof = Boolean(strictSendCycle && strictSendCycle.finalSendClickedAt);
			if (!hasFinalClickProof) {
				return { confirmed: false, reason: 'no_final_send_click_proof' };
			}
			if (isCameraOrCaptureViewVisible()) {
				return { confirmed: true, reason: 'camera_or_capture_visible' };
			}
			if (isSendToViewVisible()) {
				return { confirmed: true, reason: 'send_to_visible_after_send' };
			}
			const recipientViewVisible = isRecipientSelectionViewVisible();
			const interactableSendButton = await findInteractableSendButton({ preferFast: true, silent: true });
			if (!recipientViewVisible && !interactableSendButton) {
				return { confirmed: true, reason: 'selection_view_exited' };
			}
			return { confirmed: false, reason: 'pending' };
		}

		async function waitForSendAcknowledgement({ timeoutMs = SEND_ACK_WINDOW_MS, pollMs = SEND_ACK_POLL_MS } = {}) {
			const startedAt = Date.now();
			while (actionInProgress && Date.now() - startedAt < timeoutMs) {
				const ack = await isSendAcknowledged();
				if (ack.confirmed) return ack;
				await robustDelay(pollMs);
			}
			return { confirmed: false, reason: 'ack_timeout' };
		}

	async function clickSpecificButton() {
		const button = await findElementQuick('cameraButton');
		if (button) {
			button.click();
		} else {
			console.error('Camera button not found');
		}
	}

	async function clickPersonByName(name) {
		const normalizedTargetName = normalizeRecipientLabel(name);
		if (!normalizedTargetName) {
			console.warn('Nickname recipient not found: empty target name');
			return false;
		}

		// Try pattern recognition first if available
		if (Boolean(smartFinder) && smartFinder) {
			try {
				const listItems = document.querySelectorAll('li.Ewflr, li.RbA83');

				for (const listItem of listItems) {
					const nameElement = listItem.querySelector('.RBx9s.nonIntl, .mYSR9.nonIntl');
					const candidateName = normalizeRecipientLabel(nameElement?.textContent || nameElement?.innerText);
					if (!nameElement || candidateName !== normalizedTargetName) {
						continue;
					}

					const isGroup = listItem.querySelector('.mYSR9.nonIntl') !== null;
					const clickTargets = isGroup ?
						listItem.querySelectorAll('.JwhOC') :
						listItem.querySelectorAll('.L7aBq');

					for (const target of clickTargets) {
						// Simple visibility check
						const rect = target.getBoundingClientRect();
						if (rect.width > 0 && rect.height > 0) {
							await simulateClick(target);
							console.log(`Clicked on ${isGroup ? 'group' : 'person'}: ${name} (pattern recognition)`);
							return true;
						}
					}
				}
			} catch (e) {
				console.warn('Pattern recognition failed for person selection:', e);
			}
		}

		// Fallback to original method
		const nameElements = document.querySelectorAll('.RBx9s.nonIntl');
		const groupchatElements = document.querySelectorAll('.mYSR9.nonIntl');

		for (const groupElement of groupchatElements) {
			const candidateName = normalizeRecipientLabel(groupElement.textContent || groupElement.innerText);
			if (candidateName === normalizedTargetName) {
				const listItem = groupElement.closest('li');
				if (listItem) {
					const groupchatElement = listItem.querySelector('.JwhOC');
					if (groupchatElement) {
						await simulateClick(groupchatElement);
						console.log(`Clicked on Groupchat: ${name} (fallback)`);
						return true;
					}
				}
			}
		}

		for (const nameElement of nameElements) {
			const candidateName = normalizeRecipientLabel(nameElement.textContent || nameElement.innerText);
			if (candidateName === normalizedTargetName) {
				const listItem = nameElement.closest('li');
				if (listItem) {
					const clickableElement = listItem.querySelector('.L7aBq');
					if (clickableElement) {
						await simulateClick(clickableElement);
						console.log(`Clicked on person: ${name} (fallback)`);
						return true;
					}
				}
			}
		}

		console.warn(`Nickname recipient not found: ${name}`);
		return false;
	}

			async function findShortcutSelectButton() {
				const patternButton = await findElementQuick('shortcutSelectButton');
				if (patternButton && patternButton.offsetWidth > 0 && patternButton.offsetHeight > 0) {
					return patternButton;
				}

				const byClass = Array.from(document.querySelectorAll('button.Y7u8A'));
				const visibleClassMatch = byClass.find((button) => button.offsetWidth > 0 && button.offsetHeight > 0);
				if (visibleClassMatch) {
					return visibleClassMatch;
				}

			const byText = Array.from(document.querySelectorAll('button')).find((button) => {
				const text = normalizeRecipientLabel(button.textContent || button.innerText);
				return text === 'select' && button.offsetWidth > 0 && button.offsetHeight > 0;
			});
			return byText || null;
		}

			async function clickShortcutSelectButton(shortcutLabel) {
				const timeoutMs = 900;
				const pollMs = 50;
				const maxClickAttempts = 2;
				let clickAttempts = 0;
				let clickedAtLeastOnce = false;
				const start = Date.now();

				while (Date.now() - start < timeoutMs) {
					const selectButton = await findShortcutSelectButton();
					if (!selectButton || !isElementInteractable(selectButton)) {
						await robustDelay(pollMs);
						continue;
					}

					const beforeText = normalizeRecipientLabel(selectButton.textContent || selectButton.innerText);
					const beforeDisabled = selectButton.disabled || selectButton.getAttribute('aria-disabled') === 'true';

					// Lightweight click for Select to avoid duplicate multi-event bursts.
					try {
						selectButton.click();
					} catch (error) {
						console.warn('Native Select click failed, falling back to simulateClick:', error);
						await simulateClick(selectButton);
					}

					clickedAtLeastOnce = true;
					clickAttempts += 1;
					await robustDelay(70);

					// Fast positive acknowledgment: if final send is now interactable, we can continue.
					const sendReady = await findInteractableSendButton({ preferFast: true, silent: true });
					if (sendReady) {
						console.log(`Shortcut Select acknowledged by send readiness for: ${shortcutLabel}`);
						return true;
					}

					const postClickSelectButton = await findShortcutSelectButton();
					const afterDisabled = postClickSelectButton
						? (postClickSelectButton.disabled || postClickSelectButton.getAttribute('aria-disabled') === 'true')
						: false;
					const afterText = postClickSelectButton
						? normalizeRecipientLabel(postClickSelectButton.textContent || postClickSelectButton.innerText)
						: '';

					const transitioned =
						!postClickSelectButton ||
						postClickSelectButton !== selectButton ||
						(!beforeDisabled && afterDisabled) ||
						afterText !== beforeText;

					if (transitioned) {
						console.log(`Clicked shortcut Select button for: ${shortcutLabel}`);
						return true;
					}

					// Avoid excessive Select spam. After bounded attempts, continue optimistically and let send-ack gate validate.
					if (clickAttempts >= maxClickAttempts) {
						console.warn(`Select transition ambiguous for "${shortcutLabel}" after ${maxClickAttempts} attempts; continuing with send commit.`);
						return true;
					}

					await robustDelay(90);
				}

				if (clickedAtLeastOnce) {
					console.warn(`Select transition timed out for "${shortcutLabel}" after click; continuing with send commit.`);
					return true;
				}

				console.warn(`Select button not found after choosing shortcut: ${shortcutLabel}`);
				return false;
			}

		async function clickShortcutByName(shortcutLabel) {
			const normalizedTarget = normalizeRecipientLabel(shortcutLabel);
			if (!normalizedTarget) return false;

			const tryMatchInCandidates = (candidates) => {
				for (const candidate of candidates) {
					if (!candidate) continue;
					const label = normalizeRecipientLabel(candidate.textContent || candidate.innerText);
					if (label !== normalizedTarget) continue;
					if (candidate.offsetWidth <= 0 || candidate.offsetHeight <= 0) continue;
					return candidate;
				}
				return null;
			};

			if (Boolean(smartFinder) && smartFinder && elementConfigs?.shortcutSelector) {
				try {
					const config = elementConfigs.shortcutSelector;
					const result = await smartFinder.findElement(config.fingerprint, {
						fallbackSelectors: config.fallbackSelectors,
						threshold: 0.5,
						useCache: true,
						timeout: 150
					});

					if (result?.element) {
						const buttons = Array.from(document.querySelectorAll('div.THeKv > button.c47Sk, button.c47Sk'));
						const matched = tryMatchInCandidates(buttons);
						if (matched) {
							await simulateClick(matched);
							console.log(`Clicked shortcut: ${shortcutLabel} (pattern-assisted)`);
							return clickShortcutSelectButton(shortcutLabel);
						}
					}
				} catch (error) {
					console.warn('Pattern recognition failed for shortcut selection:', error);
				}
			}

			const fallbackButtons = Array.from(document.querySelectorAll('div.THeKv > button.c47Sk, button.c47Sk'));
			const fallbackMatch = tryMatchInCandidates(fallbackButtons);
			if (fallbackMatch) {
				await simulateClick(fallbackMatch);
				console.log(`Clicked shortcut: ${shortcutLabel} (fallback)`);
				return clickShortcutSelectButton(shortcutLabel);
			}

			console.warn(`Shortcut not found: ${shortcutLabel}`);
			return false;
		}

	function updateSnapsSent(count){snapsSent+=count;lifecycle.emit('onProgress',getState());managePatternCache();if(config.targetSnapCount>0&&snapsSent>=config.targetSnapCount){stop();return;}if(config.snapThreshold>0&&snapsSent%config.snapThreshold===0){lifecycle.emit('onReloadRequested',getState());stop();}}



	function isSameElementClicked(element) {
		// Check if it's the same element and was clicked within last 500ms
		return lastClickedElement === element && (Date.now() - lastClickTime) < 500;
	}

	async function simulateClick(element) { lifecycle.check();
		// Ensure element is visible and focusable
		element.scrollIntoView({ behavior: 'instant', block: 'center' });

		// Focus the element if possible
		if (typeof element.focus === 'function') {
			element.focus();
		}

		// Shortcut Select button is sensitive; use a single native click to avoid duplicate submissions.
		const isShortcutSelectButton =
			element.classList?.contains('Y7u8A') ||
			normalizeRecipientLabel(element.textContent || element.innerText) === 'select';
		if (isShortcutSelectButton) {
			try {
				element.click();
			} catch (e) {
				console.log('Single-click shortcut Select failed:', e);
			}
			const actionDelay = config.actionDelay;
			await robustDelay(Math.max(40, Math.min(actionDelay, 120)));
			return;
		}

		// Method 1: Direct native click (most reliable)
		try {
			element.click();
			console.log('Primary native click executed');
		} catch (e) {
			console.log('Primary native click failed:', e);
		}

		// Get element coordinates for synthetic events
		const rect = element.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;

		// Method 2: Try Pointer Events (modern approach)
		try {
			const pointerDownEvent = new PointerEvent('pointerdown', {
				bubbles: true,
				cancelable: true,
				view: window,
				button: 0,
				buttons: 1,
				clientX: centerX,
				clientY: centerY,
				pointerId: 1,
				pointerType: 'mouse'
			});

			const pointerUpEvent = new PointerEvent('pointerup', {
				bubbles: true,
				cancelable: true,
				view: window,
				button: 0,
				buttons: 0,
				clientX: centerX,
				clientY: centerY,
				pointerId: 1,
				pointerType: 'mouse'
			});

			element.dispatchEvent(pointerDownEvent);
			element.dispatchEvent(pointerUpEvent);
		} catch (e) {
			console.log('Pointer events failed:', e);
		}

		// Method 3: Mouse Events (additional synthetic events)
		const mousedownEvent = new MouseEvent('mousedown', {
			bubbles: true,
			cancelable: true,
			view: window,
			button: 0,
			buttons: 1,
			clientX: centerX,
			clientY: centerY
		});

		const mouseupEvent = new MouseEvent('mouseup', {
			bubbles: true,
			cancelable: true,
			view: window,
			button: 0,
			buttons: 0,
			clientX: centerX,
			clientY: centerY
		});

		const clickEvent = new MouseEvent('click', {
			bubbles: true,
			cancelable: true,
			view: window,
			button: 0,
			clientX: centerX,
			clientY: centerY
		});

		element.dispatchEvent(mousedownEvent);
		element.dispatchEvent(mouseupEvent);
		element.dispatchEvent(clickEvent);

		// Method 4: Secondary native click (reinforcement)
		try {
			element.click();
			console.log('Secondary native click executed');
		} catch (e) {
			console.log('Secondary native click failed:', e);
		}

		// Use the user's configured action delay
		const actionDelay = config.actionDelay;
		await robustDelay(actionDelay);
	}

	async function findElementQuick(elementType, options = {}) {
		const { silent = false, skipPattern = false } = options;
		let element = null;

		// Try pattern recognition first
		if (!skipPattern && Boolean(smartFinder) && smartFinder && elementConfigs && elementConfigs[elementType]) {
			try {
				const config = elementConfigs[elementType];
				// Only log pattern recognition attempts for non-frequent elements
				if (!silent && (elementType !== 'sendToButton' || !element)) {
					console.log(`Using pattern recognition for ${elementType}`);
				}
				const result = await smartFinder.findElement(config.fingerprint, {
					fallbackSelectors: config.fallbackSelectors,
					threshold: elementType === 'sendButton' ? 0.6 : 0.5, // Lower threshold for better matching
					useCache: true, // Enable caching for better performance
					timeout: 100 // Slightly longer timeout
				});

				if (result.element) {
					if (result.method === 'cached') {
						if (!silent) console.log(`Found ${elementType} from cache (confidence: ${result.confidence})`);
					} else {
						if (!silent) console.log(`Pattern recognition found ${elementType} via ${result.method} with confidence ${result.confidence}`);
					}
					element = result.element;
					return element;
				} else if (elementType !== 'sendToButton') {
					if (!silent) console.log(`Pattern recognition failed for ${elementType}: confidence too low or no match`);
				}
			} catch (e) {
				if (!silent) console.error('Pattern recognition error:', e);
			}
		}

		// Quick fallback check
		switch(elementType) {
			case 'cameraButton':
				element = document.querySelector('button.qJKfS');
				break;
			case 'takePictureButton':
				const takePictureSelectors = [
					// New selectors based on actual HTML
					'button.fE2D5',
					'.VLm6Y > button.fE2D5',
					'div.VLm6Y button[type="button"]:first-child',
					// Old selectors as fallback
					'button.FBYjn.gK0xL.W5dIq',
					'button.FBYjn.gK0xL.A7Cr_.m3ODJ',
					'.i0KT7 > button:first-child',
					'.O7Nhq button.FBYjn:first-child',
					'button.FBYjn',
					'div.i0KT7 button',
					'div.O7Nhq button'
				];
				for (const selector of takePictureSelectors) {
					element = document.querySelector(selector);
					if (element) {
						console.log(`Found take picture button with selector: ${selector}`);
						// Check if button is visible and enabled
						const isVisible = element.offsetWidth > 0 && element.offsetHeight > 0;
						const isEnabled = !element.disabled;
						console.log(`Button state - Visible: ${isVisible}, Enabled: ${isEnabled}`);
						if (isVisible && isEnabled) {
							break;
						}
					}
				}
				break;
			case 'sendToButton':
				// Quick text search
				const buttons = Array.from(document.querySelectorAll('button'));
				element = buttons.find(btn => btn.textContent && btn.textContent.includes('Send To'));
				// Quick class search if text fails
				if (!element) {
					element = buttons.find(btn => {
						const cl = btn.classList;
						return cl.contains('YatIx') && cl.contains('eKaL7') && cl.contains('Bnaur') &&
							(cl.contains('q5eEJ') || cl.contains('fGS78') || cl.contains('bkJA0'));
					});
				}
				break;
			case 'sendButton':
				// Try multiple selectors for the send button
				const sendButtonSelectors = [
					'button.TYX6O.eKaL7.Bnaur[type="submit"]',
					'.OzZgU button[type="submit"]',
					'button[type="submit"]',
					'.s53_U' // Inner div fallback
				];
				for (const selector of sendButtonSelectors) {
					element = document.querySelector(selector);
					if (element) {
						// If we found the inner div, get the parent button
						if (element.classList.contains('s53_U') && element.parentElement?.tagName === 'BUTTON') {
							element = element.parentElement;
						}
						if (!silent) console.log(`Found send button with selector: ${selector}`);
						break;
					}
				}
				break;
		}

		return element;
	}

	async function performSinglePass() { lifecycle.check();
		const passStart = Date.now();

		// Try each element in sequence during each pass
			switch(currentState) {
			case 'waitingForLoop':
				// Wait for LOOP_DELAY before starting next cycle
				if (Date.now() - stateStartTime >= LOOP_DELAY) {
					resetStrictCycle('loop_cycle_complete');
					setAutomationState('searching', 'loop_wait_elapsed');
				}
				break;

			case 'selectRecipients':
				if (recipientsPreparedForSend) {
					setAutomationState('prepareFinalSend', 'selection_already_prepared');
					break;
				}

				// Handle recipients selection based on current mode
				const activeRecipients = getActiveRecipients();
				console.log(`In selectRecipients state. peopleClickIndex: ${peopleClickIndex}, activeRecipients.length: ${activeRecipients.length}, mode: ${recipientMode}`);
				if (peopleClickIndex < activeRecipients.length) {
					const timeForThisPerson = peopleClickIndex * ACTION_DELAY;
					const timeSinceStart = Date.now() - stateStartTime;

					if (timeSinceStart >= timeForThisPerson) {
						const currentRecipient = activeRecipients[peopleClickIndex];
						console.log(`Attempting to click recipient: ${currentRecipient} (${recipientMode})`);
						let recipientSelected = true;
						if (recipientMode === 'shortcut') {
							recipientSelected = await clickShortcutByName(currentRecipient);
						} else {
							recipientSelected = await clickPersonByName(currentRecipient);
						}

						if (recipientSelected) {
							peopleClickIndex++;
							recipientSelectionAttempts = 0;
						} else {
							recipientSelectionAttempts++;
							console.warn(`Failed selecting recipient "${currentRecipient}" attempt ${recipientSelectionAttempts}/3`);
							if (recipientSelectionAttempts >= 3) {
								console.warn(`Skipping recipient "${currentRecipient}" after 3 failed attempts`);
								peopleClickIndex++;
								recipientSelectionAttempts = 0;
							}
						}
					}
				} else {
					// All recipients selected, lock selection and move to send commit phases.
					console.log('All recipients selected, moving to send commit');
					recipientsPreparedForSend = true;
					setAutomationState('prepareFinalSend', 'all_recipients_selected');
				}
				break;

			case 'prepareFinalSend':
				if (!recipientsPreparedForSend) {
					setAutomationState('selectRecipients', 'selection_lock_missing');
					break;
				}
				createStrictCycle(Math.max(1, getActiveRecipients().length));
				sendButtonAttempts = 0;
				commitStartedAt = Date.now();
				ackStartedAt = 0;
				sendHardTimeoutStartedAt = Date.now();
				finalSendClickIssued = false;
				setAutomationState('commitFinalSend', 'prepared_for_commit');
				logSendDiagnostic('prepare_final_send', { selectedRecipientCount: strictSendCycle?.selectedRecipientCount || selectedRecipientCount }, true);
				break;

			case 'commitFinalSend': {
				if (!recipientsPreparedForSend) {
					setAutomationState('selectRecipients', 'selection_lock_missing_during_commit');
					break;
				}

				if (strictSendCycle?.finalSendClickedAt && isSendToViewVisible()) {
					markPostSendTransition('send_to_visible_after_send');
					if (hasStrictSendProof()) {
						updateSnapsSent(strictSendCycle.selectedRecipientCount || selectedRecipientCount);
					} else {
						logSendDiagnostic('count_blocked_no_strict_proof', { reason: 'commit_sendto_without_strict_proof' }, true);
					}
					resetStrictCycle('commit_sendto_ack');
					setAutomationState('waitingForLoop', 'post_send_compose_visible');
					break;
				}

				const hardElapsed = Date.now() - sendHardTimeoutStartedAt;
				if (hardElapsed >= SEND_HARD_TIMEOUT_MS) {
					console.warn(`Hard timeout waiting for final send (${SEND_HARD_TIMEOUT_MS}ms). Resetting cycle.`);
					logSendDiagnostic('hard_timeout_recovery', { hardElapsed, ackResult: 'hard_timeout' }, true);
					peopleClickIndex = 0;
					resetStrictCycle('commit_hard_timeout');
					setAutomationState('searching', 'commit_hard_timeout');
					break;
				}

				const sendBtn = await findInteractableSendButton({ preferFast: true, silent: true });
				if (!sendBtn || isSameElementClicked(sendBtn)) {
					if (strictSendCycle?.finalSendClickedAt && isSendToViewVisible()) {
						markPostSendTransition('send_to_visible_after_send');
						if (hasStrictSendProof()) {
							updateSnapsSent(strictSendCycle.selectedRecipientCount || selectedRecipientCount);
						} else {
							logSendDiagnostic('count_blocked_no_strict_proof', { reason: 'no_strict_proof_sendto_path' }, true);
						}
						resetStrictCycle('commit_sendto_after_click');
						setAutomationState('waitingForLoop', 'compose_detected_after_click');
						break;
					}
					sendButtonAttempts++;
					logSendDiagnostic('waiting_send_interactable', { sendAttempt: sendButtonAttempts, stateFailCount: stateFailCount + 1 });
					const resynced = await resyncStateFromClassifier('commitFinalSend', 'send_button_missing');
					if (resynced) {
						if (currentState !== 'commitFinalSend' && currentState !== 'awaitSendAck') {
							resetStrictCycle('state_resync_from_commit');
							peopleClickIndex = 0;
							if (currentState === 'sendTo') {
								setAutomationState('selectRecipients', 'resynced_to_sendto_then_select');
							}
						}
						return;
					}
					break;
				}

				await simulateClick(sendBtn);
				lastClickedElement = sendBtn;
				lastClickTime = Date.now();
				sendButtonAttempts++;
				markFinalSendClicked();
				ackStartedAt = Date.now();
				setAutomationState('awaitSendAck', 'final_send_clicked');
				logSendDiagnostic('send_clicked', { sendAttempt: sendButtonAttempts, cycleId: selectedCycleId }, true);
				break;
			}

			case 'awaitSendAck': {
				const ack = await waitForSendAcknowledgement({
					timeoutMs: SEND_ACK_WINDOW_MS,
					pollMs: SEND_ACK_POLL_MS
				});

				if (ack.confirmed) {
					markPostSendTransition(ack.reason);
					if (hasStrictSendProof()) {
						updateSnapsSent(strictSendCycle.selectedRecipientCount || selectedRecipientCount);
					} else {
						logSendDiagnostic('count_blocked_no_strict_proof', { reason: ack.reason }, true);
					}
					resetStrictCycle('await_ack_confirmed');
					setAutomationState('waitingForLoop', 'await_ack_confirmed');
					logSendDiagnostic('send_ack_confirmed', { ackResult: ack.reason }, true);
					break;
				}

				const hardElapsed = Date.now() - sendHardTimeoutStartedAt;
				if (hardElapsed >= SEND_HARD_TIMEOUT_MS) {
					console.warn(`Hard timeout after send click (${SEND_HARD_TIMEOUT_MS}ms). Resetting cycle.`);
					logSendDiagnostic('ack_hard_timeout_recovery', { hardElapsed, ackResult: ack.reason }, true);
					peopleClickIndex = 0;
					resetStrictCycle('await_ack_hard_timeout');
					setAutomationState('searching', 'await_ack_hard_timeout');
					break;
				}

				// Retry-send-only strategy: stay in send-commit path without reselecting recipients.
				setAutomationState('commitFinalSend', 'await_ack_retry_send_only');
				logSendDiagnostic('ack_retry_send_only', { ackResult: ack.reason });
				break;
			}


			default: // 'searching' state or any other active state
				// Try camera button first when in searching state
				if (currentState === 'searching') {
					const cameraBtn = await findElementQuick('cameraButton');
					if (cameraBtn && !isSameElementClicked(cameraBtn)) {
						console.log('Found camera button, clicking to open camera interface');
						await simulateClick(cameraBtn);
						lastClickedElement = cameraBtn;
						lastClickTime = Date.now();
						console.log('Clicked camera button');
						setAutomationState('takePicture', 'camera_button_clicked');
						return; // Found something, exit this pass
					}
				}

				// Try take picture button after camera is open
				if (currentState === 'searching' || currentState === 'takePicture') {
					const takePicBtn = await findElementQuick('takePictureButton');
					if (takePicBtn && !isSameElementClicked(takePicBtn)) {

						// Found take picture button, we're already in camera mode
						const hasInnerDiv = takePicBtn.querySelector('div[role="button"]') !== null;
						const buttonVersion = takePicBtn.classList.contains('fE2D5') ? 'new' : 'old';
						console.log('Take picture button found:', {
							version: buttonVersion,
							hasInnerDiv: hasInnerDiv,
							tagName: takePicBtn.tagName,
							classes: takePicBtn.className
						});


						console.log('Attempting to click take picture button...');

						// Before clicking, only nudge the video element to play. Do not mutate
						// Snapchat's canvas or shutter attributes; those can break camera capture.
						const video = document.querySelector('video');
						if (video && video.paused && typeof video.play === 'function') {
							console.log('Video is paused, attempting to play');
							video.play().catch(e => console.log('Could not play video:', e));
						}

						// Get inner button
						const innerButton = takePicBtn.querySelector('div[role="button"]');

						// Simple click without any waiting
						console.log('Clicking take picture button');

						if (innerButton) {
							await simulateClick(takePicBtn);
							await simulateClick(innerButton);
						} else {
							// Old version
							await simulateClick(takePicBtn);
						}

						// Approach 3: For older version without inner div, just ensure multiple click types
						if (!innerButton && takePicBtn.classList.contains('FBYjn')) {
							console.log('Detected older button version (FBYjn class), using standard clicks');
							takePicBtn.click();
							// Dispatch custom events that Snapchat might listen for
							const customClick = new CustomEvent('customclick', { bubbles: true });
							takePicBtn.dispatchEvent(customClick);
						}

						// Approach 3: Trigger touch events (mobile-first design)
						try {
							const rect = takePicBtn.getBoundingClientRect();
							const centerX = rect.left + rect.width / 2;
							const centerY = rect.top + rect.height / 2;

							const touchStart = new TouchEvent('touchstart', {
								bubbles: true,
								cancelable: true,
								view: window,
								touches: [new Touch({
									identifier: Date.now(),
									target: takePicBtn,
									clientX: centerX,
									clientY: centerY,
									radiusX: 2.5,
									radiusY: 2.5,
									rotationAngle: 0,
									force: 1.0
								})]
							});

							const touchEnd = new TouchEvent('touchend', {
								bubbles: true,
								cancelable: true,
								view: window,
								changedTouches: [new Touch({
									identifier: Date.now(),
									target: takePicBtn,
									clientX: centerX,
									clientY: centerY,
									radiusX: 2.5,
									radiusY: 2.5,
									rotationAngle: 0,
									force: 0
								})]
							});

							takePicBtn.dispatchEvent(touchStart);
							takePicBtn.dispatchEvent(touchEnd);
							console.log('Dispatched touch events');
						} catch (e) {
							console.log('Touch events not supported or failed:', e);
						}

						lastClickedElement = takePicBtn;
						lastClickTime = Date.now();
						console.log('Completed all click attempts on take picture button');
						setAutomationState('sendTo', 'picture_taken');

						// Remove debug listener immediately
						return;
					}
				}


				// Try send to button
				if (currentState === 'searching' || currentState === 'sendTo') {
					const sendToBtn = await findElementQuick('sendToButton');
					if (sendToBtn && !isSameElementClicked(sendToBtn)) {
						await simulateClick(sendToBtn);
						lastClickedElement = sendToBtn;
						lastClickTime = Date.now();
						console.log('Clicked Send To button');
						setAutomationState('selectRecipients', 'send_to_clicked');
						peopleClickIndex = 0;
						recipientSelectionAttempts = 0;
						recipientsPreparedForSend = false;
						selectedRecipientCount = 0;
						commitStartedAt = 0;
						ackStartedAt = 0;
						sendHardTimeoutStartedAt = 0;
						finalSendClickIssued = false;
						return;
					}
				}


				break;
		}

		// Dynamic state reconciliation: if expected markers are missing, classify and jump.
		if (['takePicture', 'sendTo', 'selectRecipients', 'commitFinalSend', 'awaitSendAck'].includes(currentState)) {
			const expectedMarkerPresent = await hasExpectedMarkerForState(currentState);
			if (!expectedMarkerPresent) {
				const resynced = await resyncStateFromClassifier(currentState, 'expected_marker_missing_post_pass');
				if (resynced) {
					return;
				}
			} else {
				stateFailCount = 0;
			}
		}

		// If we're in a specific state but couldn't find the element,
		// reset to searching state to try all elements again
		// This check is outside the switch to ensure it runs for all states
			if (
				currentState !== 'searching' &&
				currentState !== 'selectRecipients' &&
				currentState !== 'prepareFinalSend' &&
				currentState !== 'commitFinalSend' &&
				currentState !== 'awaitSendAck' &&
				currentState !== 'waitingForLoop'
			) {
				// Reset if stuck too long in a state
				if (Date.now() - stateStartTime > 5000) {
					console.log(`Stuck in state ${currentState} for too long (>5s), resetting to searching`);
						currentState = 'searching';
						currentStateId = 'searching';
						statePointer = 'searching';
						stateFailCount = 0;
						lastResyncAt = 0;
						strictSendCycle = null;
						lastClickedElement = null; // Clear last clicked to allow re-clicking
						peopleClickIndex = 0; // Reset people index
						recipientSelectionAttempts = 0;
						recipientsPreparedForSend = false;
						selectedRecipientCount = 0;
						commitStartedAt = 0;
						ackStartedAt = 0;
						sendHardTimeoutStartedAt = 0;
						finalSendClickIssued = false;
						sendButtonAttempts = 0; // Reset send button attempts
						stateStartTime = Date.now(); // Reset the timer
					}
				}

		// Log pass time occasionally
		const passTime = Date.now() - passStart;
		if (random() < 0.001) { // Log 0.1% of passes
			console.log(`Pass completed in ${passTime}ms, state: ${currentState}`);
		}
	}

	async function performActions() {
		// Run continuous loop with error handling
		while (actionInProgress) {
			// Check if stop was requested
			if (stopRequested) {
				// Check if we're truly at the home state using the same pattern recognition we use for automation
				let cameraFound = false;
				let takePicFound = false;

				// Try to find camera button using pattern recognition
				if (Boolean(smartFinder) && smartFinder) {
					try {
						const cameraResult = await smartFinder.findElement(elementConfigs.cameraButton.fingerprint, {
							fallbackSelectors: elementConfigs.cameraButton.fallbackSelectors,
							threshold: 0.7,
							useCache: true,
							maxCandidates: 50,
							timeout: 100
						});
						cameraFound = !!(cameraResult && cameraResult.element && cameraResult.confidence > 0.7);
					} catch (e) {
						console.log('Error finding camera button:', e);
						cameraFound = false;
					}
				}

				// Try to find take picture button using pattern recognition
				if (!cameraFound && Boolean(smartFinder) && smartFinder) {
					try {
						const takePicResult = await smartFinder.findElement(elementConfigs.takePictureButton.fingerprint, {
							fallbackSelectors: elementConfigs.takePictureButton.fallbackSelectors,
							threshold: 0.7,
							useCache: true,
							maxCandidates: 50,
							timeout: 100
						});
						takePicFound = !!(takePicResult && takePicResult.element && takePicResult.confidence > 0.7);
					} catch (e) {
						console.log('Error finding take picture button:', e);
						takePicFound = false;
					}
				}

				// Also try the direct selectors as a fallback
				if (!cameraFound && !takePicFound) {
					// Try the selectors that work during normal operation
					const takePicBtn = document.querySelector('button.fE2D5');
					if (takePicBtn && takePicBtn.offsetWidth > 0 && takePicBtn.offsetHeight > 0) {
						takePicFound = true;
					}
				}

				// IMPORTANT: Also check that we're NOT on the send-to screen
				// Check for elements that only appear on send-to/select people screens
				const sendToButton = document.querySelector('button.YatIx');
				const peopleList = document.querySelector('ul[role="list"] li.Ewflr') ||
								  document.querySelector('.L7aBq');
				const sendButton = document.querySelector('button[type="submit"].TYX6O');

				// Also check for the "send to" text
				let hasSendToText = false;
				const buttons = document.querySelectorAll('button span');
				for (const span of buttons) {
					if (span.textContent && span.textContent.toLowerCase().includes('send to')) {
						hasSendToText = true;
						break;
					}
				}

				const onSendScreens = !!(sendToButton || peopleList || sendButton || hasSendToText);

				// Special case: if we're in waitingForLoop and enough time has passed,
				// we should be back at home (the UI might just be slow to update)
				const inWaitingLoopLongEnough = currentState === 'waitingForLoop' &&
												(Date.now() - stateStartTime > 1000);

				if (((cameraFound || takePicFound) && !onSendScreens) ||
					(inWaitingLoopLongEnough && !onSendScreens)) {
					console.log('Stop requested and VERIFIED at home state, stopping now', {
						cameraFound,
						takePicFound,
						currentState,
						onSendScreens,
						inWaitingLoopLongEnough,
						timeInState: Date.now() - stateStartTime
					});
					// Call actuallyStopAutomation here to ensure cleanup
					stopRequested = false;
					actuallyStopAutomation();
					break;
				} else {
					console.log('Stop requested but NOT at home state yet, continuing...', {
						currentState,
						cameraFound,
						takePicFound,
						onSendScreens,
						inWaitingLoopLongEnough,
						timeInState: Date.now() - stateStartTime,
						hasElements: {
							sendToButton: !!sendToButton,
							peopleList: !!peopleList,
							sendButton: !!sendButton,
							hasSendToText
						}
					});
					// Continue running to complete the cycle
				}
			}

			// Run the automation pass
			await performSinglePass();

			// Use the user's configured loop delay
			const loopDelay = config.loopDelay;
			await robustDelay(loopDelay);

			// Yield to browser for UI updates periodically
			if (random() < 0.1) { // 10% of iterations
				await robustDelay(16);
			}
		}

		console.log('performActions loop ended');
	}

	// Pattern recognition cache management function
	function managePatternCache() {
		if (smartFinder) {
			// Log cache performance every 100 snaps
			if (snapsSent % 100 === 0) {
				const cacheSize = smartFinder.cache.size;
				console.log(`Pattern recognition cache size: ${cacheSize} elements`);
				console.log(`Total snaps sent: ${snapsSent}`);
			}

			// Clear cache if it gets too large
			if (smartFinder.cache.size > 50) {
				console.log('Clearing pattern recognition cache (size exceeded 50)');
				smartFinder.cleanCache();
			}
		}
	}


	loopPromise=performActions().catch(e=>lifecycle.error(e)).finally(()=>{actuallyStopAutomation();loopPromise=null;releaseCanvas();});
}

// End of startSendAutomation

function stopSendAutomation(){stop();}

function actuallyStopAutomation(){actionInProgress=false;stopRequested=false;if(errorHandlers){window.removeEventListener('error',errorHandlers.error);errorHandlers=null;}lifecycle.stop();}

    // Populate recipient state from caller configuration, without UI listeners.
    function addPerson(name){if(!normalizeRecipientLabel(name)||isDuplicateRecipient(People,name))return false;People.push(String(name).trim());return true;}

    function addShortcut(name){if(!normalizeRecipientLabel(name)||isDuplicateRecipient(Shortcuts,name))return false;Shortcuts.push(String(name).trim());return true;}






 function getState(){return {running:actionInProgress,state:currentState,snapsSent,recipientMode,userNames:[...People],shortcutNames:[...Shortcuts]};}
 function stop(){actuallyStopAutomation();releaseCanvas();return loopPromise||Promise.resolve();}
 function start(){if(loopPromise||actionInProgress)return loopPromise;if(!getActiveRecipients().length)throw Error('At least one recipient is required');lifecycle.begin();installCanvas();startSendAutomation();return loopPromise;}
 setRecipientMode(options.recipientMode);for(const n of options.recipients||[])(recipientMode==='shortcut'?addShortcut:addPerson)(n);
 return {start,stop,getState,dispose(){const p=stop();lifecycle.dispose();smartFinder.clearCache?.();return p;}};
}
