    // --- Predefined Templates ---
    const templates = {
      ecom: `title: Checkout funnel Flow
# Declare personas for roles-based view filtering
persona: Customer
persona: Admin

# Reusable Components Master Library
element: Promo Code {id: discount_code, status: warning, flags: [reusable], comment: "Applies coupon discounts"}
element: Apply Discount {id: apply_code}
element: Proceed to Pay {id: pay_btn_primary, flags: [primary], href: payment_details_group}

page: Checkout Funnel {status: success, id: start_checkout_page}
  group: Step 1: Shopping Cart
    input: {id: discount_code}
    button: {id: apply_code}
    button: {id: pay_btn_primary}
  group: Step 2: Payment Details {id: payment_details_group}
    input: Credit Card Number {id: card_num, personas: [Customer, Admin], comment: "Accepts Visa, Mastercard, Amex"}
    calendar: Expiry Date {id: card_expiry, personas: [Customer]}
    input: {id: discount_code, flags: [optional], comment: "Double-check before applying coupon"}
    button: {id: apply_code}
    button: Submit Payment {id: pay_btn_submit, status: success, flags: [secure, primary], href: receipt_page}
  group: Step 3: Success Confirmation
    page: Receipt Screen {id: receipt_page}
      button: Print Invoice {id: print_invoice, status: info}
      button: Print Discount Coupon {id: print_discount, status: draft, href: start_checkout_page}
      button: Refund Transaction {id: refund_btn, status: danger, personas: [Admin], comment: "System Admins only"}`,

      saas: `title: SaaS Dashboard Map
persona: Moderator
persona: Member

# Sidebar navigation reference template
element: Dashboard Home {id: link_dash}
element: Settings Screen {id: link_settings}
element: Workspace Title {id: ws_name, flags: [required]}

page: User Admin Portal
  group: Nav Sidebar
    button: {id: link_dash}
    button: {id: link_settings, href: settings_panel_group}
    button: Quick Search {id: global_search, status: info, comment: "Global cross-index finder"}
  group: Dashboard View
    group: Main Control Panel
      button: Open Search Panel {id: global_search, flags: [popup]}
      input: {id: ws_name}
    group: Settings Panel {status: warning, id: settings_panel_group}
      input: {id: ws_name, flags: [disabled], comment: "Modifiable inside root billing portal only"}
      button: Save Configuration {id: save_all_configs, status: success, personas: [Moderator]}
      button: Return Home {id: link_dash}`,

      simple: `title: Standard Registration
persona: Applicant
persona: Reviewer

element: Master Input {id: user_input, flags: [required], comment: "Master profile input template"}

page: Home Screen
  group: Form Section
    input: {id: user_input, personas: [Applicant]}
    input: User Profile Name {id: user_input, comment: "Must match passport spelling"}
    button: Submit {status: success, personas: [Applicant]}
    button: Accept Profile {status: success, personas: [Reviewer]}
    button: Reject Profile {status: error, personas: [Reviewer]}`,

      conditional: `title: Conditional Access Journey
persona: Member
persona: Admin

page: Sign In
  input: Email Address
  button: Submit Credentials {action: "start authentication"}
  decision: Credentials valid?
    page: Workspace Home {condition: "yes"}
      selector: Available modules
        page: Reports {condition: "analytics enabled"}
        page: Billing {condition: "billing access"}
    branch: Recovery route {condition: "no"}
      page: Reset Password {condition: "known email"}
      continue: Contact Support {condition: "account locked"}
  concurrent: Notify & redirect
    file: Audit Log {action: "write security event"}
    reference: MFA Flow {id: mfa_reference, href: mfa_flow, action: "challenge required"}

flow: MFA Flow {id: mfa_flow}
  entry: One-time code
  decision: Code accepted?
    exit: Resume sign in {condition: "verified"}
    page: Retry MFA {condition: "failed"}`,
      selectorcluster: `title: Selector & Cluster (VisVocab)

page: Account plan
  branch: Choose tier
    page: Free tier {condition: "free"}
    cluster: Premium bundle {condition: "premium"}
      page: Advanced Dashboard
      page: Priority Support
      page: Custom Reports

page: Search
  selector: Search results
    page: Products {condition: "matches query"}
    page: Articles {condition: "matches query"}
    page: People {condition: "matches query"}`
    };

    // --- State Variables ---
    let zoomLevel = 1.0;
    let panX = 40;
    let panY = 50;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let orientation = 'horizontal'; // 'horizontal' or 'vertical'
    let showConnections = true;
    let activeNodes = [];
    let hoveredNodeId = null; // Stores shared ID of hovered element to glow connection paths
    let selectedNodePathId = null; // Store path identifier of selected card
    const collapsedPaths = new Set(); // Store hierarchy path identifiers of collapsed nodes
    const collapsedTextLines = new Set(); // Store folded source line indices in the editor
    let selectedPersona = 'all'; // Current persona filter: 'all' or specific persona name
    let selectedTag = 'all'; // Current tag selector: 'all' or a specific node flag
    let currentErrorMessage = null; // Active parse error message (null when valid)
    let currentErrorLineIndex = null; // 0-based source line the active error points at
    let showInspector = false; // Collapsible Right sidebar Inspector toggle state
    let activeTopMenu = null; // Active top-bar persona/tag/glossary panel
    let hasPersonaMenu = false;
    let hasTagMenu = false;
    let hasGlossaryMenu = false;
    let serviceWorkerReadyPromise = null;
    let draftSaveTimer = null;
    let isRestoringDraft = false;
    let fullSyntaxText = '';
    let visibleEditorLineIndices = [];
    let editorMetricsProbe = null;

    // Setup color cache for shared instances
    const idColorCache = {};

    const DRAFT_SAVE_DELAY_MS = 300;
    const LOCAL_DRAFT_STORAGE_KEY = `infoarchdiagram-draft:${window.location.pathname}`;

    // --- Dom Elements ---
    const diagramSvg = document.getElementById('diagramSvg');
    const viewport = document.getElementById('viewport');
    const canvasContainer = document.getElementById('canvas-container');
    const syntaxInput = document.getElementById('syntaxInput');
    const lineNumbersContent = document.getElementById('lineNumbersContent');
    const emptyState = document.getElementById('empty-state');
    const btnOrientHorizontal = document.getElementById('btn-orient-horizontal');
    const btnOrientVertical = document.getElementById('btn-orient-vertical');
    const btnToggleConnections = document.getElementById('btn-toggle-connections');

    function shouldUseLocalDraftStorage() {
      return window.location.protocol === 'file:' || !('serviceWorker' in navigator);
    }

    function saveDraftToLocalStorage(text) {
      try {
        localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify({
          text: typeof text === 'string' ? text : '',
          updatedAt: Date.now()
        }));
      } catch (error) {
        console.warn('Local draft saving failed.', error);
      }
    }

    function loadDraftFromLocalStorage() {
      try {
        const raw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.text !== 'string') return null;
        return parsed;
      } catch (error) {
        console.warn('Local draft restore failed.', error);
        return null;
      }
    }

    function clearDraftFromLocalStorage() {
      try {
        localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
      } catch (error) {
        console.warn('Local draft clearing failed.', error);
      }
    }

    function isFoldableEditorLine(line) {
      const trimmed = line.trim();
      return Boolean(trimmed) && !trimmed.startsWith('#') && !trimmed.startsWith('//');
    }

    function isEditorMetadataLine(line) {
      const trimmed = line.trim().toLowerCase();
      return trimmed.startsWith('title:') || trimmed.startsWith('persona:');
    }

    function isEditorHierarchyLine(line) {
      if (!isFoldableEditorLine(line) || isEditorMetadataLine(line)) {
        return false;
      }

      return line.trim().includes(':');
    }

    function getEditorLineIndent(line) {
      const indentMatch = line.match(/^(\s*)/);
      return indentMatch ? indentMatch[1].length : 0;
    }

    function getEditorFoldRegions(lines) {
      const foldRegions = new Map();
      const hierarchyLines = [];

      lines.forEach((line, index) => {
        if (!isEditorHierarchyLine(line)) return;
        hierarchyLines.push({
          index,
          indent: getEditorLineIndent(line)
        });
      });

      hierarchyLines.forEach((node, hierarchyIndex) => {
        const nextNode = hierarchyLines[hierarchyIndex + 1];
        if (!nextNode || nextNode.indent <= node.indent) return;

        let endIndex = node.index;
        for (let cursor = node.index + 1; cursor < lines.length; cursor += 1) {
          const cursorLine = lines[cursor];
          if (isFoldableEditorLine(cursorLine) && getEditorLineIndent(cursorLine) <= node.indent) {
            break;
          }
          endIndex = cursor;
        }

        if (endIndex > node.index) {
          foldRegions.set(node.index, endIndex);
        }
      });

      return foldRegions;
    }

    function translateVisibleOffsetToFullOffset(offset) {
      const clampedOffset = Math.max(0, Math.min(Number(offset) || 0, syntaxInput?.value.length || 0));
      const sourceLines = fullSyntaxText.split('\n');

      if (visibleEditorLineIndices.length === 0) {
        return Math.min(clampedOffset, fullSyntaxText.length);
      }

      let remainingOffset = clampedOffset;

      for (let visibleIndex = 0; visibleIndex < visibleEditorLineIndices.length; visibleIndex += 1) {
        const sourceLineIndex = visibleEditorLineIndices[visibleIndex];
        const sourceLine = sourceLines[sourceLineIndex] ?? '';
        const visibleLineLength = sourceLine.length;
        const lineSpan = visibleLineLength + (visibleIndex < visibleEditorLineIndices.length - 1 ? 1 : 0);

        if (remainingOffset <= lineSpan) {
          const columnOffset = Math.min(remainingOffset, visibleLineLength);
          let fullOffset = 0;
          for (let sourceIndex = 0; sourceIndex < sourceLineIndex; sourceIndex += 1) {
            fullOffset += (sourceLines[sourceIndex] ?? '').length + 1;
          }
          return fullOffset + columnOffset;
        }

        remainingOffset -= lineSpan;
      }

      return fullSyntaxText.length;
    }

    function getSourcePositionFromFullOffset(offset) {
      const sourceLines = fullSyntaxText.split('\n');
      const clampedOffset = Math.max(0, Math.min(Number(offset) || 0, fullSyntaxText.length));
      let remainingOffset = clampedOffset;

      for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
        const sourceLine = sourceLines[lineIndex] ?? '';
        if (remainingOffset <= sourceLine.length) {
          return {
            lineIndex,
            columnOffset: remainingOffset
          };
        }

        remainingOffset -= sourceLine.length;
        if (lineIndex < sourceLines.length - 1) {
          if (remainingOffset === 0) {
            return {
              lineIndex: lineIndex + 1,
              columnOffset: 0
            };
          }
          remainingOffset -= 1;
        }
      }

      return {
        lineIndex: Math.max(sourceLines.length - 1, 0),
        columnOffset: (sourceLines[sourceLines.length - 1] || '').length
      };
    }

    function getCollapsedEditorAncestorLine(lineIndex) {
      const foldRegions = getEditorFoldRegions(fullSyntaxText.split('\n'));
      let collapsedAncestor = null;

      Array.from(collapsedTextLines).forEach((collapsedLineIndex) => {
        const endIndex = foldRegions.get(collapsedLineIndex);
        if (!endIndex) return;

        if (lineIndex > collapsedLineIndex && lineIndex <= endIndex) {
          if (collapsedAncestor === null || collapsedLineIndex > collapsedAncestor) {
            collapsedAncestor = collapsedLineIndex;
          }
        }
      });

      return collapsedAncestor;
    }

    function translateFullOffsetToVisibleOffset(offset, options = {}) {
      const { lineIndex, columnOffset } = getSourcePositionFromFullOffset(offset);
      let targetLineIndex = lineIndex;
      let targetColumnOffset = columnOffset;
      const visibleLineIndex = visibleEditorLineIndices.indexOf(lineIndex);

      if (visibleLineIndex === -1) {
        const collapsedAncestor = getCollapsedEditorAncestorLine(lineIndex);
        if (collapsedAncestor === null) {
          return null;
        }

        targetLineIndex = collapsedAncestor;
        targetColumnOffset = options.snapToCollapsedLineStart ? 0 : Math.min(columnOffset, (fullSyntaxText.split('\n')[collapsedAncestor] ?? '').length);
      }

      const resolvedVisibleLineIndex = visibleEditorLineIndices.indexOf(targetLineIndex);

      if (resolvedVisibleLineIndex === -1) {
        return null;
      }

      let visibleOffset = 0;
      const sourceLines = fullSyntaxText.split('\n');
      for (let i = 0; i < resolvedVisibleLineIndex; i += 1) {
        const sourceLineIndex = visibleEditorLineIndices[i];
        visibleOffset += (sourceLines[sourceLineIndex] ?? '').length + 1;
      }

      const visibleLineLength = (sourceLines[targetLineIndex] ?? '').length;
      return visibleOffset + Math.min(targetColumnOffset, visibleLineLength);
    }

    function syncLineNumberScroll() {
      if (!syntaxInput || !lineNumbersContent) return;
      lineNumbersContent.style.transform = `translateY(-${syntaxInput.scrollTop}px)`;
    }

    function ensureEditorMetricsProbe() {
      if (editorMetricsProbe || typeof document === 'undefined') return editorMetricsProbe;

      editorMetricsProbe = document.createElement('div');
      editorMetricsProbe.setAttribute('aria-hidden', 'true');
      editorMetricsProbe.style.position = 'absolute';
      editorMetricsProbe.style.visibility = 'hidden';
      editorMetricsProbe.style.pointerEvents = 'none';
      editorMetricsProbe.style.left = '-99999px';
      editorMetricsProbe.style.top = '0';
      editorMetricsProbe.style.whiteSpace = 'pre-wrap';
      editorMetricsProbe.style.overflowWrap = 'anywhere';
      editorMetricsProbe.style.wordBreak = 'break-word';
      editorMetricsProbe.style.boxSizing = 'content-box';
      editorMetricsProbe.style.padding = '0';
      editorMetricsProbe.style.border = '0';
      document.body.appendChild(editorMetricsProbe);

      return editorMetricsProbe;
    }

    function getEditorWrappedLayout(lines = fullSyntaxText.split('\n')) {
      if (!syntaxInput) {
        return {
          lineHeight: 18,
          rowCounts: lines.map(() => 1)
        };
      }

      const computedStyle = window.getComputedStyle(syntaxInput);
      const lineHeight = parseFloat(computedStyle.lineHeight) || 18;
      const contentWidth = Math.max(
        syntaxInput.clientWidth - parseFloat(computedStyle.paddingLeft || '0') - parseFloat(computedStyle.paddingRight || '0'),
        1
      );
      const probe = ensureEditorMetricsProbe();

      if (!probe) {
        return {
          lineHeight,
          rowCounts: lines.map(() => 1)
        };
      }

      probe.style.width = `${contentWidth}px`;
      probe.style.font = computedStyle.font;
      probe.style.fontSize = computedStyle.fontSize;
      probe.style.fontFamily = computedStyle.fontFamily;
      probe.style.fontWeight = computedStyle.fontWeight;
      probe.style.fontStyle = computedStyle.fontStyle;
      probe.style.letterSpacing = computedStyle.letterSpacing;
      probe.style.lineHeight = computedStyle.lineHeight;
      probe.style.tabSize = computedStyle.tabSize;
      probe.style.textTransform = computedStyle.textTransform;
      probe.style.textIndent = computedStyle.textIndent;

      const rowCounts = lines.map((line) => {
        probe.textContent = line.length > 0 ? line : '\u00a0';
        const measuredHeight = probe.getBoundingClientRect().height;
        return Math.max(1, Math.ceil(measuredHeight / lineHeight));
      });

      probe.textContent = '';

      return { lineHeight, rowCounts };
    }

    function getVisualRowsBeforeOffset(offset) {
      const clampedOffset = Math.max(0, Math.min(Number(offset) || 0, fullSyntaxText.length));
      const sourceLines = fullSyntaxText.split('\n');
      const { lineHeight, rowCounts } = getEditorWrappedLayout(sourceLines);
      const { lineIndex, columnOffset } = getSourcePositionFromFullOffset(clampedOffset);
      let visualRows = 0;

      for (let i = 0; i < lineIndex; i += 1) {
        visualRows += rowCounts[i] || 1;
      }

      const currentLine = sourceLines[lineIndex] ?? '';
      const currentLinePrefix = currentLine.slice(0, columnOffset);
      const { rowCounts: partialRows } = getEditorWrappedLayout([currentLinePrefix.length > 0 ? currentLinePrefix : '\u00a0']);
      visualRows += Math.max((partialRows[0] || 1) - 1, 0);

      return { visualRows, lineHeight };
    }

    function renderEditorText() {
      if (!syntaxInput || !lineNumbersContent) return;

      const selectionStart = syntaxInput.selectionStart;
      const selectionEnd = syntaxInput.selectionEnd;
      const scrollTop = syntaxInput.scrollTop;
      const sourceLines = fullSyntaxText.split('\n');
      const { lineHeight, rowCounts } = getEditorWrappedLayout(sourceLines);
      const gutterRows = [];

      sourceLines.forEach((line, index) => {
        const totalRows = rowCounts[index] || 1;
        if (index === currentErrorLineIndex) {
          gutterRows.push(`
            <div style="height:${lineHeight}px" class="pr-2 flex items-center justify-end gap-1 whitespace-nowrap">
              <button type="button" onclick="openErrorPopover(event)" title="${escapeHtml(currentErrorMessage || '')}" class="material-symbols-outlined text-[14px] text-rose-500 hover:text-rose-400 cursor-pointer leading-none animate-pulse">error</button>
              <span class="w-6 text-right block text-rose-400 font-bold">${index + 1}</span>
            </div>
          `);
        } else {
          gutterRows.push(`
            <div style="height:${lineHeight}px" class="pr-3 flex items-center justify-end whitespace-nowrap">
              <span class="w-8 text-right block">${index + 1}</span>
            </div>
          `);
        }

        for (let rowIndex = 1; rowIndex < totalRows; rowIndex += 1) {
          gutterRows.push(`
            <div style="height:${lineHeight}px" class="pr-3 flex items-center justify-end whitespace-nowrap">
              <span class="w-8 text-right block">&nbsp;</span>
            </div>
          `);
        }
      });

      syntaxInput.value = fullSyntaxText;
      visibleEditorLineIndices = sourceLines.map((_, index) => index);
      collapsedTextLines.clear();
      syntaxInput.readOnly = false;
      syntaxInput.selectionStart = Math.min(selectionStart, syntaxInput.value.length);
      syntaxInput.selectionEnd = Math.min(selectionEnd, syntaxInput.value.length);
      syntaxInput.scrollTop = scrollTop;
      lineNumbersContent.innerHTML = gutterRows.join('');
      syncLineNumberScroll();
    }

    function toggleTextFold() {
      return;
    }

    function setFullSyntaxText(text) {
      fullSyntaxText = String(text ?? '');
      collapsedTextLines.clear();
      renderEditorText();
    }

    function expandAllTextFolds() {
      return;
    }

    function sendServiceWorkerMessage(type, payload = {}) {
      if (!('serviceWorker' in navigator)) {
        return Promise.resolve(null);
      }

      return ensureServiceWorkerReady().then((worker) => {
        if (!worker) return null;

        return new Promise((resolve, reject) => {
          const channel = new MessageChannel();
          const timeoutId = window.setTimeout(() => reject(new Error(`Service worker message timed out: ${type}`)), 4000);

          channel.port1.onmessage = (event) => {
            window.clearTimeout(timeoutId);
            const data = event.data || {};
            if (data.ok === false) {
              reject(new Error(data.error || `Service worker request failed: ${type}`));
              return;
            }
            resolve(data.payload ?? null);
          };

          worker.postMessage({ type, payload }, [channel.port2]);
        });
      });
    }

    function ensureServiceWorkerReady() {
      if (!('serviceWorker' in navigator)) {
        return Promise.resolve(null);
      }

      if (!serviceWorkerReadyPromise) {
        serviceWorkerReadyPromise = navigator.serviceWorker
          .register('./service-worker.js')
          .then(() => navigator.serviceWorker.ready)
          .then((registration) => registration.active || registration.waiting || registration.installing || null)
          .catch((error) => {
            console.warn('Service worker registration failed.', error);
            return null;
          });
      }

      return serviceWorkerReadyPromise;
    }

    function persistDraftNow() {
      if (isRestoringDraft) return Promise.resolve();

      const currentText = fullSyntaxText;
      if (shouldUseLocalDraftStorage()) {
        if (!currentText.trim()) {
          clearDraftFromLocalStorage();
        } else {
          saveDraftToLocalStorage(currentText);
        }
        return Promise.resolve();
      }

      if (!currentText.trim()) {
        return sendServiceWorkerMessage('clear-draft').catch((error) => {
          console.warn('Draft clearing failed.', error);
        });
      }

      return sendServiceWorkerMessage('save-draft', { text: currentText }).catch((error) => {
        console.warn('Draft saving failed.', error);
      });
    }

    function scheduleDraftSave() {
      if (isRestoringDraft) return;

      window.clearTimeout(draftSaveTimer);
      draftSaveTimer = window.setTimeout(() => {
        persistDraftNow();
      }, DRAFT_SAVE_DELAY_MS);
    }

    async function restoreDraftFromServiceWorker() {
      if (shouldUseLocalDraftStorage()) {
        const payload = loadDraftFromLocalStorage();
        if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) {
          return;
        }

        isRestoringDraft = true;
        setFullSyntaxText(payload.text);
        isRestoringDraft = false;
        return;
      }

      try {
        const payload = await sendServiceWorkerMessage('load-draft');
        if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) {
          return;
        }

        isRestoringDraft = true;
        setFullSyntaxText(payload.text);
      } catch (error) {
        console.warn('Draft restore failed.', error);
      } finally {
        isRestoringDraft = false;
      }
    }

    // --- Initialization ---
    window.addEventListener('load', async () => {
      // Start completely blank/empty as requested
      setFullSyntaxText("");
      
      // Auto-detect theme preference
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) themeIcon.textContent = 'light_mode';
      } else {
        const themeIcon = document.getElementById('theme-icon');
        if (themeIcon) themeIcon.textContent = 'dark_mode';
      }

      // Add Mouse Pan Event Listeners
      canvasContainer.addEventListener('mousedown', startPan);
      window.addEventListener('mousemove', dragPan);
      window.addEventListener('mouseup', endPan);
      canvasContainer.addEventListener('wheel', handleWheel, { passive: false });

      // Add touch capabilities
      canvasContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          isDragging = true;
          startX = e.touches[0].clientX - panX;
          startY = e.touches[0].clientY - panY;
        }
      });
      canvasContainer.addEventListener('touchmove', (e) => {
        if (isDragging && e.touches.length === 1) {
          panX = e.touches[0].clientX - startX;
          panY = e.touches[0].clientY - startY;
          applyTransform();
        }
      });
      canvasContainer.addEventListener('touchend', () => { isDragging = false; });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          window.clearTimeout(draftSaveTimer);
          persistDraftNow();
        }
      });
      window.addEventListener('pagehide', () => {
        window.clearTimeout(draftSaveTimer);
        persistDraftNow();
      });
      syntaxInput.addEventListener('scroll', syncLineNumberScroll);
      window.addEventListener('resize', renderEditorText);
      // Dismiss the error popover on any click outside it (except the gutter icon that opens it).
      document.addEventListener('mousedown', (e) => {
        const popover = document.getElementById('error-popover');
        if (!popover || popover.classList.contains('hidden')) return;
        if (popover.contains(e.target)) return;
        if (e.target.closest && e.target.closest('button[onclick^="openErrorPopover"]')) return;
        closeErrorPopover();
      });
      if ('ResizeObserver' in window) {
        const editorResizeObserver = new ResizeObserver(() => {
          renderEditorText();
        });
        editorResizeObserver.observe(syntaxInput);
        const editorPanel = document.getElementById('editor-panel');
        if (editorPanel) {
          editorResizeObserver.observe(editorPanel);
        }
      }

      // Add custom Tab key handler to the syntax editor
      setupTabKeyHandler();

      await restoreDraftFromServiceWorker();
      renderEditorText();

      // Run initial parse (will show empty/guide view)
      parseAndRender();
    });

    // --- File Import System ---
    function triggerFileInput() {
      const fileInput = document.getElementById('fileInput');
      if (fileInput) fileInput.click();
    }

    // handleFileUpload function
    function handleFileUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        setFullSyntaxText(e.target.result);
        // Clean up previous states
        selectedNodePathId = null;
        collapsedPaths.clear();
        selectedPersona = 'all';
        selectedTag = 'all';
        parseAndRender();
        resetZoom();
        persistDraftNow();
      };
      reader.readAsText(file);
    }

    // --- File Save System ---
    function saveToFile() {
      const text = fullSyntaxText;
      let filename = "untitled-diagram.txt";
      
      // Extract title if available in the text
      const titleMatch = text.match(/^title:\s*(.+)$/m);
      if (titleMatch && titleMatch[1].trim()) {
        const sanitizedTitle = titleMatch[1].trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s_-]/g, '')
          .replace(/\s+/g, '-');
        if (sanitizedTitle) {
          filename = `${sanitizedTitle}.txt`;
        }
      }

      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    // --- Tab key and Shift+Tab handler ---
    function setupTabKeyHandler() {
      syntaxInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();

          const start = this.selectionStart;
          const end = this.selectionEnd;
          const value = this.value;
          const beforeCursor = value.substring(0, start);
          const lineStartPos = beforeCursor.lastIndexOf('\n') + 1;
          const currentLine = value.substring(lineStartPos, start);
          const leadingWhitespace = currentLine.match(/^\s*/)?.[0] || '';
          const insertion = `\n${leadingWhitespace}`;

          this.value = value.substring(0, start) + insertion + value.substring(end);
          this.selectionStart = this.selectionEnd = start + insertion.length;

          fullSyntaxText = this.value;
          renderEditorText();
          parseAndRender();
          scheduleDraftSave();
          return;
        }

        if (e.key === 'Tab') {
          e.preventDefault(); // Stop focus navigation
          
          const start = this.selectionStart;
          const end = this.selectionEnd;
          const value = this.value;
          const tabChar = "  "; // Using 2 spaces for a clean standard indent layout

          if (!e.shiftKey) {
            // CASE 1: Standard Indentation
            if (start === end) {
              // No text highlighted: Insert 2 spaces at current cursor position
              this.value = value.substring(0, start) + tabChar + value.substring(end);
              this.selectionStart = this.selectionEnd = start + tabChar.length;
            } else {
              // Text highlighted: Indent all lines within the selection
              const selectedText = value.substring(start, end);
              const lines = selectedText.split('\n');
              const indentedLines = lines.map(line => tabChar + line);
              const newText = indentedLines.join('\n');
              
              this.value = value.substring(0, start) + newText + value.substring(end);
              this.selectionStart = start;
              this.selectionEnd = start + newText.length;
            }
          } else {
            // CASE 2: Outdent (Shift + Tab)
            if (start === end) {
              // Single line unindentation
              const beforeCursor = value.substring(0, start);
              const lineStartPos = beforeCursor.lastIndexOf('\n') + 1;
              const currentLine = value.substring(lineStartPos, start);
              
              if (currentLine.startsWith('  ')) {
                this.value = value.substring(0, lineStartPos) + currentLine.substring(2) + value.substring(start);
                this.selectionStart = this.selectionEnd = start - 2;
              } else if (currentLine.startsWith(' ')) {
                this.value = value.substring(0, lineStartPos) + currentLine.substring(1) + value.substring(start);
                this.selectionStart = this.selectionEnd = start - 1;
              } else if (currentLine.startsWith('\t')) {
                this.value = value.substring(0, lineStartPos) + currentLine.substring(1) + value.substring(start);
                this.selectionStart = this.selectionEnd = start - 1;
              }
            } else {
              // Block selection unindentation
              const selectedText = value.substring(start, end);
              const lines = selectedText.split('\n');
              const outdentedLines = lines.map(line => {
                if (line.startsWith('  ')) return line.substring(2);
                if (line.startsWith(' ')) return line.substring(1);
                if (line.startsWith('\t')) return line.substring(1);
                return line;
              });
              const newText = outdentedLines.join('\n');
              
              this.value = value.substring(0, start) + newText + value.substring(end);
              this.selectionStart = start;
              this.selectionEnd = start + newText.length;
            }
          }

          // Trigger rendering engine on key modification
          fullSyntaxText = this.value;
          renderEditorText();
          parseAndRender();
          scheduleDraftSave();
        }
      });
    }

    // --- Recursive path identifier generator ---
    function assignPaths(node, parentPath = "") {
      const currentPath = parentPath === "" ? String(node.indexInParent) : `${parentPath}.${node.indexInParent}`;
      node.pathId = currentPath;
      node.children.forEach((child, idx) => {
        child.indexInParent = idx;
        assignPaths(child, currentPath);
      });
    }

    function normalizePersonaValue(value) {
      if (!value) return '';

      let normalized = String(value).trim();
      if (
        (normalized.startsWith('"') && normalized.endsWith('"')) ||
        (normalized.startsWith("'") && normalized.endsWith("'"))
      ) {
        normalized = normalized.substring(1, normalized.length - 1).trim();
      }

      return normalized.toLowerCase();
    }

    function normalizeTagValue(value) {
      return String(value || '').trim().toLowerCase();
    }

    function createAttributeState() {
      return {
        id: '',
        status: 'default',
        flags: [],
        personas: [],
        comment: '',
        description: '',
        href: '',
        condition: '',
        action: '',
        customIdSet: false,
        hasStatusSet: false,
        hasFlagsSet: false
      };
    }

    function splitAttributeParts(rawAttr) {
      const parts = [];
      let currentPart = '';
      let inQuotes = false;
      let quoteChar = '';
      let bracketDepth = 0;

      for (let i = 0; i < rawAttr.length; i += 1) {
        const char = rawAttr[i];
        if ((char === '"' || char === "'") && (i === 0 || rawAttr[i - 1] !== '\\')) {
          if (inQuotes && char === quoteChar) {
            inQuotes = false;
          } else if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
          }
        }
        if (!inQuotes) {
          if (char === '[') bracketDepth += 1;
          if (char === ']') bracketDepth -= 1;
        }

        if (char === ',' && !inQuotes && bracketDepth === 0) {
          parts.push(currentPart);
          currentPart = '';
        } else {
          currentPart += char;
        }
      }

      if (currentPart) {
        parts.push(currentPart);
      }

      return parts;
    }

    function parseAttributes(rawAttr, personasMap, baseAttributes = createAttributeState()) {
      const attributes = { ...baseAttributes };
      if (!rawAttr) return attributes;

      splitAttributeParts(rawAttr).forEach(part => {
        const kv = part.split(':');
        if (kv.length < 2) return;

        const key = kv[0].trim().toLowerCase();
        const val = kv.slice(1).join(':').trim();

        if (key === 'id') {
          attributes.id = val;
          attributes.customIdSet = true;
        } else if (key === 'status') {
          attributes.status = val.toLowerCase();
          attributes.hasStatusSet = true;
        } else if (key === 'comment') {
          attributes.comment = cleanAttributeValue(val);
        } else if (key === 'description') {
          attributes.description = cleanAttributeValue(val);
        } else if (key === 'href') {
          attributes.href = val.trim();
        } else if (key === 'condition') {
          attributes.condition = cleanAttributeValue(val);
        } else if (key === 'action') {
          attributes.action = cleanAttributeValue(val);
        } else if (key === 'flags') {
          attributes.flags = parseFlagValues(val);
          if (attributes.flags.length > 0) {
            attributes.hasFlagsSet = true;
          }
        } else if (key === 'personas' || key === 'persona') {
          attributes.personas = parsePersonaValues(val, personasMap);
        }
      });

      return attributes;
    }

    function registerPersonaValue(rawPersona, personasMap, description = '') {
      const personaLabel = String(rawPersona || '').trim().replace(/^['"]|['"]$/g, '').trim();
      const personaKey = normalizePersonaValue(personaLabel);
      const cleanDescription = cleanAttributeValue(description);

      if (!personaKey) return '';
      if (!personasMap.has(personaKey)) {
        personasMap.set(personaKey, {
          name: personaLabel,
          description: cleanDescription
        });
      } else if (cleanDescription && !personasMap.get(personaKey).description) {
        const existingPersona = personasMap.get(personaKey);
        personasMap.set(personaKey, {
          ...existingPersona,
          description: cleanDescription
        });
      }

      return personasMap.get(personaKey).name;
    }

    function parsePersonaValues(rawValue, personasMap) {
      const personaMatch = String(rawValue || '').trim().match(/^\[(.*)\]$/);
      const rawPersonas = personaMatch ? personaMatch[1].split(',') : [rawValue];

      return rawPersonas
        .map(persona => registerPersonaValue(persona, personasMap))
        .filter(Boolean);
    }

    function parseFlagValues(rawValue) {
      const normalized = String(rawValue || '').trim();
      const flagMatch = normalized.match(/^\[(.*)\]$/);
      const rawFlags = flagMatch ? flagMatch[1].split(',') : [normalized];

      return rawFlags
        .map(flag => cleanAttributeValue(flag))
        .map(flag => flag.trim())
        .filter(Boolean);
    }

    function cleanAttributeValue(value) {
      let cleaned = String(value || '').trim();
      if (
        (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))
      ) {
        cleaned = cleaned.substring(1, cleaned.length - 1).trim();
      }
      return cleaned;
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function isStructuralNodeType(type) {
      return type === 'page' || type === 'group' || type === 'field group' || type === 'fieldgroup';
    }

    function isConditionalNodeType(type) {
      return ['decision', 'branch', 'selector', 'cluster'].includes(type);
    }

    function isFlowNavigationNodeType(type) {
      return ['flow', 'reference', 'continue', 'entry', 'exit', 'concurrent', 'file'].includes(type);
    }

    function isSpecialFlowNodeType(type) {
      return isConditionalNodeType(type) || isFlowNavigationNodeType(type);
    }

    function getNodeDimensions(type) {
      if (isStructuralNodeType(type)) {
        return { width: 220, height: 76 };
      }

      const nonStructuralWidthBoost = 40;

      switch (type) {
        case 'decision':
          return { width: 170 + nonStructuralWidthBoost, height: 92 };
        case 'branch':
          return { width: 158 + nonStructuralWidthBoost, height: 96 };
        case 'selector':
          return { width: 182 + nonStructuralWidthBoost, height: 92 };
        case 'cluster':
          return { width: 96 + nonStructuralWidthBoost, height: 96 };
        case 'concurrent':
          return { width: 156 + nonStructuralWidthBoost, height: 82 };
        case 'flow':
        case 'reference':
          return { width: 188 + nonStructuralWidthBoost, height: 74 };
        case 'continue':
        case 'entry':
        case 'exit':
          return { width: 172 + nonStructuralWidthBoost, height: 70 };
        case 'file':
          return { width: 160 + nonStructuralWidthBoost, height: 68 };
        default:
          return { width: 220 + nonStructuralWidthBoost, height: 44 };
      }
    }

    function getConnectorLabel(node) {
      return node.condition || node.action || '';
    }

    function isConditionalConnector(parentNode, childNode) {
      // VisVocab cluster ("one decision, many paths"): the condition is evaluated on the
      // edge INTO the cluster; the edges OUT of it lead to paths that are all presented
      // together, so those outgoing connectors are solid/non-conditional — unless the child
      // is itself a conditional element (e.g. a nested branch/selector).
      if (parentNode.type === 'cluster') {
        return isConditionalNodeType(childNode.type);
      }
      return Boolean(childNode.condition) || isConditionalNodeType(parentNode.type) || isConditionalNodeType(childNode.type);
    }

    // VisVocab choice semantics shown as a small pill at a node's output:
    //   branch   -> exactly one downstream path is presented ("1 of")
    //   selector -> one OR MORE downstream paths may be presented ("1+ of")
    //   cluster  -> all downstream paths are presented together ("all of")
    function getChoiceBadgeSpec(type) {
      switch (type) {
        case 'branch':
          return { text: '1 of', pill: 'fill-rose-100 dark:fill-rose-950 stroke-rose-300 dark:stroke-rose-800', label: 'fill-rose-700 dark:fill-rose-200' };
        case 'selector':
          return { text: '1+ of', pill: 'fill-cyan-100 dark:fill-cyan-950 stroke-cyan-300 dark:stroke-cyan-800', label: 'fill-cyan-700 dark:fill-cyan-200' };
        case 'cluster':
          return { text: 'all of', pill: 'fill-fuchsia-100 dark:fill-fuchsia-950 stroke-fuchsia-300 dark:stroke-fuchsia-800', label: 'fill-fuchsia-700 dark:fill-fuchsia-200' };
        default:
          return null;
      }
    }

    function shouldRenderArrowHead(parentNode, childNode) {
      if (isConditionalNodeType(childNode.type) && !isConditionalNodeType(parentNode.type)) {
        return false;
      }

      return true;
    }

    function getFlowNodeSpec(node) {
      const base = {
        bg: 'bg-white dark:bg-slate-800',
        border: 'border-slate-300 dark:border-slate-600',
        icon: 'description',
        accent: 'bg-sky-400',
        labelClass: 'text-slate-800 dark:text-white',
        typeClass: 'text-slate-500 dark:text-slate-400',
        clipPath: '',
        borderRadius: '14px',
        customShape: false
      };

      if (node.type === 'page') {
        return { ...base, bg: 'bg-indigo-50 dark:bg-indigo-950', border: 'border-indigo-200 dark:border-indigo-900', icon: 'web', accent: 'bg-indigo-600' };
      }
      if (node.type === 'group' || node.type === 'field group' || node.type === 'fieldgroup') {
        return { ...base, bg: 'bg-amber-50 dark:bg-amber-950', border: 'border-amber-200 dark:border-amber-900', icon: 'folder', accent: 'bg-amber-500' };
      }
      if (node.type === 'element') {
        return { ...base, bg: 'bg-slate-100 dark:bg-slate-800', border: 'border-slate-300 dark:border-slate-600 border-dashed border-2', icon: 'widgets', accent: 'bg-slate-400 dark:bg-slate-500' };
      }

      switch (node.type) {
        case 'button':
          return { ...base, icon: 'smart_button', accent: 'bg-purple-500' };
        case 'input':
          return { ...base, icon: 'text_fields' };
        case 'select':
          return { ...base, icon: 'arrow_drop_down_circle' };
        case 'calendar':
          return { ...base, icon: 'calendar_month' };
        case 'textarea':
          return { ...base, icon: 'notes' };
        case 'paragraph':
          return { ...base, icon: 'subject' };
        case 'checkbox':
          return { ...base, icon: 'check_box' };
        case 'radio':
          return { ...base, icon: 'radio_button_checked' };
        case 'table':
          return { ...base, icon: 'table_chart' };
        case 'row':
          return { ...base, icon: 'view_stream' };
        case 'decision':
          return { ...base, bg: 'bg-rose-50 dark:bg-rose-950/60', border: 'border-rose-300 dark:border-rose-800', icon: 'alt_route', labelClass: 'text-rose-800 dark:text-rose-100', typeClass: 'text-rose-600 dark:text-rose-300', clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', borderRadius: '0', customShape: true };
        case 'branch':
          return { ...base, bg: 'bg-amber-50 dark:bg-amber-950/60', border: 'border-amber-300 dark:border-amber-800', icon: 'fork_right', labelClass: 'text-amber-900 dark:text-amber-100', typeClass: 'text-amber-700 dark:text-amber-300', clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)', borderRadius: '0', customShape: true };
        case 'selector':
          return { ...base, bg: 'bg-cyan-50 dark:bg-cyan-950/60', border: 'border-cyan-300 dark:border-cyan-800', icon: 'rule', labelClass: 'text-cyan-900 dark:text-cyan-100', typeClass: 'text-cyan-700 dark:text-cyan-300', clipPath: 'polygon(18% 0%, 82% 0%, 100% 100%, 0% 100%)', borderRadius: '0', customShape: true };
        case 'cluster':
          return { ...base, bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/60', border: 'border-fuchsia-300 dark:border-fuchsia-800', icon: 'hub', labelClass: 'text-fuchsia-900 dark:text-fuchsia-100', typeClass: 'text-fuchsia-700 dark:text-fuchsia-300', borderRadius: '9999px', customShape: true };
        case 'flow':
          return { ...base, bg: 'bg-indigo-50 dark:bg-indigo-950/70', border: 'border-indigo-300 dark:border-indigo-800 border-dashed', icon: 'route', labelClass: 'text-indigo-900 dark:text-indigo-100', typeClass: 'text-indigo-700 dark:text-indigo-300', clipPath: 'polygon(10% 0%, 90% 0%, 100% 24%, 100% 76%, 90% 100%, 10% 100%, 0% 76%, 0% 24%)', borderRadius: '0', customShape: true };
        case 'reference':
          return { ...base, bg: 'bg-violet-50 dark:bg-violet-950/70', border: 'border-violet-300 dark:border-violet-800 border-dashed', icon: 'bookmark', labelClass: 'text-violet-900 dark:text-violet-100', typeClass: 'text-violet-700 dark:text-violet-300', clipPath: 'polygon(10% 0%, 90% 0%, 100% 24%, 100% 76%, 90% 100%, 10% 100%, 0% 76%, 0% 24%)', borderRadius: '0', customShape: true };
        case 'continue':
          return { ...base, bg: 'bg-slate-50 dark:bg-slate-900', border: 'border-slate-400 dark:border-slate-600 border-dashed', icon: 'more_horiz', clipPath: 'polygon(10% 0%, 90% 0%, 90% 18%, 100% 18%, 100% 82%, 90% 82%, 90% 100%, 10% 100%, 10% 82%, 0% 82%, 0% 18%, 10% 18%)', borderRadius: '0', customShape: true };
        case 'entry':
          return { ...base, bg: 'bg-emerald-50 dark:bg-emerald-950/60', border: 'border-emerald-300 dark:border-emerald-800 border-dashed', icon: 'login', labelClass: 'text-emerald-900 dark:text-emerald-100', typeClass: 'text-emerald-700 dark:text-emerald-300', clipPath: 'polygon(10% 0%, 90% 0%, 90% 18%, 100% 18%, 100% 82%, 90% 82%, 90% 100%, 10% 100%, 10% 82%, 0% 82%, 0% 18%, 10% 18%)', borderRadius: '0', customShape: true };
        case 'exit':
          return { ...base, bg: 'bg-orange-50 dark:bg-orange-950/60', border: 'border-orange-300 dark:border-orange-800 border-dashed', icon: 'logout', labelClass: 'text-orange-900 dark:text-orange-100', typeClass: 'text-orange-700 dark:text-orange-300', clipPath: 'polygon(10% 0%, 90% 0%, 90% 18%, 100% 18%, 100% 82%, 90% 82%, 90% 100%, 10% 100%, 10% 82%, 0% 82%, 0% 18%, 10% 18%)', borderRadius: '0', customShape: true };
        case 'concurrent':
          return { ...base, bg: 'bg-sky-50 dark:bg-sky-950/60', border: 'border-sky-300 dark:border-sky-800', icon: 'splitscreen', labelClass: 'text-sky-900 dark:text-sky-100', typeClass: 'text-sky-700 dark:text-sky-300', borderRadius: orientation === 'horizontal' ? '9999px 0 0 9999px' : '9999px 9999px 0 0', customShape: true };
        case 'file':
          return { ...base, bg: 'bg-slate-50 dark:bg-slate-800', border: 'border-slate-300 dark:border-slate-600', icon: 'description', clipPath: 'polygon(0 0, 78% 0, 100% 22%, 100% 100%, 0 100%)', borderRadius: '0', customShape: true };
        default:
          return base;
      }
    }

    function getLayoutDepthStep() {
      return orientation === 'horizontal' ? 290 : 160;
    }

    function getLeafGap() {
      return orientation === 'horizontal' ? 40 : 56;
    }

    function getCompactLeafGap() {
      return orientation === 'horizontal' ? 24 : 36;
    }

    function getGapBetweenLeaves(previousNode, nextNode) {
      if (!previousNode || !nextNode) return 0;

      return isStructuralNodeType(previousNode.type) || isStructuralNodeType(nextNode.type)
        ? getLeafGap()
        : getCompactLeafGap();
    }

    function placeLeafNode(node, depth, tracker) {
      tracker.cursor += getGapBetweenLeaves(tracker.previousLeaf, node);

      if (orientation === 'horizontal') {
        node.x = depth * getLayoutDepthStep() + 50;
        node.y = tracker.cursor;
        tracker.cursor += node.height;
      } else {
        node.x = tracker.cursor;
        node.y = depth * getLayoutDepthStep() + 40;
        tracker.cursor += node.width;
      }

      tracker.previousLeaf = node;
    }

    // --- Helper to check if node has a collapsed ancestor ---
    function isNodeHidden(node) {
      let current = node.parent;
      while (current) {
        if (collapsedPaths.has(current.pathId)) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }

    // --- Helper to check if node matches the currently selected persona filter ---
    function matchesSelectedPersona(node) {
      if (selectedPersona === 'all') return true;
      if (!node.personas || node.personas.length === 0) return true;
      const selectedPersonaKey = normalizePersonaValue(selectedPersona);
      return node.personas.some(persona => normalizePersonaValue(persona) === selectedPersonaKey);
    }

    function matchesSelectedTag(node) {
      if (selectedTag === 'all') return true;
      if (!node.flags || node.flags.length === 0) return false;
      const selectedTagKey = normalizeTagValue(selectedTag);
      return node.flags.some(flag => normalizeTagValue(flag) === selectedTagKey);
    }

    function matchesActiveFilters(node) {
      return matchesSelectedPersona(node);
    }

    // --- Node selection & sync editor scrolling handler ---
    function selectNode(pathId) {
      selectedNodePathId = pathId;
      parseAndRender();
    }

    function highlightAndScrollToLine(start, end) {
      const visibleStart = translateFullOffsetToVisibleOffset(start, { snapToCollapsedLineStart: true });
      const visibleEnd = translateFullOffsetToVisibleOffset(end);
      if (visibleStart === null || visibleEnd === null) return;

      syntaxInput.focus();
      syntaxInput.setSelectionRange(visibleStart, visibleEnd);
      
      const { visualRows, lineHeight } = getVisualRowsBeforeOffset(visibleStart);
      
      // Scroll smoothly to position selection safely in view
      syntaxInput.scrollTo({
        top: Math.max((visualRows - 4) * lineHeight, 0),
        behavior: 'smooth'
      });
    }

    function handleNodeClick(e, pathId, lineStart, lineEnd) {
      if (e) e.stopPropagation();
      selectNode(pathId);
      highlightAndScrollToLine(lineStart, lineEnd);
      
      // Also automatically center the canvas on this selected node!
      const targetedNode = activeNodes.find(n => n.pathId === pathId);
      if (targetedNode) {
        centerOnNode(targetedNode);
      }
    }

    function focusNodeByPath(pathId) {
      const targetNode = activeNodes.find(node => node.pathId === pathId);
      if (!targetNode) return;

      let current = targetNode.parent;
      while (current) {
        collapsedPaths.delete(current.pathId);
        current = current.parent;
      }

      selectedNodePathId = pathId;
      parseAndRender();
      highlightAndScrollToLine(targetNode.lineStart, targetNode.lineEnd);

      const refreshedNode = activeNodes.find(node => node.pathId === pathId && !node.hidden);
      if (refreshedNode) {
        centerOnNode(refreshedNode);
      }
    }

    // --- Pan/Scroll Viewport directly to focus a Node ---
    function centerOnNode(node) {
      if (!node || node.x === undefined || node.y === undefined) return;
      const rect = canvasContainer.getBoundingClientRect();
      const dimensions = getNodeDimensions(node.type);
      const nodeW = dimensions.width;
      const nodeH = dimensions.height;
      
      // Calculate panX and panY to place card directly in viewport center
      panX = (rect.width / 2) - (node.x + nodeW / 2) * zoomLevel;
      panY = (rect.height / 2) - (node.y + nodeH / 2) * zoomLevel;
      applyTransform();
    }

    // --- Focus/Center Viewport on the Main root Node card ---
    function focusMainCard() {
      // Find the first top-level root node that is visible (not filtered by persona)
      const mainCard = activeNodes.find(n => n.depth === 0 && !n.hidden);
      if (mainCard) {
        centerOnNode(mainCard);
        selectNode(mainCard.pathId);
      } else {
        resetZoom();
      }
    }

    // --- Inspector Panel Toggle ---
    function toggleInspector() {
      showInspector = !showInspector;
      const panel = document.getElementById('inspector-panel');
      const btn = document.getElementById('btn-toggle-inspector');
      if (showInspector) {
        if (panel) panel.classList.remove('hidden');
        if (btn) btn.classList.add('bg-indigo-50', 'dark:bg-slate-700', 'text-brand-500');
        populateInspector();
      } else {
        if (panel) panel.classList.add('hidden');
        if (btn) btn.classList.remove('bg-indigo-50', 'dark:bg-slate-700', 'text-brand-500');
      }
    }

    function refreshTopMenuPanels() {
      const panelContainer = document.getElementById('top-filter-panels');
      const menuConfig = [
        { key: 'persona', available: hasPersonaMenu, buttonId: 'btn-toggle-persona-menu', cardId: 'persona-filter-card' },
        { key: 'tag', available: hasTagMenu, buttonId: 'btn-toggle-tag-menu', cardId: 'tag-filter-card' },
        { key: 'glossary', available: hasGlossaryMenu, buttonId: 'btn-toggle-glossary-menu', cardId: 'glossary-card' }
      ];

      let hasOpenPanel = false;

      menuConfig.forEach(({ key, available, buttonId, cardId }) => {
        const button = document.getElementById(buttonId);
        const card = document.getElementById(cardId);
        if (!button || !card) return;

        if (!available) {
          button.classList.add('hidden');
          button.classList.remove('bg-indigo-50', 'dark:bg-slate-600', 'text-brand-500');
          card.classList.add('hidden');
          if (activeTopMenu === key) {
            activeTopMenu = null;
          }
          return;
        }

        button.classList.remove('hidden');
        const isActive = activeTopMenu === key;
        if (isActive) {
          button.classList.add('bg-indigo-50', 'dark:bg-slate-600', 'text-brand-500');
          card.classList.remove('hidden');
          hasOpenPanel = true;
        } else {
          button.classList.remove('bg-indigo-50', 'dark:bg-slate-600', 'text-brand-500');
          card.classList.add('hidden');
        }
      });

      if (panelContainer) {
        panelContainer.classList.toggle('hidden', !hasOpenPanel);
      }
    }

    function toggleTopMenu(menuKey) {
      const menuAvailability = {
        persona: hasPersonaMenu,
        tag: hasTagMenu,
        glossary: hasGlossaryMenu
      };

      if (!menuAvailability[menuKey]) return;

      activeTopMenu = activeTopMenu === menuKey ? null : menuKey;
      refreshTopMenuPanels();
    }

    // --- Populate and Render Right Inspector Menu ---
    function populateInspector() {
      if (!showInspector) return;

      const statusList = document.getElementById('inspector-status-list');
      const flagsList = document.getElementById('inspector-flags-list');
      const personasList = document.getElementById('inspector-personas-list');

      if (!statusList || !flagsList || !personasList) return;

      statusList.innerHTML = '';
      flagsList.innerHTML = '';
      personasList.innerHTML = '';

      const statusesMap = {};
      const flagsMap = {};
      const personasMap = {};

      activeNodes.forEach(node => {
        if (node.hidden) return;

        // Group by status
        if (node.status && node.status !== 'default') {
          if (!statusesMap[node.status]) statusesMap[node.status] = [];
          statusesMap[node.status].push(node);
        }

        // Group by flags
        if (node.flags && node.flags.length > 0) {
          node.flags.forEach(flag => {
            if (!flagsMap[flag]) flagsMap[flag] = [];
            flagsMap[flag].push(node);
          });
        }

        // Group by personas
        if (node.personas && node.personas.length > 0) {
          node.personas.forEach(persona => {
            if (!personasMap[persona]) personasMap[persona] = [];
            personasMap[persona].push(node);
          });
        }
      });

      // RENDER STATUSES
      const statusKeys = Object.keys(statusesMap);
      if (statusKeys.length === 0) {
        statusList.innerHTML = '<p class="text-slate-400 italic">No custom statuses configured</p>';
      } else {
        statusKeys.forEach(status => {
          const section = document.createElement('div');
          section.className = 'mb-2';
          section.innerHTML = `
            <div class="font-semibold text-slate-700 dark:text-slate-300 capitalize flex items-center justify-between mb-1 bg-slate-50 dark:bg-slate-900/40 p-1.5 rounded">
              <span>${status}</span>
              <span class="bg-indigo-50 dark:bg-slate-800 text-brand-600 dark:text-brand-400 px-1.5 py-0.5 rounded text-[10px]">${statusesMap[status].length}</span>
            </div>
            <div class="space-y-1 pl-2">
              ${statusesMap[status].map(node => `
                <button onclick="handleNodeClick(null, '${node.pathId}', ${node.lineStart}, ${node.lineEnd})" class="w-full text-left truncate text-slate-500 dark:text-slate-400 hover:text-brand-500 hover:underline flex items-center space-x-1.5">
                  <span class="material-symbols-outlined text-[12px]">subdirectory_arrow_right</span>
                  <span class="truncate">${node.label}</span>
                </button>
              `).join('')}
            </div>
          `;
          statusList.appendChild(section);
        });
      }

      // RENDER FLAGS
      const flagKeys = Object.keys(flagsMap);
      if (flagKeys.length === 0) {
        flagsList.innerHTML = '<p class="text-slate-400 italic">No custom flags declared</p>';
      } else {
        flagKeys.forEach(flag => {
          const section = document.createElement('div');
          section.className = 'mb-2';
          section.innerHTML = `
            <div class="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between mb-1 bg-slate-50 dark:bg-slate-900/40 p-1.5 rounded">
              <span>#${flag}</span>
              <span class="bg-indigo-50 dark:bg-slate-800 text-brand-600 dark:text-brand-400 px-1.5 py-0.5 rounded text-[10px]">${flagsMap[flag].length}</span>
            </div>
            <div class="space-y-1 pl-2">
              ${flagsMap[flag].map(node => `
                <button onclick="handleNodeClick(null, '${node.pathId}', ${node.lineStart}, ${node.lineEnd})" class="w-full text-left truncate text-slate-500 dark:text-slate-400 hover:text-brand-500 hover:underline flex items-center space-x-1.5">
                  <span class="material-symbols-outlined text-[12px]">subdirectory_arrow_right</span>
                  <span class="truncate">${node.label}</span>
                </button>
              `).join('')}
            </div>
          `;
          flagsList.appendChild(section);
        });
      }

      // RENDER PERSONAS
      const personaKeys = Object.keys(personasMap);
      if (personaKeys.length === 0) {
        personasList.innerHTML = '<p class="text-slate-400 italic">No persona restrictions specified</p>';
      } else {
        personaKeys.forEach(persona => {
          const section = document.createElement('div');
          section.className = 'mb-2';
          section.innerHTML = `
            <div class="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between mb-1 bg-slate-50 dark:bg-slate-900/40 p-1.5 rounded">
              <span>${persona}</span>
              <span class="bg-indigo-50 dark:bg-slate-800 text-brand-600 dark:text-brand-400 px-1.5 py-0.5 rounded text-[10px]">${personasMap[persona].length}</span>
            </div>
            <div class="space-y-1 pl-2">
              ${personasMap[persona].map(node => `
                <button onclick="handleNodeClick(null, '${node.pathId}', ${node.lineStart}, ${node.lineEnd})" class="w-full text-left truncate text-slate-500 dark:text-slate-400 hover:text-brand-500 hover:underline flex items-center space-x-1.5">
                  <span class="material-symbols-outlined text-[12px]">subdirectory_arrow_right</span>
                  <span class="truncate">${node.label}</span>
                </button>
              `).join('')}
            </div>
          `;
          personasList.appendChild(section);
        });
      }
    }

    function buildGlossaryEntries(declaredElements, declaredPersonas) {
      const glossaryEntries = [];

      Object.values(declaredElements)
        .filter(item => item && item.type === 'element' && item.label)
        .forEach(item => {
          glossaryEntries.push({
            category: 'Element',
            name: item.label,
            description: item.description || item.comment || ''
          });
        });

      Array.from(declaredPersonas.values()).forEach(persona => {
        glossaryEntries.push({
          category: 'Persona',
          name: persona.name,
          description: persona.description || ''
        });
      });

      return glossaryEntries.sort((left, right) => left.name.localeCompare(right.name));
    }

    function updateGlossaryCard(glossaryEntries) {
      const card = document.getElementById('glossary-card');
      const list = document.getElementById('glossary-list');

      if (!card || !list) return;

      if (!glossaryEntries || glossaryEntries.length === 0) {
        hasGlossaryMenu = false;
        card.classList.add('hidden');
        list.innerHTML = '';
        refreshTopMenuPanels();
        return;
      }

      hasGlossaryMenu = true;
      card.classList.remove('hidden');
      list.innerHTML = glossaryEntries.map(entry => `
        <div class="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3">
          <div class="flex items-start justify-between gap-2">
            <span class="font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(entry.name)}</span>
            <span class="shrink-0 rounded-full bg-indigo-50 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">${escapeHtml(entry.category)}</span>
          </div>
          <p class="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">${escapeHtml(entry.description || 'No description provided.')}</p>
        </div>
      `).join('');
      refreshTopMenuPanels();
    }

    // --- Core Parser logic ---
    function parseAndRender() {
      const text = fullSyntaxText;
      if (!text.trim()) {
        emptyState.classList.remove('hidden');
        const personaCard = document.getElementById('persona-filter-card');
        const tagCard = document.getElementById('tag-filter-card');
        const glossaryCard = document.getElementById('glossary-card');
        const tagResultsSummary = document.getElementById('tag-results-summary');
        const tagResultsList = document.getElementById('tag-results-list');
        const glossaryList = document.getElementById('glossary-list');
        if (personaCard) personaCard.classList.add('hidden');
        if (tagCard) tagCard.classList.add('hidden');
        if (glossaryCard) glossaryCard.classList.add('hidden');
        hasPersonaMenu = false;
        hasTagMenu = false;
        hasGlossaryMenu = false;
        activeTopMenu = null;
        if (tagResultsSummary) tagResultsSummary.textContent = 'Select a tag to list matching cards';
        if (tagResultsList) tagResultsList.innerHTML = '';
        if (glossaryList) glossaryList.innerHTML = '';
        document.getElementById('tree-branches').innerHTML = '';
        document.getElementById('tree-nodes').innerHTML = '';
        document.getElementById('cross-connections').innerHTML = '';
        document.getElementById('nav-connections').innerHTML = '';
        document.getElementById('header-diagram-title').innerText = "Untitled Diagram";
        refreshTopMenuPanels();
        return;
      }
      emptyState.classList.add('hidden');

      const lines = text.split('\n');
      const nodes = [];
      let parseError = null;

      // Track precise character index positions for every line to allow sync scrolling
      let currentPos = 0;
      const lineOffsets = [];
      lines.forEach((line) => {
        lineOffsets.push({ start: currentPos, end: currentPos + line.length });
        currentPos += line.length + 1; // +1 to account for newline character
      });

      // Dynamic Title Variable
      let diagramTitle = "Untitled Diagram";

      // Keep track of all declared unique personas
      const declaredPersonas = new Map();

      // FIRST PASS: Parse metadata (like title:, persona:) and build a directory of declared elements.
      const declaredElements = {};

      lines.forEach((rawLine) => {
        const lineStr = rawLine.replace(/\r/g, '');
        if (!lineStr.trim() || lineStr.trim().startsWith('#') || lineStr.trim().startsWith('//')) {
          return;
        }

        const cleanLine = lineStr.trim();
        
        // Scan for title metadata tag
        if (cleanLine.toLowerCase().startsWith('title:')) {
          diagramTitle = cleanLine.substring(6).trim();
          return;
        }

        // Scan for declared personas
        if (cleanLine.toLowerCase().startsWith('persona:')) {
          const personaRest = cleanLine.substring(8).trim();
          let personaLabel = personaRest;
          let personaRawAttr = '';
          const personaAttrMatch = personaRest.match(/\{([^}]+)\}$/);
          if (personaAttrMatch) {
            personaRawAttr = personaAttrMatch[1].trim();
            personaLabel = personaRest.substring(0, personaRest.lastIndexOf('{')).trim();
          }

          if (personaLabel) {
            const personaAttributes = parseAttributes(personaRawAttr, declaredPersonas);
            registerPersonaValue(personaLabel, declaredPersonas, personaAttributes.description || personaAttributes.comment);
          }
          return;
        }

        const colonIndex = cleanLine.indexOf(':');
        if (colonIndex === -1) return;

        const type = cleanLine.substring(0, colonIndex).trim().toLowerCase();
        const rest = cleanLine.substring(colonIndex + 1).trim();

        let label = rest;
        let rawAttr = '';
        const attrMatch = rest.match(/\{([^}]+)\}$/);
        if (attrMatch) {
          rawAttr = attrMatch[1].trim();
          label = rest.substring(0, rest.lastIndexOf('{')).trim();
        }

        const attributes = parseAttributes(rawAttr, declaredPersonas);
        const customId = attributes.customIdSet ? attributes.id : '';
        const status = attributes.status;
        const flags = attributes.flags;
        const nodePersonas = attributes.personas;
        const comment = attributes.comment;
        const description = attributes.description || attributes.comment;
        const href = attributes.href;
        const condition = attributes.condition;
        const action = attributes.action;
        const hasStatusSet = attributes.hasStatusSet;
        const hasFlagsSet = attributes.hasFlagsSet;

        // Parse priority index matching:
        // Do not overwrite previous explicit "element:" metadata labels with inline leaf overwrites
        if (customId && label !== '') {
          const existing = declaredElements[customId];
          if (!existing) {
            declaredElements[customId] = {
              type,
              label,
              status,
              flags,
              personas: nodePersonas,
              description,
              comment,
              href,
              condition,
              action,
              hasStatusSet,
              hasFlagsSet
            };
          } else if (existing.type !== 'element' && type === 'element') {
            // Explicit "element:" declarations take absolute naming priority over standard leaf definitions
            declaredElements[customId] = {
              type,
              label,
              status,
              flags,
              personas: nodePersonas,
              description,
              comment,
              href,
              condition,
              action,
              hasStatusSet,
              hasFlagsSet
            };
          }
        }
      });

      // Update Screen Header Title
      document.getElementById('header-diagram-title').innerText = diagramTitle;

      // Update Persona Dropdown Selector Overlay
      updatePersonaDropdown(declaredPersonas);
      updateGlossaryCard(buildGlossaryEntries(declaredElements, declaredPersonas));

      // SECOND PASS: Parse final visual tree hierarchies and resolve references
      lines.forEach((rawLine, index) => {
        const lineStr = rawLine.replace(/\r/g, '');
        if (!lineStr.trim() || lineStr.trim().startsWith('#') || lineStr.trim().startsWith('//')) {
          return;
        }

        const cleanLine = lineStr.trim();
        
        // Skip metadata lines in Pass 2
        if (cleanLine.toLowerCase().startsWith('title:') || cleanLine.toLowerCase().startsWith('persona:')) {
          return;
        }

        const indentMatch = lineStr.match(/^(\s*)/);
        const indentLength = indentMatch ? indentMatch[1].length : 0;

        const colonIndex = cleanLine.indexOf(':');
        if (colonIndex === -1) {
          parseError = `Line ${index + 1}: Format must look like 'type: Label' or 'type: {id: ID}'`;
          return;
        }

        const type = cleanLine.substring(0, colonIndex).trim().toLowerCase();
        const rest = cleanLine.substring(colonIndex + 1).trim();

        let label = rest;
        let rawAttr = '';
        const attrMatch = rest.match(/\{([^}]+)\}$/);
        if (attrMatch) {
          rawAttr = attrMatch[1].trim();
          label = rest.substring(0, rest.lastIndexOf('{')).trim();
        }

        const attributes = parseAttributes(rawAttr, declaredPersonas, {
          ...createAttributeState(),
          id: `node-${index}`
        });

        let resolvedType = type;
        let resolvedLabel = label;
        let resolvedStatus = attributes.status;
        let resolvedFlags = attributes.flags;
        let resolvedPersonas = attributes.personas;
        let resolvedComment = attributes.comment;
        let resolvedHref = attributes.href;
        let resolvedCondition = attributes.condition;
        let resolvedAction = attributes.action;
        let hasCustomId = attributes.customIdSet;

        if (attributes.customIdSet && declaredElements[attributes.id]) {
          const stored = declaredElements[attributes.id];

          // Use stored type if current type is blank (strictly preserve 'element' tags)
          if (type === '' && stored.type !== 'element') {
            resolvedType = stored.type;
          }

          if (label === "") {
            resolvedLabel = stored.label;
          }

          if (!attributes.hasStatusSet && stored.hasStatusSet) {
            resolvedStatus = stored.status;
          }

          if (!attributes.hasFlagsSet && stored.hasFlagsSet) {
            resolvedFlags = stored.flags;
          }

          // Inherit personas if none defined on the local reference override
          if (attributes.personas.length === 0 && stored.personas && stored.personas.length > 0) {
            resolvedPersonas = stored.personas;
          }

          // Inherit comments if none defined on the local reference override
          if (!attributes.comment && stored.comment) {
            resolvedComment = stored.comment;
          }

          // Inherit href if none defined locally
          if (!attributes.href && stored.href) {
            resolvedHref = stored.href;
          }

          if (!attributes.condition && stored.condition) {
            resolvedCondition = stored.condition;
          }

          if (!attributes.action && stored.action) {
            resolvedAction = stored.action;
          }
        } else if (label === "" && attributes.customIdSet) {
          resolvedLabel = `[${attributes.id}]`;
        }

        nodes.push({
          index,
          indent: indentLength,
          type: resolvedType,
          label: resolvedLabel,
          id: attributes.id,
          hasCustomId: hasCustomId,
          status: resolvedStatus,
          flags: resolvedFlags,
          personas: resolvedPersonas,
          comment: resolvedComment,
          href: resolvedHref,
          condition: resolvedCondition,
          action: resolvedAction,
          lineStart: lineOffsets[index].start,
          lineEnd: lineOffsets[index].end,
          hidden: true, // Default to true so collapsed branches do not leak undefined rendering parameters
          children: [],
          parent: null
        });
      });

      if (parseError) {
        showError(parseError);
        return;
      }

      hideError();

      // Build hierarchical structure tree
      const rootNodes = [];
      const stack = [];

      nodes.forEach(node => {
        while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) {
          stack.pop();
        }

        if (stack.length === 0) {
          node.indexInParent = rootNodes.length;
          rootNodes.push(node);
        } else {
          const parent = stack[stack.length - 1];
          node.indexInParent = parent.children.length;
          parent.children.push(node);
          node.parent = parent;
        }
        stack.push(node);
      });

      // Generate stable recursive paths IDs
      rootNodes.forEach((root, idx) => {
        root.indexInParent = idx;
        assignPaths(root, "");
      });

      // Clean up deleted node selection
      activeNodes = nodes;
      updateTagDropdown(activeNodes);
      const selectExists = activeNodes.some(n => n.pathId === selectedNodePathId);
      if (!selectExists) {
        selectedNodePathId = null;
      }

      // Draw the Diagram tree
      renderTree(rootNodes);
      populateInspector();
    }

    // --- Dynamic Persona Dropdown Manager ---
    function updatePersonaDropdown(personasMap) {
      const card = document.getElementById('persona-filter-card');
      const select = document.getElementById('personaSelect');
      
      if (!select) return;
      if (personasMap.size === 0) {
        hasPersonaMenu = false;
        if (card) card.classList.add('hidden');
        refreshTopMenuPanels();
        return;
      }
      
      hasPersonaMenu = true;
      if (card) card.classList.remove('hidden');
      const previousSelection = selectedPersona;
      
      select.innerHTML = '<option value="all">👥 Show All Personas</option>';
      Array.from(personasMap.values())
        .sort((left, right) => left.name.localeCompare(right.name))
        .forEach(persona => {
        const option = document.createElement('option');
        option.value = persona.name;
        option.textContent = `👤 ${persona.name}`;
        if (persona.name === previousSelection) {
          option.selected = true;
        }
        select.appendChild(option);
      });

      const availablePersonaKeys = new Set(Array.from(personasMap.keys()));
      if (previousSelection !== 'all' && !availablePersonaKeys.has(normalizePersonaValue(previousSelection))) {
        selectedPersona = 'all';
      }
      refreshTopMenuPanels();
    }

    function updateTagDropdown(nodes) {
      const card = document.getElementById('tag-filter-card');
      const select = document.getElementById('tagSelect');
      const summary = document.getElementById('tag-results-summary');
      const resultsList = document.getElementById('tag-results-list');

      if (!select || !summary || !resultsList) return;

      const availableTags = new Map();
      nodes.forEach(node => {
        if (!node.flags || node.flags.length === 0) return;

        node.flags.forEach(flag => {
          const tagKey = normalizeTagValue(flag);
          if (tagKey && !availableTags.has(tagKey)) {
            availableTags.set(tagKey, flag);
          }
        });
      });

      if (availableTags.size === 0) {
        hasTagMenu = false;
        if (card) card.classList.add('hidden');
        selectedTag = 'all';
        summary.textContent = 'Select a tag to list matching cards';
        resultsList.innerHTML = '';
        refreshTopMenuPanels();
        return;
      }

      hasTagMenu = true;
      if (card) card.classList.remove('hidden');
      const previousSelection = selectedTag;

      select.innerHTML = '<option value="all">🏷 Show All Tags</option>';
      Array.from(availableTags.values())
        .sort((left, right) => left.localeCompare(right))
        .forEach(tag => {
          const option = document.createElement('option');
          option.value = tag;
          option.textContent = `🏷 ${tag}`;
          if (normalizeTagValue(tag) === normalizeTagValue(previousSelection)) {
            option.selected = true;
          }
          select.appendChild(option);
        });

      if (previousSelection !== 'all' && !availableTags.has(normalizeTagValue(previousSelection))) {
        selectedTag = 'all';
        select.value = 'all';
      }

      updateTagResultsList(nodes);
      refreshTopMenuPanels();
    }

    function updateTagResultsList(nodes) {
      const summary = document.getElementById('tag-results-summary');
      const resultsList = document.getElementById('tag-results-list');

      if (!summary || !resultsList) return;

      if (selectedTag === 'all') {
        summary.textContent = 'Select a tag to list matching cards';
        resultsList.innerHTML = '<p class="text-slate-400 italic">All cards remain visible until you choose a tag.</p>';
        return;
      }

      const matches = nodes.filter(node => matchesSelectedPersona(node) && matchesSelectedTag(node));
      const matchCount = matches.length;
      summary.textContent = `${matchCount} card${matchCount === 1 ? '' : 's'} tagged #${selectedTag}`;

      if (matchCount === 0) {
        resultsList.innerHTML = '<p class="text-slate-400 italic">No cards match the selected tag.</p>';
        return;
      }

      resultsList.innerHTML = matches.map(node => `
        <button onclick="focusNodeByPath('${node.pathId}')" class="w-full text-left p-2 rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 hover:border-brand-200 dark:hover:border-brand-700 hover:bg-white dark:hover:bg-slate-900 transition-colors">
          <div class="flex items-center justify-between gap-2">
            <span class="truncate font-semibold text-slate-700 dark:text-slate-200" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</span>
            <span class="shrink-0 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">${escapeHtml(node.type)}</span>
          </div>
        </button>
      `).join('');
    }

    function setPersonaFilter(value) {
      selectedPersona = value;
      parseAndRender();
    }

    function setTagFilter(value) {
      selectedTag = value;
      parseAndRender();
    }

    // --- Layout & Rendering Algorithm ---
    function renderTree(roots) {
      const gBranches = document.getElementById('tree-branches');
      const gNodes = document.getElementById('tree-nodes');
      const gCrossConnections = document.getElementById('cross-connections');
      const gNavConnections = document.getElementById('nav-connections');

      if (!gBranches || !gNodes || !gCrossConnections || !gNavConnections) return;

      // Clear layers
      gBranches.innerHTML = '';
      gNodes.innerHTML = '';
      gCrossConnections.innerHTML = '';
      gNavConnections.innerHTML = '';

      if (roots.length === 0) return;

      // Track layouts
      const leafTracker = { count: 0, cursor: 40, previousLeaf: null };
      
      // Calculate coordinates dynamically respecting expanded/collapsed and persona states
      roots.forEach(root => {
        assignPositions(root, 0, leafTracker);
      });

      // Render hierarchical connectors/branches
      roots.forEach(root => {
        drawBranches(root, gBranches);
      });

      // Render physical interactive cards (filtering out hidden ones)
      activeNodes.forEach(node => {
        if (!node.hidden) {
          drawNodeCard(node, gNodes);
        }
      });

      // Find and Render cross connection links between reusable fields of same ID
      drawSharedConnections(gCrossConnections);

      // Find and Render navigation pointer links (href pointers)
      drawNavigationConnections(gNavConnections);

      // Dynamically adapt global expand/collapse tooltips
      const btnExpand = document.getElementById('btn-global-expand');
      const btnCollapse = document.getElementById('btn-global-collapse');
      if (btnExpand && btnCollapse) {
        if (selectedNodePathId) {
          const selectedNode = activeNodes.find(n => n.pathId === selectedNodePathId);
          const label = selectedNode ? `"${selectedNode.label}"` : 'Selected Element';
          btnExpand.setAttribute('title', `Expand Selected Branch: ${label}`);
          btnCollapse.setAttribute('title', `Collapse Selected Branch: ${label}`);
          btnExpand.classList.add('text-indigo-500', 'dark:text-indigo-400');
          btnCollapse.classList.add('text-indigo-500', 'dark:text-indigo-400');
        } else {
          btnExpand.setAttribute('title', 'Expand All (Whole Model)');
          btnCollapse.setAttribute('title', 'Collapse All (Whole Model)');
          btnExpand.classList.remove('text-indigo-500', 'dark:text-indigo-400');
          btnCollapse.classList.remove('text-indigo-500', 'dark:text-indigo-400');
        }
      }
    }

    // Positioning algorithm - optimized to prevent trailing hidden elements from counting as visible leaves
    // Packed extremely close together to offer compact layout sizing!
    function assignPositions(node, depth, tracker) {
      // 1. If an ancestor is collapsed, or this node doesn't match active personas, flag as hidden
      if (isNodeHidden(node) || !matchesActiveFilters(node)) {
        node.hidden = true;
        return;
      }
      node.hidden = false;
      node.depth = depth;

      // 2. Identify visible children that match the active quick filters and are not collapsed
      const visibleChildrenByFilter = node.children.filter(child => matchesActiveFilters(child));
      const hasVisibleChildren = visibleChildrenByFilter.length > 0 && !collapsedPaths.has(node.pathId);

      const dimensions = getNodeDimensions(node.type);
      node.width = dimensions.width;
      node.height = dimensions.height;

      if (!hasVisibleChildren) {
        // If node has no visible child branches (or is collapsed), it acts as a visual leaf terminal
        node.leafIndex = tracker.count;
        tracker.count += 1;
        placeLeafNode(node, depth, tracker);
      } else {
        // Recursively position active child paths ONLY
        node.children.forEach(child => {
          assignPositions(child, depth + 1, tracker);
        });

        // 3. Center this node precisely between its VISIBLE child cards
        const visibleChildren = node.children.filter(c => !c.hidden);
        if (visibleChildren.length > 0) {
          const firstChild = visibleChildren[0];
          const lastChild = visibleChildren[visibleChildren.length - 1];
          const firstChildCenterY = firstChild.y + (firstChild.height / 2);
          const lastChildCenterY = lastChild.y + (lastChild.height / 2);
          const firstChildCenterX = firstChild.x + (firstChild.width / 2);
          const lastChildCenterX = lastChild.x + (lastChild.width / 2);

          if (orientation === 'horizontal') {
            node.x = depth * getLayoutDepthStep() + 50;
            node.y = ((firstChildCenterY + lastChildCenterY) / 2) - (node.height / 2);
          } else {
            node.x = ((firstChildCenterX + lastChildCenterX) / 2) - (node.width / 2);
            node.y = depth * getLayoutDepthStep() + 40;
          }
        } else {
          // Fallback if children calculated as hidden during recursive resolution
          node.leafIndex = tracker.count;
          tracker.count += 1;
          placeLeafNode(node, depth, tracker);
        }
      }
    }

    // Draws hierarchical layout branch connectors
    function drawBranches(node, svgGroup) {
      if (node.hidden || collapsedPaths.has(node.pathId)) return;

      // Draw the VisVocab choice-semantics badge at the output of branch/selector/cluster nodes.
      const choiceBadge = getChoiceBadgeSpec(node.type);
      if (choiceBadge && node.children.some(c => !c.hidden)) {
        drawChoiceBadge(node, choiceBadge, svgGroup);
      }

      node.children.forEach(child => {
        if (child.hidden) return;
        
        let pathData = '';
        let startX = 0;
        let startY = 0;
        let endX = 0;
        let endY = 0;
        if (orientation === 'horizontal') {
          startX = node.x + node.width;
          startY = node.y + (node.height / 2);
          endX = child.x;
          endY = child.y + (child.height / 2);
          const horizontalGap = Math.max(0, endX - startX);
          const bendOffset = Math.max(14, Math.min(40, horizontalGap / 2));
          const cpX1 = startX + bendOffset;
          const cpX2 = endX - bendOffset;
          pathData = `M ${startX} ${startY} C ${cpX1} ${startY}, ${cpX2} ${endY}, ${endX} ${endY}`;
        } else {
          startX = node.x + (node.width / 2);
          startY = node.y + node.height;
          endX = child.x + (child.width / 2);
          endY = child.y;
          const verticalGap = Math.max(0, endY - startY);
          const bendOffset = Math.max(14, Math.min(32, verticalGap / 2));
          const cpY1 = startY + bendOffset;
          const cpY2 = endY - bendOffset;
          pathData = `M ${startX} ${startY} C ${startX} ${cpY1}, ${endX} ${cpY2}, ${endX} ${endY}`;
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        const conditionalConnector = isConditionalConnector(node, child);
        const navigationConnector = isFlowNavigationNodeType(node.type) || isFlowNavigationNodeType(child.type);
        // Non-exclusive selector paths (dashed cyan) vs. "presented together" cluster paths (solid fuchsia).
        const selectorOutgoing = node.type === 'selector';
        const clusterOutgoing = node.type === 'cluster' && !isConditionalNodeType(child.type);

        let strokeClass;
        if (clusterOutgoing) {
          strokeClass = 'stroke-fuchsia-400 dark:stroke-fuchsia-600';
        } else if (selectorOutgoing) {
          strokeClass = 'stroke-cyan-400 dark:stroke-cyan-600';
        } else if (navigationConnector) {
          strokeClass = 'stroke-indigo-300 dark:stroke-indigo-600';
        } else {
          strokeClass = 'stroke-slate-300 dark:stroke-slate-600';
        }
        path.setAttribute('class', `${strokeClass} fill-none transition-all`);
        path.setAttribute('stroke-width', (conditionalConnector || clusterOutgoing) ? '2' : '1.5');
        if (conditionalConnector) {
          path.setAttribute('stroke-dasharray', '6,4');
        }
        if (shouldRenderArrowHead(node, child)) {
          path.setAttribute('marker-end', document.documentElement.classList.contains('dark') ? 'url(#arrow-dark)' : 'url(#arrow)');
        }
        svgGroup.appendChild(path);

        const connectorLabel = getConnectorLabel(child);
        if (connectorLabel) {
          const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          const labelX = (startX + endX) / 2;
          const labelY = orientation === 'horizontal' ? ((startY + endY) / 2) - 10 : ((startY + endY) / 2) - 12;
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(labelX));
          text.setAttribute('y', String(labelY));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          text.setAttribute('font-size', '10');
          text.setAttribute('font-weight', '700');
          // Selector paths are non-exclusive -> tint their condition pills cyan to distinguish
          // from a branch's mutually-exclusive (rose) paths.
          let textClass, rectClass;
          if (selectorOutgoing && child.condition) {
            textClass = 'fill-cyan-700 dark:fill-cyan-300';
            rectClass = 'fill-cyan-50 dark:fill-cyan-950/90 stroke-cyan-200 dark:stroke-cyan-800';
          } else if (child.condition) {
            textClass = 'fill-rose-600 dark:fill-rose-300';
            rectClass = 'fill-rose-50 dark:fill-rose-950/90 stroke-rose-200 dark:stroke-rose-800';
          } else {
            textClass = 'fill-sky-600 dark:fill-sky-300';
            rectClass = 'fill-sky-50 dark:fill-sky-950/90 stroke-sky-200 dark:stroke-sky-800';
          }
          text.setAttribute('class', textClass);
          text.textContent = connectorLabel;

          const estimatedWidth = Math.max(44, connectorLabel.length * 6.5 + 12);
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', String(labelX - estimatedWidth / 2));
          rect.setAttribute('y', String(labelY - 9));
          rect.setAttribute('width', String(estimatedWidth));
          rect.setAttribute('height', '18');
          rect.setAttribute('rx', '9');
          rect.setAttribute('class', rectClass);

          labelGroup.appendChild(rect);
          labelGroup.appendChild(text);
          svgGroup.appendChild(labelGroup);
        }

        drawBranches(child, svgGroup);
      });
    }

    // Small pill rendered at the output of a branch/selector/cluster node describing how many
    // of its downstream paths are presented (VisVocab choice semantics).
    function drawChoiceBadge(node, spec, svgGroup) {
      let cx, cy;
      if (orientation === 'horizontal') {
        cx = node.x + node.width + 4;
        cy = node.y + (node.height / 2) - 15;
      } else {
        cx = node.x + node.width / 2 + 18;
        cy = node.y + node.height + 4;
      }

      const badgeWidth = Math.max(30, spec.text.length * 6 + 14);
      const badgeHeight = 15;

      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(cx));
      rect.setAttribute('y', String(cy - badgeHeight / 2));
      rect.setAttribute('width', String(badgeWidth));
      rect.setAttribute('height', String(badgeHeight));
      rect.setAttribute('rx', '7.5');
      rect.setAttribute('class', `${spec.pill} transition-all`);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', String(cx + badgeWidth / 2));
      text.setAttribute('y', String(cy + 0.5));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '9');
      text.setAttribute('font-weight', '700');
      text.setAttribute('letter-spacing', '0.02em');
      text.setAttribute('class', spec.label);
      text.textContent = spec.text;

      group.appendChild(rect);
      group.appendChild(text);
      svgGroup.appendChild(group);
    }

    // Toggle Collapse of parent node
    function toggleNodeCollapse(pathId) {
      if (collapsedPaths.has(pathId)) {
        collapsedPaths.delete(pathId);
      } else {
        collapsedPaths.add(pathId);
      }
      parseAndRender();
    }

    // Pan viewport smoothly to focus on an arbitrary Node ID string
    function scrollToNodeId(targetId) {
      if (!targetId) return;
      const target = activeNodes.find(n => n.id === targetId && !n.hidden);
      if (target) {
        centerOnNode(target);
        selectNode(target.pathId);
      }
    }

    // Creates interactive styled SVG visual boxes for tree nodes
    function drawNodeCard(node, svgGroup) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      g.setAttribute('class', 'group node-transition');
      g.setAttribute('id', `dom-node-${node.index}`);

      const spec = getFlowNodeSpec(node);
      const isStructural = isStructuralNodeType(node.type);
      const isSpecialFlowNode = isSpecialFlowNodeType(node.type);

      // Handle custom statuses
      let statusStyle = '';
      let badgeHtml = '';
      if (node.status && node.status !== 'default') {
        switch (node.status) {
          case 'success':
            statusStyle = 'ring-2 ring-emerald-500/50 shadow-md shadow-emerald-500/5';
            badgeHtml = `<span class="bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Success</span>`;
            break;
          case 'warning':
            statusStyle = 'ring-2 ring-amber-500/50 shadow-md shadow-emerald-500/5';
            badgeHtml = `<span class="bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Warning</span>`;
            break;
          case 'danger':
            statusStyle = 'ring-2 ring-rose-500/50 shadow-md shadow-rose-500/5';
            badgeHtml = `<span class="bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Danger</span>`;
            break;
          case 'error':
            statusStyle = 'ring-2 ring-red-500/60 shadow-md shadow-red-500/10 dark:ring-red-500/80';
            badgeHtml = `<span class="bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider">Error</span>`;
            break;
          case 'info':
            statusStyle = 'ring-2 ring-sky-500/50 shadow-md shadow-sky-500/5';
            badgeHtml = `<span class="bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Info</span>`;
            break;
          case 'draft':
            statusStyle = 'opacity-65 border-dashed border-2';
            badgeHtml = `<span class="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase">Draft</span>`;
            break;
        }
      }

      // Selection override styling
      const isSelected = (selectedNodePathId === node.pathId);
      if (isSelected) {
        statusStyle += ' ring-4 ring-brand-500/80 shadow-indigo-500/10 shadow-xl z-40';
      }

      const totalInstances = activeNodes.filter(n => n.id === node.id).length;
      const isReused = totalInstances > 1 && node.hasCustomId;
      const sharedIndicatorHtml = isReused 
        ? `<div class="flex items-center space-x-0.5 text-indigo-500 dark:text-indigo-400 font-semibold text-[9px]" title="This unique field is reused across your tree.">
             <span class="material-symbols-outlined text-[14px]">link</span>
             <span>x${totalInstances}</span>
           </div>`
        : '';

      // Inline Expand / Collapse button on parent nodes
      let collapseBtnHtml = '';
      let floatingCollapseBtnHtml = '';
      if (node.children.length > 0) {
        const isCollapsed = collapsedPaths.has(node.pathId);
        collapseBtnHtml = `
          <button onclick="event.stopPropagation(); toggleNodeCollapse('${node.pathId}')" 
                  class="p-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 transition-all flex items-center justify-center text-slate-500 dark:text-slate-300 shrink-0" 
                  title="${isCollapsed ? 'Expand Children' : 'Collapse Children'}">
            <span class="material-symbols-outlined text-[16px]">${isCollapsed ? 'expand_content' : 'collapse_content'}</span>
          </button>
        `;
        floatingCollapseBtnHtml = `
          <button onclick="event.stopPropagation(); toggleNodeCollapse('${node.pathId}')" 
                  class="p-1 rounded-full border border-slate-300/90 dark:border-slate-500 bg-white/95 dark:bg-slate-900/95 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-lg backdrop-blur-sm transition-all flex items-center justify-center text-slate-700 dark:text-slate-100 shrink-0" 
                  title="${isCollapsed ? 'Expand Children' : 'Collapse Children'}">
            <span class="material-symbols-outlined text-[16px]">${isCollapsed ? 'expand_content' : 'collapse_content'}</span>
          </button>
        `;
      }

      // Flags pill badges
      let flagsHtml = '';
      if (node.flags && node.flags.length > 0) {
        flagsHtml = `<div class="flex flex-wrap gap-1">
          ${node.flags.map(f => `<span class="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1 py-0.5 rounded text-[8px] font-medium tracking-wide font-sans">#${f}</span>`).join('')}
        </div>`;
      }

      // Render personas limit constraints directly in card body
      let personasHtml = '';
      if (node.personas && node.personas.length > 0) {
        personasHtml = `
          <div class="flex items-center space-x-1 text-[8px] text-indigo-500 dark:text-indigo-400 font-bold truncate max-w-[140px]" title="Access Persona: ${node.personas.join(', ')}">
            <span class="material-symbols-outlined text-[10px] shrink-0 mr-0.5">person</span>
            <span class="truncate">${node.personas.join(', ')}</span>
          </div>
        `;
      }

      // Display Helper Info Icon with hover tooltip when comments exist
      let commentHtml = '';
      if (node.comment) {
        const escapedComment = escapeHtml(node.comment);
        commentHtml = `
          <span class="material-symbols-outlined text-[14px] text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 shrink-0 cursor-help select-none transition-colors" 
                title="${escapedComment}">
            info
          </span>
        `;
      }

      // Navigation href quick jump button on card
      let hrefLinkHtml = '';
      if (node.href) {
        hrefLinkHtml = `
          <button onclick="event.stopPropagation(); scrollToNodeId('${node.href}')" 
                  class="p-0.5 rounded bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900 transition-colors flex items-center justify-center shrink-0" 
                  title="Follow navigation path to: ${escapeHtml(node.href)}">
            <span class="material-symbols-outlined text-[13px]">arrow_right_alt</span>
          </button>
        `;
      }

      const foreignObject = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      foreignObject.setAttribute('width', String(node.width));
      const extraForeignObjectHeight = flagsHtml
        ? (isSpecialFlowNode ? 58 : 32)
        : (isSpecialFlowNode ? 44 : 25);
      foreignObject.setAttribute('height', String(node.height + extraForeignObjectHeight));

      // Design distinct layout profiles based on Structural nodes (Page/Group) vs Slim Leaf nodes
      let cardInnerHtml = '';

      if (isSpecialFlowNode) {
        const shapeStyle = [
          `height: ${node.height}px`,
          'display: flex',
          'align-items: center',
          'justify-content: center',
          'text-align: center',
          'padding: 10px',
          `border-radius: ${spec.borderRadius}`,
          spec.clipPath ? `clip-path: ${spec.clipPath}` : '',
          spec.clipPath ? `-webkit-clip-path: ${spec.clipPath}` : ''
        ].filter(Boolean).join('; ');

        const topBadgeHtml = node.condition
          ? `<div class="absolute top-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/90 border border-rose-200 dark:border-rose-800 text-[8px] font-bold text-rose-600 dark:text-rose-300 max-w-[120px] truncate z-10">${escapeHtml(node.condition)}</div>`
          : (node.action
            ? `<div class="absolute top-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/90 border border-sky-200 dark:border-sky-800 text-[8px] font-bold text-sky-600 dark:text-sky-300 max-w-[120px] truncate z-10">${escapeHtml(node.action)}</div>`
            : '');

        cardInnerHtml = `
          <div xmlns="http://www.w3.org/1999/xhtml" class="relative w-full h-full overflow-visible">
            ${topBadgeHtml}
            <div class="w-full border ${spec.border} ${spec.bg} ${statusStyle} shadow-sm dark:shadow-slate-950/20 cursor-pointer relative overflow-hidden" 
                style="${shapeStyle}"
                onclick="handleNodeClick(event, '${node.pathId}', ${node.lineStart}, ${node.lineEnd})"
                onmouseenter="handleNodeHover('${node.id}', true)" 
                onmouseleave="handleNodeHover('${node.id}', false)">
             <div class="flex flex-col items-center justify-center gap-1 w-full h-full px-2">
               <span class="material-symbols-outlined text-[18px] ${spec.typeClass}">${spec.icon}</span>
               ${node.label ? `<span class="font-bold text-[10px] leading-tight ${spec.labelClass} max-w-full break-words">${escapeHtml(node.label)}</span>` : ''}
               <span class="text-[8px] uppercase font-mono tracking-wide ${spec.typeClass}">${escapeHtml(node.type)}</span>
             </div>
             <div class="absolute top-2 right-2 flex items-center space-x-1">
               ${commentHtml}
               ${hrefLinkHtml}
             </div>
             ${sharedIndicatorHtml ? `<div class="absolute bottom-1.5 left-2">${sharedIndicatorHtml}</div>` : ''}
            </div>
            ${flagsHtml ? `<div class="absolute -bottom-4 left-3 right-3">${flagsHtml}</div>` : ''}
            ${floatingCollapseBtnHtml ? `<div class="absolute top-1/2 right-1 z-30 -translate-y-1/2">${floatingCollapseBtnHtml}</div>` : ''}
          </div>
        `;
      } else if (isStructural) {
        // High Contrast structural layout with extra room for persona metadata
        cardInnerHtml = `
          <div xmlns="http://www.w3.org/1999/xhtml" class="p-2 rounded-xl border ${spec.border} ${spec.bg} ${statusStyle} select-none shadow-sm relative group-hover:shadow-lg dark:shadow-slate-950/20 cursor-pointer" 
              style="height: 76px; display: flex; flex-direction: column; justify-content: space-between;"
               onclick="handleNodeClick(event, '${node.pathId}', ${node.lineStart}, ${node.lineEnd})"
               onmouseenter="handleNodeHover('${node.id}', true)" 
               onmouseleave="handleNodeHover('${node.id}', false)">
             
            <div class="absolute left-0 top-2 bottom-2 w-1 rounded-r-md ${spec.accent}"></div>
             
            <div class="flex items-start justify-between w-full overflow-hidden">
              <div class="flex flex-col truncate pr-2 w-full">
                <div class="flex items-center space-x-1.5 truncate w-full">
                  <span class="material-symbols-outlined text-[15px] text-slate-500">${spec.icon}</span>
                  <span class="font-bold text-[10px] truncate ${spec.labelClass}" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</span>
                  ${commentHtml}
                  ${hrefLinkHtml}
                </div>
                ${personasHtml}
              </div>
              ${sharedIndicatorHtml}
            </div>

            <div class="flex items-center justify-between mt-auto w-full">
              <span class="text-[8px] font-mono font-medium ${spec.typeClass} uppercase">${escapeHtml(node.type)}</span>
              <div class="flex items-center space-x-1.5 font-sans">
                ${badgeHtml}
                ${collapseBtnHtml}
              </div>
            </div>
            
            <!-- Flags Overlay positioned cleanly at bottom -->
            ${flagsHtml ? `<div class="absolute -bottom-3 left-2 right-2">${flagsHtml}</div>` : ''}
          </div>
        `;
      } else {
        // Compact leaf layout with room for tags and filter metadata
        cardInnerHtml = `
          <div xmlns="http://www.w3.org/1999/xhtml" class="p-2 rounded-lg border ${spec.border} ${spec.bg} ${statusStyle} select-none shadow-sm relative group-hover:shadow-lg dark:shadow-slate-950/20 cursor-pointer animate-none overflow-visible" 
               style="height: 44px; display: flex; align-items: center;"
               onclick="handleNodeClick(event, '${node.pathId}', ${node.lineStart}, ${node.lineEnd})"
               onmouseenter="handleNodeHover('${node.id}', true)" 
               onmouseleave="handleNodeHover('${node.id}', false)">
            
            <div class="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-md ${spec.accent}"></div>
            
            <div class="flex items-center justify-between w-full overflow-hidden">
              <!-- Label, Icon and comments -->
              <div class="flex items-center space-x-1.5 truncate pr-1">
                <span class="material-symbols-outlined text-[14px] text-slate-500 shrink-0">${spec.icon}</span>
                <span class="font-bold text-[10px] truncate ${spec.labelClass}" title="${escapeHtml(node.label)}">${escapeHtml(node.label)}</span>
                ${commentHtml}
                ${hrefLinkHtml}
              </div>

              <!-- Badges and controls aligned cleanly on right -->
              <div class="flex items-center space-x-1 shrink-0 font-sans">
                ${badgeHtml}
                ${personasHtml}
                ${collapseBtnHtml}
                ${sharedIndicatorHtml}
              </div>
            </div>
            ${flagsHtml ? `<div class="absolute -bottom-3 left-2 right-2">${flagsHtml}</div>` : ''}
          </div>
        `;
      }

      foreignObject.innerHTML = cardInnerHtml;
      g.appendChild(foreignObject);
      svgGroup.appendChild(g);
    }

    // --- Draw Reused Instance Connections (Arcs linking nodes with identical Custom IDs) ---
    function drawSharedConnections(svgGroup) {
      if (!showConnections) return;

      const sharedGroups = {};
      activeNodes.forEach(node => {
        // Only map elements that are currently visible/not hidden
        if (node.hasCustomId && !node.hidden) {
          if (!sharedGroups[node.id]) {
            sharedGroups[node.id] = [];
          }
          sharedGroups[node.id].push(node);
        }
      });

      let reusableLinesCount = 0;

      Object.keys(sharedGroups).forEach(id => {
        const instances = sharedGroups[id];
        if (instances.length <= 1) return;

        reusableLinesCount += (instances.length - 1);

        if (!idColorCache[id]) {
          idColorCache[id] = getBeautifulAccentColor(Object.keys(idColorCache).length);
        }
        const strokeColor = idColorCache[id];

        const isCurrentlyHighlighted = (hoveredNodeId === id);
        const strokeOpacity = isCurrentlyHighlighted ? '0.95' : '0.4';
        const strokeWidth = isCurrentlyHighlighted ? '3.5' : '1.8';
        const lineStyle = isCurrentlyHighlighted ? 'filter: url(#glow);' : '';

        for (let i = 0; i < instances.length - 1; i++) {
          const fromNode = instances[i];
          const toNode = instances[i + 1];

          let startX, startY, endX, endY, cp1X, cp1Y, cp2X, cp2Y;

          if (orientation === 'horizontal') {
            startX = fromNode.x + fromNode.width; 
            startY = fromNode.y + (fromNode.height / 2);
            endX = toNode.x;
            endY = toNode.y + (toNode.height / 2);

            const deltaX = Math.abs(endX - startX);
            const deltaY = Math.abs(endY - startY);
            cp1X = startX + deltaX * 0.5 + 40;
            cp1Y = startY + (endY > startY ? -20 : 20);
            cp2X = endX - deltaX * 0.5 - 40;
            cp2Y = endY + (endY > startY ? 20 : -20);
          } else {
            startX = fromNode.x + (fromNode.width / 2);
            startY = fromNode.y + fromNode.height;
            endX = toNode.x + (toNode.width / 2);
            endY = toNode.y;

            const deltaY = Math.abs(endY - startY);
            cp1X = startX + (endX > startX ? 40 : -40);
            cp1Y = startY + deltaY * 0.5 + 30;
            cp2X = endX + (endX > startX ? -40 : 40);
            cp2Y = endY - deltaY * 0.5 - 30;
          }

          const pathData = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', pathData);
          path.setAttribute('class', 'connection-line fill-none');
          path.setAttribute('stroke', strokeColor);
          path.setAttribute('stroke-width', strokeWidth);
          path.setAttribute('stroke-dasharray', isCurrentlyHighlighted ? '6,3' : '5,5');
          path.setAttribute('style', `opacity: ${strokeOpacity}; ${lineStyle}`);
          
          path.addEventListener('mouseenter', () => handleNodeHover(id, true));
          path.addEventListener('mouseleave', () => handleNodeHover(id, false));

          svgGroup.appendChild(path);
        }
      });

      // Safely update the reused badge metrics only if it exists in the DOM
      const reusedBadge = document.getElementById('reused-count-badge');
      if (reusedBadge) {
        reusedBadge.innerText = `${reusableLinesCount} shared links`;
      }
    }

    // --- Draw Navigation Link Connections (Teledotted pointers derived from href) ---
    function drawNavigationConnections(svgGroup) {
      activeNodes.forEach(node => {
        if (!node.href || node.hidden) return;

        const targetNode = activeNodes.find(n => n.id === node.href && !n.hidden);
        if (!targetNode) return;

        let startX, startY, endX, endY, cp1X, cp1Y, cp2X, cp2Y;

        if (orientation === 'horizontal') {
          // Exit from right edge of source card
          startX = node.x + node.width;
          startY = node.y + (node.height / 2);
          // Entry in left edge of target card
          endX = targetNode.x;
          endY = targetNode.y + (targetNode.height / 2);

          const deltaX = Math.abs(endX - startX);
          cp1X = startX + deltaX * 0.4 + 20;
          cp1Y = startY + (endY > startY ? 40 : -40);
          cp2X = endX - deltaX * 0.4 - 20;
          cp2Y = endY + (endY > startY ? -40 : 40);
        } else {
          // Exit bottom of source card
          startX = node.x + (node.width / 2);
          startY = node.y + node.height;
          // Entry top of target card
          endX = targetNode.x + (targetNode.width / 2);
          endY = targetNode.y;

          const deltaY = Math.abs(endY - startY);
          cp1X = startX + (endX > startX ? 50 : -50);
          cp1Y = startY + deltaY * 0.4 + 20;
          cp2X = endX + (endX > startX ? -50 : 50);
          cp2Y = endY - deltaY * 0.4 - 20;
        }

        const pathData = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;

        // Create elegant styled dotted curve with dedicated nav arrowhead
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('class', 'stroke-sky-500 dark:stroke-sky-400 fill-none opacity-70 hover:opacity-100 transition-opacity');
        path.setAttribute('stroke-width', '1.8');
        path.setAttribute('stroke-dasharray', '3,3');
        path.setAttribute('marker-end', 'url(#nav-arrow)');
        
        svgGroup.appendChild(path);
      });
    }

    // --- Hover Highlight System (Smooth ring outlines without structural jittering) ---
    function handleNodeHover(nodeId, isEntering) {
      if (!showConnections) return;
      hoveredNodeId = isEntering ? nodeId : null;

      activeNodes.forEach(node => {
        const cardDom = document.getElementById('dom-node-' + node.index);
        if (!cardDom) return;

        if (isEntering && node.id === nodeId && node.hasCustomId) {
          cardDom.classList.add('z-50');
          const innerCard = cardDom.querySelector('div');
          if (innerCard) {
            innerCard.classList.add('ring-4', 'ring-brand-500/50', 'dark:ring-indigo-400/80');
          }
        } else {
          const isSelected = (selectedNodePathId === node.pathId);
          cardDom.classList.remove('z-50');
          if (!isSelected) {
            const innerCard = cardDom.querySelector('div');
            if (innerCard) {
              innerCard.classList.remove('ring-4', 'ring-brand-500/50', 'dark:ring-indigo-400/80');
            }
          }
        }
      });

      const gCrossConnections = document.getElementById('cross-connections');
      if (gCrossConnections) {
        gCrossConnections.innerHTML = '';
        drawSharedConnections(gCrossConnections);
      }
    }

    // --- Global Expand/Collapse Controllers ---
    function handleGlobalCollapse() {
      if (selectedNodePathId) {
        collapsedPaths.add(selectedNodePathId);
      } else {
        activeNodes.forEach(node => {
          if (node.children && node.children.length > 0) {
            collapsedPaths.add(node.pathId);
          }
        });
      }
      parseAndRender();
    }

    function handleGlobalExpand() {
      if (selectedNodePathId) {
        collapsedPaths.delete(selectedNodePathId);
      } else {
        collapsedPaths.clear();
      }
      parseAndRender();
    }

    // --- Helpers & Visual Utilities ---
    function getBeautifulAccentColor(index) {
      const palette = [
        '#6366f1', // Indigo
        '#ec4899', // Pink
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#8b5cf6', // Violet
        '#ef4444', // Red
        '#06b6d4', // Cyan
        '#f97316', // Orange
      ];
      return palette[index % palette.length];
    }

    let typingTimer;
    function handleInputChange() {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        fullSyntaxText = syntaxInput.value;
        renderEditorText();
        parseAndRender();
        scheduleDraftSave();
      }, 250);
    }

    // Insert structural elements on click
    function insertTemplate(type) {
      expandAllTextFolds();
      const selectionStart = syntaxInput.selectionStart;
      const selectionEnd = syntaxInput.selectionEnd;
      const text = fullSyntaxText;

      let codeSnippet = '';
      switch (type) {
        case 'title':
          codeSnippet = 'title: My New Site Architecture\n';
          break;
        case 'persona':
          codeSnippet = 'persona: Admin\n';
          break;
        case 'element':
          codeSnippet = '\nelement: Master Field Name {id: field_id, flags: [reusable], comment: "Short guide description"}';
          break;
        case 'page':
          codeSnippet = '\npage: New View Screen';
          break;
        case 'group':
          codeSnippet = '\n  group: New Section Area';
          break;
        case 'field':
          codeSnippet = '\n    input: {id: field_id}';
          break;
        case 'button':
          codeSnippet = '\n    button: Submit Action {id: submit_id, status: success}';
          break;
        case 'decision':
          codeSnippet = '\n  decision: Condition met?';
          break;
        case 'branch':
          codeSnippet = '\n    branch: Choose downstream path {condition: "no"}';
          break;
        case 'reference':
          codeSnippet = '\n  reference: Reusable Flow {id: flow_ref, href: flow_id, action: "jump to flow"}';
          break;
      }

      setFullSyntaxText(text.slice(0, selectionStart) + codeSnippet + text.slice(selectionEnd));
      syntaxInput.focus();
      parseAndRender();
      scheduleDraftSave();
    }

    function clearEditor() {
      setFullSyntaxText('');
      selectedNodePathId = null;
      collapsedPaths.clear();
      selectedPersona = 'all';
      selectedTag = 'all';
      parseAndRender();
      persistDraftNow();
    }

    // loadTemplate function
    function loadTemplate(key) {
      if (templates[key]) {
        setFullSyntaxText(templates[key]);
        selectedNodePathId = null;
        collapsedPaths.clear();
        selectedPersona = 'all';
        selectedTag = 'all';
        parseAndRender();
        resetZoom();
        persistDraftNow();
      }
    }

    // --- Orientation Switch ---
    function setOrientation(orient) {
      orientation = orient;

      if (orient === 'horizontal') {
        if (btnOrientHorizontal) btnOrientHorizontal.className = "px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition-all bg-white dark:bg-slate-600 shadow-sm text-brand-600 dark:text-white";
        if (btnOrientVertical) btnOrientVertical.className = "px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition-all text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white";
      } else {
        if (btnOrientVertical) btnOrientVertical.className = "px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition-all bg-white dark:bg-slate-600 shadow-sm text-brand-600 dark:text-white";
        if (btnOrientHorizontal) btnOrientHorizontal.className = "px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition-all text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white";
      }

      parseAndRender();
    }

    // --- Connection Tracer lines toggle ---
    function toggleConnections() {
      showConnections = !showConnections;
      const dot = document.getElementById('connections-active-dot');
      if (showConnections) {
        if (btnToggleConnections) btnToggleConnections.className = "p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-indigo-50 dark:bg-slate-655 hover:bg-indigo-100 dark:hover:bg-slate-500 text-indigo-600 dark:text-white relative transition-colors";
        if (dot) dot.classList.remove('hidden');
      } else {
        if (btnToggleConnections) btnToggleConnections.className = "p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 relative transition-colors";
        if (dot) dot.classList.add('hidden');
      }
      parseAndRender();
    }

    // --- Set Zoom Level directly from dropdown selector ---
    function setZoomFromMenu(val) {
      zoomLevel = parseFloat(val);
      applyTransform();
    }

    // --- Synchronize the Dropdown value with the active zoom level ---
    function updateZoomSelect() {
      const select = document.getElementById('zoomSelect');
      if (!select) return;
      const pct = Math.round(zoomLevel * 100);
      select.value = zoomLevel.toFixed(2);
      
      let found = false;
      for (let i = 0; i < select.options.length; i++) {
        if (parseFloat(select.options[i].value).toFixed(2) === zoomLevel.toFixed(2)) {
          select.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        let customOpt = document.getElementById('zoom-custom-opt');
        if (!customOpt) {
          customOpt = document.createElement('option');
          customOpt.id = 'zoom-custom-opt';
          select.appendChild(customOpt);
        }
        customOpt.value = zoomLevel.toFixed(2);
        customOpt.textContent = `${pct}%`;
        select.value = zoomLevel.toFixed(2);
      }
    }

    function showError(msg) {
      const match = /^Line (\d+):/.exec(msg);
      const newLineIndex = match ? parseInt(match[1], 10) - 1 : null;
      const lineChanged = newLineIndex !== currentErrorLineIndex;
      currentErrorMessage = msg;
      currentErrorLineIndex = newLineIndex;

      // Keep an already-open popover's text in sync with the latest error.
      const msgEl = document.getElementById('error-message');
      if (msgEl) msgEl.innerText = msg;
      // Refresh the gutter marker only when the flagged line actually moves.
      if (lineChanged) renderEditorText();

      const badge = document.getElementById('parsing-badge');
      if (badge) {
        badge.className = "px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 flex items-center";
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1"></span> Error`;
      }
    }

    function hideError() {
      const hadError = currentErrorMessage !== null || currentErrorLineIndex !== null;
      currentErrorMessage = null;
      currentErrorLineIndex = null;
      closeErrorPopover();
      if (hadError) renderEditorText();

      const badge = document.getElementById('parsing-badge');
      if (badge) {
        badge.className = "px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 flex items-center";
        badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span> Sync Active`;
      }
    }

    // Open the syntax-hint popover anchored next to the clicked gutter error icon.
    function openErrorPopover(e) {
      if (e) e.stopPropagation();
      const popover = document.getElementById('error-popover');
      if (!popover || !currentErrorMessage) return;

      const msgEl = document.getElementById('error-message');
      if (msgEl) msgEl.innerText = currentErrorMessage;

      popover.classList.remove('hidden');

      const iconEl = e && e.currentTarget ? e.currentTarget : null;
      if (iconEl) {
        const iconRect = iconEl.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        let left = iconRect.right + 8;
        let top = iconRect.top - 4;
        if (left + popRect.width > window.innerWidth - 8) {
          left = Math.max(8, iconRect.left - popRect.width - 8);
        }
        if (top + popRect.height > window.innerHeight - 8) {
          top = Math.max(8, window.innerHeight - popRect.height - 8);
        }
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
      }
    }

    function closeErrorPopover() {
      const popover = document.getElementById('error-popover');
      if (popover) popover.classList.add('hidden');
    }

    // --- Infinite Canvas Zoom & Pan Management ---
    function startPan(e) {
      if (e.target.closest('foreignObject')) return;
      
      // Clear selection if clicking on the blank background of the canvas
      if (selectedNodePathId !== null) {
        selectNode(null);
      }

      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    }

    function dragPan(e) {
      if (!isDragging) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    }

    function endPan() {
      isDragging = false;
    }

    function handleWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Zoom behavior with modifier key
        const zoomFactor = 1.1;
        if (e.deltaY < 0) {
          zoomLevel *= zoomFactor;
        } else {
          zoomLevel /= zoomFactor;
        }
        zoomLevel = Math.max(0.15, Math.min(3.0, zoomLevel));
      } else {
        // Natural viewport panning / scrolling
        panX -= e.deltaX;
        panY -= e.deltaY;
      }
      applyTransform();
    }

    function zoomIn() {
      zoomLevel = Math.min(3.0, zoomLevel * 1.25);
      applyTransform();
    }

    function zoomOut() {
      zoomLevel = Math.max(0.18, zoomLevel / 1.25);
      applyTransform();
    }

    function resetZoom() {
      zoomLevel = 0.85;
      panX = 30;
      panY = orientation === 'horizontal' ? 60 : 40;
      applyTransform();
    }

    function applyTransform() {
      if (viewport) viewport.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoomLevel})`);
      updateZoomSelect();
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
    }

    function getWholeDiagramBounds() {
      const visibleNodes = activeNodes.filter(node => !node.hidden && Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.width) && Number.isFinite(node.height));
      if (visibleNodes.length === 0) return null;

      const bounds = visibleNodes.reduce((acc, node) => ({
        minX: Math.min(acc.minX, node.x),
        minY: Math.min(acc.minY, node.y),
        maxX: Math.max(acc.maxX, node.x + node.width),
        maxY: Math.max(acc.maxY, node.y + node.height)
      }), {
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity
      });

      return {
        minX: bounds.minX,
        minY: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY
      };
    }

    // --- Export whole rendered diagram as PNG ---
    async function exportToPNG() {
      if (!canvasContainer || !viewport || !window.htmlToImage || typeof window.htmlToImage.toBlob !== 'function') return;

      const bounds = getWholeDiagramBounds();
      if (!bounds) return;

      const padding = 50;
      const exportWidth = Math.max(1, Math.ceil(bounds.width + padding * 2));
      const exportHeight = Math.max(1, Math.ceil(bounds.height + padding * 2));

      const text = fullSyntaxText;
      let filename = 'infoarch-diagram.png';
      const titleMatch = text.match(/^title:\s*(.+)$/m);
      if (titleMatch && titleMatch[1].trim()) {
        const sanitizedTitle = titleMatch[1].trim()
          .toLowerCase()
          .replace(/[^a-z0-9\s_-]/g, '')
          .replace(/\s+/g, '-');
        if (sanitizedTitle) {
          filename = `${sanitizedTitle}.png`;
        }
      }

      const originalCanvasStyles = {
        width: canvasContainer.style.width,
        height: canvasContainer.style.height,
        minWidth: canvasContainer.style.minWidth,
        minHeight: canvasContainer.style.minHeight,
        maxWidth: canvasContainer.style.maxWidth,
        maxHeight: canvasContainer.style.maxHeight
      };
      const originalTransform = viewport.getAttribute('transform') || '';

      try {
        canvasContainer.style.width = `${exportWidth}px`;
        canvasContainer.style.height = `${exportHeight}px`;
        canvasContainer.style.minWidth = `${exportWidth}px`;
        canvasContainer.style.minHeight = `${exportHeight}px`;
        canvasContainer.style.maxWidth = 'none';
        canvasContainer.style.maxHeight = 'none';
        viewport.setAttribute('transform', `translate(${padding - bounds.minX}, ${padding - bounds.minY}) scale(1)`);

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        const blob = await window.htmlToImage.toBlob(canvasContainer, {
          cacheBust: true,
          pixelRatio: Math.max(1, window.devicePixelRatio || 1),
          backgroundColor: document.documentElement.classList.contains('dark') ? '#0f172a' : '#f8fafc'
        });

        if (blob) {
          downloadBlob(blob, filename);
        }
      } catch (error) {
        console.error('PNG export failed.', error);
      } finally {
        canvasContainer.style.width = originalCanvasStyles.width;
        canvasContainer.style.height = originalCanvasStyles.height;
        canvasContainer.style.minWidth = originalCanvasStyles.minWidth;
        canvasContainer.style.minHeight = originalCanvasStyles.minHeight;
        canvasContainer.style.maxWidth = originalCanvasStyles.maxWidth;
        canvasContainer.style.maxHeight = originalCanvasStyles.maxHeight;

        if (originalTransform) {
          viewport.setAttribute('transform', originalTransform);
        } else {
          applyTransform();
        }
      }
    }

    function toggleHelpModal(show) {
      const modal = document.getElementById('helpModal');
      if (modal) {
        if (show) {
          modal.classList.remove('hidden');
        } else {
          modal.classList.add('hidden');
        }
      }
    }

    function toggleDonateModal(show) {
      const modal = document.getElementById('donateModal');
      if (modal) {
        if (show) {
          modal.classList.remove('hidden');
        } else {
          modal.classList.add('hidden');
          const feedback = document.getElementById('donate-copy-feedback');
          if (feedback) feedback.classList.add('hidden');
        }
      }
    }

    function copyDonateAddress() {
      const addressEl = document.getElementById('donate-address');
      if (!addressEl) return;
      const address = addressEl.textContent.trim();
      const feedback = document.getElementById('donate-copy-feedback');
      const copyIcon = document.getElementById('donate-copy-icon');

      const showCopied = () => {
        if (feedback) feedback.classList.remove('hidden');
        if (copyIcon) {
          copyIcon.textContent = 'check';
          setTimeout(() => { copyIcon.textContent = 'content_copy'; }, 2000);
        }
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(address).then(showCopied).catch(() => fallbackCopy(address, showCopied));
      } else {
        fallbackCopy(address, showCopied);
      }
    }

    function fallbackCopy(text, onSuccess) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        if (onSuccess) onSuccess();
      } catch (err) {
        /* clipboard unavailable */
      }
      document.body.removeChild(textarea);
    }

    function toggleTheme() {
      const html = document.documentElement;
      const themeIcon = document.getElementById('theme-icon');
      if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        if (themeIcon) themeIcon.textContent = 'dark_mode';
      } else {
        html.classList.add('dark');
        if (themeIcon) themeIcon.textContent = 'light_mode';
      }
      parseAndRender();
    }

    Object.assign(window, {
      triggerFileInput,
      handleFileUpload,
      saveToFile,
      setOrientation,
      toggleConnections,
      toggleInspector,
      toggleTopMenu,
      toggleTheme,
      toggleHelpModal,
      toggleDonateModal,
      copyDonateAddress,
      openErrorPopover,
      closeErrorPopover,
      insertTemplate,
      clearEditor,
      loadTemplate,
      setPersonaFilter,
      setTagFilter,
      toggleTextFold,
      setZoomFromMenu,
      zoomIn,
      zoomOut,
      focusMainCard,
      handleGlobalExpand,
      handleGlobalCollapse,
      exportToPNG,
      handleNodeClick,
      toggleNodeCollapse,
      scrollToNodeId,
      focusNodeByPath
    });
