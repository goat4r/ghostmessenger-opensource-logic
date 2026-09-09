// Original V5 DOM fingerprints and matching strategies; per-instance cache.
export function createPatternFinder(document,options={}){
const window=document.defaultView;const {Element,HTMLElement,Node,XPathResult}=window;const getComputedStyle=window.getComputedStyle.bind(window);
const Date={now:options.now||(()=>globalThis.Date.now())};
const console={log(){},debug(){},warn(...args){options.onDiagnostic?.({level:'warning',message:args.map(String).join(' ')});},error(...args){options.onDiagnostic?.({level:'error',message:args.map(String).join(' ')});}};
class ElementFingerprinter {
  constructor() {
    this.fingerprintCache = new Map();
  }

  createElementFingerprint(element) {
    if (!element) return null;

    const fingerprint = {
      // High stability attributes
      textContent: this.normalizeText(element.textContent),
      innerText: this.normalizeText(element.innerText),
      ariaLabel: element.getAttribute('aria-label'),
      role: element.getAttribute('role'),
      ariaDescribedBy: element.getAttribute('aria-describedby'),
      title: element.getAttribute('title'),
      placeholder: element.getAttribute('placeholder'),
      alt: element.getAttribute('alt'),
      dataAttributes: this.getDataAttributes(element),
      name: element.getAttribute('name'),
      type: element.getAttribute('type'),

      // Medium stability attributes
      tagName: element.tagName.toLowerCase(),
      elementType: this.getElementType(element),
      parentTag: element.parentElement ? element.parentElement.tagName.toLowerCase() : null,
      siblingIndex: this.getSiblingIndex(element),
      childrenCount: element.children.length,
      isVisible: this.isElementVisible(element),

      // Low stability attributes (used as fallbacks)
      id: element.id,
      className: element.className,
      classList: Array.from(element.classList),

      // Structural context
      parentClasses: element.parentElement ? Array.from(element.parentElement.classList) : [],
      nearestButtonText: this.getNearestButtonText(element),
      nearestLabelText: this.getNearestLabelText(element),

      // Visual indicators
      hasIcon: this.hasIcon(element),
      iconType: this.getIconType(element),

      // Form-specific
      isSubmitButton: element.type === 'submit' || element.getAttribute('type') === 'submit',
      formId: element.form ? element.form.id : null,

      // Position in list
      listContext: this.getListContext(element),

      // Timestamp for cache validation
      timestamp: Date.now()
    };

    return fingerprint;
  }

  normalizeText(text) {
    if (!text) return '';
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  getDataAttributes(element) {
    const dataAttrs = {};
    for (let attr of element.attributes) {
      if (attr.name.startsWith('data-')) {
        dataAttrs[attr.name] = attr.value;
      }
    }
    return dataAttrs;
  }

  getElementType(element) {
    if (element.tagName === 'BUTTON') return 'button';
    if (element.tagName === 'A') return 'link';
    if (element.tagName === 'INPUT') return element.type || 'input';
    if (element.tagName === 'DIV' && element.getAttribute('role') === 'button') return 'div-button';
    if (element.tagName === 'SPAN' && element.parent && element.parent.tagName === 'BUTTON') return 'button-text';
    return element.tagName.toLowerCase();
  }

  getSiblingIndex(element) {
    if (!element.parentElement) return 0;
    const siblings = Array.from(element.parentElement.children);
    return siblings.indexOf(element);
  }

  isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  getNearestButtonText(element, maxLevels = 3) {
    let current = element;
    let level = 0;

    while (current && level < maxLevels) {
      const buttons = current.querySelectorAll('button');
      if (buttons.length > 0) {
        return this.normalizeText(buttons[0].textContent);
      }
      current = current.parentElement;
      level++;
    }

    return null;
  }

  getNearestLabelText(element, maxLevels = 3) {
    // Check for associated label
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return this.normalizeText(label.textContent);
    }

    // Check parent labels
    let current = element;
    let level = 0;

    while (current && level < maxLevels) {
      if (current.tagName === 'LABEL') {
        return this.normalizeText(current.textContent);
      }

      const labels = current.querySelectorAll('label');
      if (labels.length > 0) {
        return this.normalizeText(labels[0].textContent);
      }

      current = current.parentElement;
      level++;
    }

    return null;
  }

  hasIcon(element) {
    return element.querySelector('svg') !== null ||
           element.querySelector('img') !== null ||
           element.querySelector('i') !== null;
  }

  getIconType(element) {
    if (element.querySelector('svg')) return 'svg';
    if (element.querySelector('img')) return 'img';
    if (element.querySelector('i')) return 'icon-font';
    return null;
  }

  getListContext(element) {
    const listItem = element.closest('li');
    if (!listItem) return null;

    const list = listItem.parentElement;
    if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) return null;

    const items = Array.from(list.children);
    const index = items.indexOf(listItem);

    return {
      listTag: list.tagName.toLowerCase(),
      itemIndex: index,
      totalItems: items.length,
      listClasses: Array.from(list.classList),
      isFirst: index === 0,
      isLast: index === items.length - 1
    };
  }

  compareFingerprints(fp1, fp2) {
    if (!fp1 || !fp2) return 0;

    const weights = {
      textContent: 0.25,
      innerText: 0.15,
      ariaLabel: 0.15,
      role: 0.10,
      tagName: 0.08,
      elementType: 0.07,
      title: 0.05,
      dataAttributes: 0.05,
      classList: 0.03,
      parentClasses: 0.03,
      nearestButtonText: 0.02,
      nearestLabelText: 0.02
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(weights)) {
      let score = 0;

      if (key === 'textContent' || key === 'innerText') {
        score = this.textSimilarity(fp1[key], fp2[key]);
      } else if (key === 'classList' || key === 'parentClasses') {
        score = this.arraySimilarity(fp1[key], fp2[key]);
      } else if (key === 'dataAttributes') {
        score = this.objectSimilarity(fp1[key], fp2[key]);
      } else {
        score = fp1[key] === fp2[key] ? 1 : 0;
      }

      totalScore += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  textSimilarity(text1, text2) {
    if (!text1 && !text2) return 1;
    if (!text1 || !text2) return 0;

    const normalized1 = this.normalizeText(text1);
    const normalized2 = this.normalizeText(text2);

    if (normalized1 === normalized2) return 1;

    // Check if one contains the other
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      return 0.8;
    }

    // Levenshtein distance
    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    return maxLength > 0 ? 1 - (distance / maxLength) : 0;
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  arraySimilarity(arr1, arr2) {
    if (!arr1 && !arr2) return 1;
    if (!arr1 || !arr2) return 0;
    if (arr1.length === 0 && arr2.length === 0) return 1;
    if (arr1.length === 0 || arr2.length === 0) return 0;

    const set1 = new Set(arr1);
    const set2 = new Set(arr2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  objectSimilarity(obj1, obj2) {
    if (!obj1 && !obj2) return 1;
    if (!obj1 || !obj2) return 0;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length === 0 && keys2.length === 0) return 1;
    if (keys1.length === 0 || keys2.length === 0) return 0;

    let matches = 0;
    const allKeys = new Set([...keys1, ...keys2]);

    for (const key of allKeys) {
      if (obj1[key] === obj2[key]) {
        matches++;
      }
    }

    return matches / allKeys.size;
  }
}
class SimilarityCalculator {
  constructor() {
    this.weights = {
      textContent: 0.40,
      structure: 0.30,
      semantic: 0.20,
      other: 0.10
    };
  }

  calculateSimilarity(element, fingerprint, options = {}) {
    if (!element || !fingerprint) return 0;

    const elementFingerprint = new ElementFingerprinter().createElementFingerprint(element);
    if (!elementFingerprint) return 0;

    const scores = {
      text: this.calculateTextSimilarity(elementFingerprint, fingerprint),
      structure: this.calculateStructuralSimilarity(elementFingerprint, fingerprint),
      semantic: this.calculateSemanticSimilarity(elementFingerprint, fingerprint),
      other: this.calculateOtherSimilarity(elementFingerprint, fingerprint)
    };

    // Apply custom weights if provided
    const weights = { ...this.weights, ...options.weights };

    const weightedScore =
      scores.text * weights.textContent +
      scores.structure * weights.structure +
      scores.semantic * weights.semantic +
      scores.other * weights.other;

    // Apply threshold if specified
    const threshold = options.threshold || 0.7;

    return {
      score: weightedScore,
      meets_threshold: weightedScore >= threshold,
      breakdown: scores,
      confidence: this.calculateConfidence(scores, weightedScore)
    };
  }

  calculateTextSimilarity(fp1, fp2) {
    const textFields = ['textContent', 'innerText', 'title', 'placeholder', 'alt'];
    let totalScore = 0;
    let validFields = 0;

    for (const field of textFields) {
      if (fp1[field] || fp2[field]) {
        validFields++;
        totalScore += this.fuzzyTextMatch(fp1[field], fp2[field]);
      }
    }

    // Check nearest text contexts
    if (fp1.nearestButtonText || fp2.nearestButtonText) {
      validFields++;
      totalScore += this.fuzzyTextMatch(fp1.nearestButtonText, fp2.nearestButtonText) * 0.5;
    }

    if (fp1.nearestLabelText || fp2.nearestLabelText) {
      validFields++;
      totalScore += this.fuzzyTextMatch(fp1.nearestLabelText, fp2.nearestLabelText) * 0.5;
    }

    return validFields > 0 ? totalScore / validFields : 0;
  }

  calculateStructuralSimilarity(fp1, fp2) {
    const scores = [];

    // Tag name match
    scores.push(fp1.tagName === fp2.tagName ? 1 : 0);

    // Element type match
    scores.push(fp1.elementType === fp2.elementType ? 1 : 0);

    // Parent tag match
    scores.push(fp1.parentTag === fp2.parentTag ? 0.8 : 0);

    // Position similarity
    if (fp1.siblingIndex !== null && fp2.siblingIndex !== null) {
      const indexDiff = Math.abs(fp1.siblingIndex - fp2.siblingIndex);
      scores.push(indexDiff === 0 ? 1 : indexDiff === 1 ? 0.5 : 0);
    }

    // List context similarity
    if (fp1.listContext && fp2.listContext) {
      scores.push(this.compareListContext(fp1.listContext, fp2.listContext));
    }

    // Class similarity
    const classSimilarity = this.calculateArraySimilarity(fp1.classList, fp2.classList);
    scores.push(classSimilarity);

    // Parent class similarity (less weight)
    const parentClassSimilarity = this.calculateArraySimilarity(fp1.parentClasses, fp2.parentClasses);
    scores.push(parentClassSimilarity * 0.5);

    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  calculateSemanticSimilarity(fp1, fp2) {
    const scores = [];

    // ARIA attributes
    if (fp1.ariaLabel || fp2.ariaLabel) {
      scores.push(this.fuzzyTextMatch(fp1.ariaLabel, fp2.ariaLabel));
    }

    if (fp1.role === fp2.role && fp1.role) {
      scores.push(1);
    } else if (fp1.role || fp2.role) {
      scores.push(0);
    }

    // Form-specific attributes
    if (fp1.type === fp2.type && fp1.type) {
      scores.push(1);
    }

    if (fp1.name === fp2.name && fp1.name) {
      scores.push(1);
    }

    // Submit button check
    if (fp1.isSubmitButton === fp2.isSubmitButton) {
      scores.push(1);
    }

    // Data attributes similarity
    const dataAttrScore = this.compareDataAttributes(fp1.dataAttributes, fp2.dataAttributes);
    if (dataAttrScore !== null) {
      scores.push(dataAttrScore);
    }

    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.5;
  }

  calculateOtherSimilarity(fp1, fp2) {
    const scores = [];

    // Visibility
    if (fp1.isVisible === fp2.isVisible) {
      scores.push(1);
    }

    // Has icon
    if (fp1.hasIcon === fp2.hasIcon) {
      scores.push(0.8);

      if (fp1.hasIcon && fp1.iconType === fp2.iconType) {
        scores.push(1);
      }
    }

    // ID match (low weight as IDs change)
    if (fp1.id && fp2.id && fp1.id === fp2.id) {
      scores.push(1);
    }

    // Children count similarity
    if (fp1.childrenCount !== undefined && fp2.childrenCount !== undefined) {
      const diff = Math.abs(fp1.childrenCount - fp2.childrenCount);
      scores.push(diff === 0 ? 1 : diff === 1 ? 0.5 : 0);
    }

    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.5;
  }

  fuzzyTextMatch(text1, text2) {
    if (!text1 && !text2) return 1;
    if (!text1 || !text2) return 0;

    const normalized1 = this.normalizeText(text1);
    const normalized2 = this.normalizeText(text2);

    if (normalized1 === normalized2) return 1;

    // Check contains
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      const ratio = Math.min(normalized1.length, normalized2.length) / Math.max(normalized1.length, normalized2.length);
      return 0.5 + (ratio * 0.5);
    }

    // Levenshtein distance
    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    const similarity = 1 - (distance / maxLength);

    // Token-based similarity
    const tokens1 = normalized1.split(' ');
    const tokens2 = normalized2.split(' ');
    const tokenSimilarity = this.calculateArraySimilarity(tokens1, tokens2);

    // Return weighted average
    return similarity * 0.7 + tokenSimilarity * 0.3;
  }

  normalizeText(text) {
    if (!text) return '';
    return text.toString().trim().toLowerCase().replace(/\s+/g, ' ');
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  calculateArraySimilarity(arr1, arr2) {
    if (!arr1 && !arr2) return 1;
    if (!arr1 || !arr2) return 0;
    if (arr1.length === 0 && arr2.length === 0) return 1;
    if (arr1.length === 0 || arr2.length === 0) return 0.2;

    const set1 = new Set(arr1);
    const set2 = new Set(arr2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  compareListContext(context1, context2) {
    if (!context1 || !context2) return 0;

    let score = 0;
    let factors = 0;

    // Same list type
    if (context1.listTag === context2.listTag) {
      score += 1;
      factors++;
    }

    // Position similarity
    if (context1.isFirst === context2.isFirst) {
      score += 1;
      factors++;
    }

    if (context1.isLast === context2.isLast) {
      score += 1;
      factors++;
    }

    // Relative position
    if (context1.totalItems > 0 && context2.totalItems > 0) {
      const relPos1 = context1.itemIndex / context1.totalItems;
      const relPos2 = context2.itemIndex / context2.totalItems;
      const posDiff = Math.abs(relPos1 - relPos2);
      score += 1 - posDiff;
      factors++;
    }

    return factors > 0 ? score / factors : 0;
  }

  compareDataAttributes(data1, data2) {
    if (!data1 && !data2) return null;
    if (!data1 || !data2) return 0;

    const keys1 = Object.keys(data1);
    const keys2 = Object.keys(data2);

    if (keys1.length === 0 && keys2.length === 0) return null;
    if (keys1.length === 0 || keys2.length === 0) return 0;

    let matches = 0;
    let total = 0;

    // Check matching keys and values
    const allKeys = new Set([...keys1, ...keys2]);
    for (const key of allKeys) {
      total++;
      if (data1[key] === data2[key] && data1[key] !== undefined) {
        matches++;
      } else if (data1[key] && data2[key]) {
        // Partial credit for same key, different value
        matches += 0.3;
      }
    }

    return total > 0 ? matches / total : 0;
  }

  calculateConfidence(scores, weightedScore) {
    // Confidence based on consistency of scores
    const values = Object.values(scores);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Lower variance = higher confidence
    const consistencyScore = 1 - Math.min(stdDev, 1);

    // Overall confidence
    return {
      level: weightedScore >= 0.9 ? 'high' : weightedScore >= 0.7 ? 'medium' : 'low',
      score: (weightedScore + consistencyScore) / 2,
      consistency: consistencyScore
    };
  }
}
class SmartElementFinder {
  constructor() {
    this.fingerprinter = new ElementFingerprinter();
    this.similarityCalculator = new SimilarityCalculator();
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.searchStrategies = [
      'cached',
      'exactMatch',
      'textBased',
      'ariaBased',
      'structuralBased',
      'fuzzyMatch'
    ];
  }

  async findElement(targetFingerprint, options = {}) {
    const {
      fallbackSelectors = [],
      threshold = 0.7,
      useCache = true,
      maxCandidates = 50,
      timeout = 5000
    } = options;

    const startTime = Date.now();

    // Phase 1: Check cache
    if (useCache) {
      const cachedResult = this.getCachedElement(targetFingerprint);
      if (cachedResult && this.validateCachedElement(cachedResult.element, targetFingerprint)) {
        return {
          element: cachedResult.element,
          confidence: 1.0,
          method: 'cached',
          timeMs: Date.now() - startTime
        };
      }
    }

    // Phase 2: Try fallback selectors
    for (const selector of fallbackSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const similarity = this.similarityCalculator.calculateSimilarity(element, targetFingerprint, { threshold });
          if (similarity.meets_threshold) {
            if (useCache) {
              this.cacheElement(targetFingerprint, element, selector);
            }
            return {
              element,
              confidence: similarity.score,
              method: 'fallback',
              selector,
              timeMs: Date.now() - startTime
            };
          }
        }
      } catch (e) {
        console.warn('Invalid fallback selector:', selector, e);
      }
    }

    // Phase 3: Pattern matching with multiple strategies
    let candidates = [];

    for (const strategy of this.searchStrategies) {
      if (Date.now() - startTime > timeout) {
        console.warn('Element search timeout exceeded');
        break;
      }

      const strategyCandidates = this.findCandidatesByStrategy(strategy, targetFingerprint, maxCandidates);
      candidates = this.mergeCandidates(candidates, strategyCandidates);

      // Early exit if we find a high-confidence match
      const highConfidenceMatch = candidates.find(c => c.similarity.score >= 0.9);
      if (highConfidenceMatch) {
        if (useCache) {
          this.cacheElement(targetFingerprint, highConfidenceMatch.element);
        }
        return {
          element: highConfidenceMatch.element,
          confidence: highConfidenceMatch.similarity.score,
          method: `pattern-${strategy}`,
          timeMs: Date.now() - startTime
        };
      }
    }

    // Phase 4: Select best candidate
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.similarity.score - a.similarity.score);
      const best = candidates[0];

      if (best.similarity.meets_threshold) {
        if (useCache) {
          this.cacheElement(targetFingerprint, best.element);
        }
        return {
          element: best.element,
          confidence: best.similarity.score,
          method: 'pattern-best',
          breakdown: best.similarity.breakdown,
          timeMs: Date.now() - startTime
        };
      }
    }

    // No suitable match found
    return {
      element: null,
      confidence: 0,
      method: 'none',
      timeMs: Date.now() - startTime,
      candidatesEvaluated: candidates.length
    };
  }

  findCandidatesByStrategy(strategy, targetFingerprint, maxCandidates) {
    const candidates = [];

    switch (strategy) {
      case 'textBased':
        if (targetFingerprint.textContent) {
          candidates.push(...this.findByText(targetFingerprint.textContent, targetFingerprint.tagName));
        }
        if (targetFingerprint.ariaLabel) {
          candidates.push(...this.findByAriaLabel(targetFingerprint.ariaLabel));
        }
        break;

      case 'ariaBased':
        if (targetFingerprint.role) {
          candidates.push(...this.findByRole(targetFingerprint.role, targetFingerprint.tagName));
        }
        if (targetFingerprint.ariaDescribedBy) {
          candidates.push(...this.findByAriaDescribedBy(targetFingerprint.ariaDescribedBy));
        }
        break;

      case 'structuralBased':
        candidates.push(...this.findByStructure(targetFingerprint));
        break;

      case 'exactMatch':
        candidates.push(...this.findByExactAttributes(targetFingerprint));
        break;

      case 'fuzzyMatch':
        candidates.push(...this.findByFuzzyMatch(targetFingerprint, maxCandidates));
        break;
    }

    // Calculate similarity for all candidates
    return candidates
      .slice(0, maxCandidates)
      .map(element => ({
        element,
        similarity: this.similarityCalculator.calculateSimilarity(element, targetFingerprint)
      }))
      .filter(candidate => candidate.similarity.score > 0.3); // Filter out very low scores
  }

  findByText(text, preferredTag = null) {
    const normalizedText = this.fingerprinter.normalizeText(text);
    const candidates = [];

    // XPath for exact text match
    const xpathExact = `//*[normalize-space(text())='${normalizedText}']`;
    candidates.push(...this.evaluateXPath(xpathExact));

    // XPath for contains text
    const xpathContains = `//*[contains(normalize-space(text()), '${normalizedText}')]`;
    candidates.push(...this.evaluateXPath(xpathContains));

    // CSS selectors for common text containers
    const textSelectors = [
      'button', 'a', 'label', 'span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'
    ];

    for (const selector of textSelectors) {
      if (!preferredTag || selector === preferredTag) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const elementText = this.fingerprinter.normalizeText(element.textContent);
          if (elementText.includes(normalizedText) || normalizedText.includes(elementText)) {
            candidates.push(element);
          }
        }
      }
    }

    return [...new Set(candidates)]; // Remove duplicates
  }

  findByAriaLabel(ariaLabel) {
    return Array.from(document.querySelectorAll(`[aria-label="${ariaLabel}"]`));
  }

  findByRole(role, preferredTag = null) {
    const elements = document.querySelectorAll(`[role="${role}"]`);
    if (!preferredTag) {
      return Array.from(elements);
    }
    return Array.from(elements).filter(el => el.tagName.toLowerCase() === preferredTag);
  }

  findByAriaDescribedBy(ariaDescribedBy) {
    return Array.from(document.querySelectorAll(`[aria-describedby="${ariaDescribedBy}"]`));
  }

  findByStructure(fingerprint) {
    const candidates = [];

    // Find by tag and parent tag
    if (fingerprint.tagName && fingerprint.parentTag) {
      const selector = `${fingerprint.parentTag} > ${fingerprint.tagName}`;
      candidates.push(...document.querySelectorAll(selector));
    }

    // Find by tag and classes
    if (fingerprint.tagName && fingerprint.classList && fingerprint.classList.length > 0) {
      const classSelector = fingerprint.classList.map(c => `.${c}`).join('');
      const selector = `${fingerprint.tagName}${classSelector}`;
      try {
        candidates.push(...document.querySelectorAll(selector));
      } catch (e) {
        // Invalid class names
      }
    }

    // Find elements in similar list context
    if (fingerprint.listContext) {
      const lists = document.querySelectorAll(fingerprint.listContext.listTag);
      for (const list of lists) {
        if (fingerprint.listContext.isFirst) {
          const firstItem = list.firstElementChild;
          if (firstItem) {
            candidates.push(...firstItem.querySelectorAll(fingerprint.tagName));
          }
        } else if (fingerprint.listContext.isLast) {
          const lastItem = list.lastElementChild;
          if (lastItem) {
            candidates.push(...lastItem.querySelectorAll(fingerprint.tagName));
          }
        }
      }
    }

    return [...new Set(candidates)];
  }

  findByExactAttributes(fingerprint) {
    const candidates = [];

    // Build attribute selectors
    const attributeSelectors = [];

    if (fingerprint.id) {
      attributeSelectors.push(`#${CSS.escape(fingerprint.id)}`);
    }

    if (fingerprint.name) {
      attributeSelectors.push(`[name="${fingerprint.name}"]`);
    }

    if (fingerprint.type) {
      attributeSelectors.push(`[type="${fingerprint.type}"]`);
    }

    if (fingerprint.title) {
      attributeSelectors.push(`[title="${fingerprint.title}"]`);
    }

    if (fingerprint.placeholder) {
      attributeSelectors.push(`[placeholder="${fingerprint.placeholder}"]`);
    }

    // Try each selector
    for (const selector of attributeSelectors) {
      try {
        candidates.push(...document.querySelectorAll(selector));
      } catch (e) {
        console.warn('Invalid attribute selector:', selector);
      }
    }

    // Data attributes
    if (fingerprint.dataAttributes) {
      for (const [key, value] of Object.entries(fingerprint.dataAttributes)) {
        try {
          candidates.push(...document.querySelectorAll(`[${key}="${value}"]`));
        } catch (e) {
          console.warn('Invalid data attribute selector:', key, value);
        }
      }
    }

    return [...new Set(candidates)];
  }

  findByFuzzyMatch(fingerprint, maxCandidates) {
    const candidates = [];
    const tagName = fingerprint.tagName || '*';

    // Get elements of the same type
    const elements = document.querySelectorAll(tagName);
    const scoredElements = [];

    for (const element of elements) {
      const similarity = this.similarityCalculator.calculateSimilarity(element, fingerprint);
      if (similarity.score > 0.3) {
        scoredElements.push({ element, score: similarity.score });
      }
    }

    // Sort by score and take top candidates
    scoredElements.sort((a, b) => b.score - a.score);
    return scoredElements.slice(0, maxCandidates).map(item => item.element);
  }

  evaluateXPath(xpath) {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      const elements = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        elements.push(result.snapshotItem(i));
      }
      return elements;
    } catch (e) {
      console.warn('XPath evaluation failed:', xpath, e);
      return [];
    }
  }

  mergeCandidates(existing, newCandidates) {
    const elementSet = new Set(existing.map(c => c.element));
    const merged = [...existing];

    for (const candidate of newCandidates) {
      if (!elementSet.has(candidate.element)) {
        merged.push(candidate);
        elementSet.add(candidate.element);
      }
    }

    return merged;
  }

  getCachedElement(fingerprint) {
    const cacheKey = this.generateCacheKey(fingerprint);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached;
    }

    // Remove expired cache entry
    if (cached) {
      this.cache.delete(cacheKey);
    }

    return null;
  }

  validateCachedElement(element, fingerprint) {
    // Check if element is still in DOM
    if (!document.contains(element)) {
      return false;
    }

    // Quick validation - check key attributes
    const currentFingerprint = this.fingerprinter.createElementFingerprint(element);

    // Text content should match
    if (fingerprint.textContent && currentFingerprint.textContent !== fingerprint.textContent) {
      return false;
    }

    // Role should match
    if (fingerprint.role && currentFingerprint.role !== fingerprint.role) {
      return false;
    }

    // Tag should match
    if (currentFingerprint.tagName !== fingerprint.tagName) {
      return false;
    }

    return true;
  }

  cacheElement(fingerprint, element, selector = null) {
    const cacheKey = this.generateCacheKey(fingerprint);
    this.cache.set(cacheKey, {
      element,
      selector,
      fingerprint,
      timestamp: Date.now()
    });

    // Clean old cache entries
    this.cleanCache();
  }

  generateCacheKey(fingerprint) {
    // Use stable attributes for cache key
    const keyParts = [
      fingerprint.textContent,
      fingerprint.ariaLabel,
      fingerprint.role,
      fingerprint.tagName,
      fingerprint.name
    ].filter(Boolean);

    return keyParts.join('|');
  }

  cleanCache() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  clearCache() {
    this.cache.clear();
  }

  generateStableSelector(element) {
    // Try to generate a stable selector for the element
    const selectors = [];

    // ID selector (if stable)
    if (element.id && this.isStableIdentifier(element.id)) {
      selectors.push(`#${CSS.escape(element.id)}`);
    }

    // Aria-label selector
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      selectors.push(`[aria-label="${ariaLabel}"]`);
    }

    // Role + tag selector
    const role = element.getAttribute('role');
    if (role) {
      selectors.push(`${element.tagName.toLowerCase()}[role="${role}"]`);
    }

    // Data attribute selectors
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-') && this.isStableIdentifier(attr.value)) {
        selectors.push(`[${attr.name}="${attr.value}"]`);
      }
    }

    // Return the most specific selector that uniquely identifies the element
    for (const selector of selectors) {
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1 && matches[0] === element) {
          return selector;
        }
      } catch (e) {
        // Invalid selector
      }
    }

    return null;
  }

  isStableIdentifier(value) {
    if (!value) return false;

    // Check if it looks like a generated ID (contains random numbers/hashes)
    const unstablePatterns = [
      /\d{10,}/, // Long numbers
      /[a-f0-9]{8,}/i, // Hex strings
      /uuid/i,
      /temp/i,
      /random/i,
      /-\d+$/ // Ends with numbers
    ];

    for (const pattern of unstablePatterns) {
      if (pattern.test(value)) {
        return false;
      }
    }

    return true;
  }
}
// Element fingerprints for Snapchat web interface
const ELEMENT_FINGERPRINTS = {
  // Element 1: Camera button to open snap creation
  cameraButton: {
    fingerprint: {
      tagName: 'button',
      elementType: 'button',
      parentTag: 'div',
      classList: ['qJKfS'],
      parentClasses: ['Jq_5_'],
      textContent: '',
      innerText: '',
      ariaLabel: null,
      role: null,
      hasIcon: true,
      iconType: 'svg',
      childrenCount: 2,
      isVisible: true,
      nearestLabelText: 'click the camera to send snaps',
      title: null,
      type: 'button'
    },
    fallbackSelectors: [
      'button.qJKfS',
      '.Jq_5_ > button:has(svg)',
      'button:has(svg[viewBox="0 0 121 120"])',
      'div.BN1L1 button:first-child'
    ],
    description: 'Camera button to initiate snap sending'
  },

  // Element 2: Take picture button (first button in the camera interface)
  takePictureButton: {
    fingerprint: {
      tagName: 'button',
      elementType: 'button',
      parentTag: 'div',
      classList: ['fE2D5', 'FBYjn'], // Support both class variations
      parentClasses: ['VLm6Y', 'i0KT7'], // Support both parent variations
      textContent: '',
      innerText: '',
      ariaLabel: null,
      role: null,
      hasIcon: false,
      title: null,
      type: 'button',
      siblingIndex: 0,
      isVisible: true,
      // Has a child div with role="button" (newer version)
      hasChildWithRole: 'button',
      childAriaDisabled: 'true',
      childAriaRoledescription: 'draggable',
      // Additional attributes for better matching
      childrenCount: 1, // Usually has one child div
      isFirstChild: true // Usually the first button in the container
    },
    fallbackSelectors: [
      // New version selectors (with inner div)
      'button.fE2D5',
      '.VLm6Y > button.fE2D5',
      'div.VLm6Y button[type="button"]:first-child',
      'button:has(div[role="button"][aria-roledescription="draggable"])',
      'button.fE2D5:has(div[aria-disabled])',
      '.VLm6Y button:has(div[tabindex="0"])',
      // Old version selectors
      'button.FBYjn.gK0xL.W5dIq',
      'button.FBYjn.gK0xL.A7Cr_.m3ODJ',
      '.i0KT7 > button:first-child',
      // Generic selectors for both
      'button[type="button"]:has(div[role="button"])',
      'div[class*="VLm6Y"] button:first-of-type',
      'div[class*="i0KT7"] button:first-of-type'
    ],
    description: 'Take picture/snap button'
  },

  // Element 3: Send To button
  sendToButton: {
    fingerprint: {
      tagName: 'button',
      elementType: 'button',
      parentTag: 'div',
      classList: ['YatIx', 'fGS78', 'eKaL7', 'Bnaur'],
      parentClasses: ['_C4ta', 'FHYMJ'],
      textContent: 'send to',
      innerText: 'send to',
      ariaLabel: null,
      role: null,
      hasIcon: true,
      iconType: 'svg',
      type: 'button',
      isVisible: true,
      childrenCount: 2, // span and svg
      nearestButtonText: 'download'
    },
    fallbackSelectors: [
      'button.YatIx.fGS78.eKaL7.Bnaur',
      'button.YatIx.q5eEJ.eKaL7.Bnaur',
      'button.YatIx.bkJA0.eKaL7.Bnaur'
    ],
    description: 'Send To button to open recipient selection'
  },

  // Element 4: Friend/recipient selection
  friendSelector: {
    // This is a template for finding friends in the list
    fingerprint: {
      tagName: 'div',
      elementType: 'div',
      parentTag: 'li',
      classList: ['L7aBq'],
      parentClasses: ['Ewflr'],
      hasIcon: true,
      iconType: 'svg',
      role: null,
      isVisible: true,
      // The actual friend name will be in a sibling element
      nearestLabelText: null // Will be populated dynamically
    },
    fallbackSelectors: [
      '.L7aBq',
      'li.Ewflr .L7aBq',
      'div.L7aBq:has(svg)'
    ],
    // Special handling for friend selection
    friendNameSelector: '.RBx9s.nonIntl',
    groupNameSelector: '.mYSR9.nonIntl',
    groupClickSelector: '.JwhOC',
    description: 'Friend/recipient selection clickable area'
  },

  // Element 4B: Shortcut selector button (emoji or text labels)
  shortcutSelector: {
    fingerprint: {
      tagName: 'button',
      elementType: 'button',
      parentTag: 'div',
      classList: ['c47Sk'],
      parentClasses: ['THeKv'],
      textContent: null,
      innerText: null,
      ariaLabel: null,
      role: null,
      type: 'button',
      isVisible: true
    },
    fallbackSelectors: [
      'div.THeKv > button.c47Sk',
      'button.c47Sk'
    ],
    description: 'Shortcut selection button'
  },

  // Element 4C: Shortcut "Select" confirmation button
  shortcutSelectButton: {
    fingerprint: {
      tagName: 'button',
      elementType: 'button',
      classList: ['Y7u8A'],
      textContent: 'select',
      innerText: 'select',
      type: 'button',
      isVisible: true
    },
    fallbackSelectors: [
      'button.Y7u8A',
      'button.Y7u8A span.nonIntl',
      'button:has(span.nonIntl)'
    ],
    description: 'Select button used after clicking a shortcut'
  },

  // Element 5: Final send button
  sendButton: {
    fingerprint: {
      tagName: 'button',
      elementType: 'button',
      parentTag: 'div',
      classList: ['TYX6O', 'eKaL7', 'Bnaur'],
      parentClasses: ['OzZgU'],
      textContent: 'send',
      innerText: 'send',
      ariaLabel: null,
      role: null,
      hasIcon: true,
      iconType: 'svg',
      type: 'submit',
      isSubmitButton: true,
      isVisible: true,
      childrenCount: 1, // div with content
      nearestLabelText: null
    },
    fallbackSelectors: [
      'button.TYX6O.eKaL7.Bnaur[type="submit"]',
      '.OzZgU button[type="submit"]',
      'button[type="submit"]:has(.s53_U)',
      'button.TYX6O.eKaL7.Bnaur',
      '.s53_U' // Old selector - targets inner div
    ],
    description: 'Final send button to send the snap'
  }
};

// Helper function to get fingerprint by element name
function getElementFingerprint(elementName) {
  return ELEMENT_FINGERPRINTS[elementName];
}

// Helper function to get all element names
function getAllElementNames() {
  return Object.keys(ELEMENT_FINGERPRINTS);
}

// Helper function to find friend element by name
function createFriendFingerprint(friendName) {
  const baseFingerprint = { ...ELEMENT_FINGERPRINTS.friendSelector.fingerprint };
  baseFingerprint.nearestLabelText = friendName.toLowerCase();
  return baseFingerprint;
}

// Helper function to find group element by name
function createGroupFingerprint(groupName) {
  const baseFingerprint = { ...ELEMENT_FINGERPRINTS.friendSelector.fingerprint };
  baseFingerprint.nearestLabelText = groupName.toLowerCase();
  baseFingerprint.classList = ['JwhOC']; // Group selector class
  return baseFingerprint;
}

return {finder:new SmartElementFinder(),configs:ELEMENT_FINGERPRINTS};
}
