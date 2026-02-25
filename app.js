/* ══════════════════════════════════════════════
   제텔카스텐 메모 앱 — 핵심 로직
   ══════════════════════════════════════════════ */

// ═══════════════════════════════════════════
// 1. ZettelStore — 데이터 계층 (LocalStorage CRUD)
// ═══════════════════════════════════════════
class ZettelStore {
    constructor(storageKey = 'zettelkasten-notes') {
        this.storageKey = storageKey;
        this.notes = this._load();
    }

    // --- 저장/불러오기 ---
    _load() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    _save() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.notes));
    }

    // --- 메모 색상 팔레트 ---
    static NOTE_COLORS = [
        '#7c5cfc', '#5ccffc', '#fc5ca8', '#5cfc9c', '#fcbc5c',
        '#fc7c5c', '#a85cfc', '#5cfcda', '#fce45c', '#5c8afc'
    ];

    // --- CRUD ---
    /** 새 메모 생성, ID 반환 */
    create(title = '', body = '', parentId = null, color = null) {
        const id = this._generateId();
        const now = Date.now();
        this.notes[id] = {
            id,
            title: title || '새 메모',
            body,
            tags: [],
            links: [],
            parentId: parentId || null,
            color: color || ZettelStore.NOTE_COLORS[Math.floor(Math.random() * ZettelStore.NOTE_COLORS.length)],
            createdAt: now,
            updatedAt: now
        };
        // 새 메모가 추가되면 기존 메모들의 링크를 재파싱
        // (기존 메모가 이 제목을 [[]]로 참조하고 있었을 수 있음)
        this._refreshAllLinks();
        this._save();
        return id;
    }

    /** 메모 가져오기 */
    get(id) {
        return this.notes[id] || null;
    }

    /** 모든 메모 배열로 반환 (최신순) */
    getAll() {
        return Object.values(this.notes)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    /** 최상위 메모만 반환 (parentId가 없는) */
    getRootNotes() {
        return this.getAll().filter(n => !n.parentId);
    }

    /** 특정 메모의 하위 메모들 반환 */
    getChildren(parentId) {
        return this.getAll().filter(n => n.parentId === parentId);
    }

    /** 메모 업데이트 */
    update(id, fields) {
        if (!this.notes[id]) return;
        Object.assign(this.notes[id], fields, { updatedAt: Date.now() });
        // 본문에서 태그 자동 파싱
        if (fields.body !== undefined || fields.title !== undefined) {
            this.notes[id].tags = this._parseTags(this.notes[id].body);
        }
        // 제목이 바뀌면 다른 메모의 링크도 바뀔 수 있으므로 전체 재파싱
        this._refreshAllLinks();
        this._save();
    }

    /** 메모 삭제 */
    delete(id) {
        // 하위 메모들을 상위로 승격
        const note = this.notes[id];
        const parentId = note ? note.parentId : null;
        Object.values(this.notes).forEach(n => {
            if (n.parentId === id) {
                n.parentId = parentId || null;
            }
        });
        delete this.notes[id];
        // 삭제된 메모를 참조하던 링크 정리
        this._refreshAllLinks();
        this._save();
    }

    // --- 검색 ---
    search(query) {
        if (!query) return this.getAll();
        const q = query.toLowerCase();
        return this.getAll().filter(n =>
            n.title.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q) ||
            n.tags.some(t => t.toLowerCase().includes(q))
        );
    }

    /** 특정 태그를 가진 메모 필터 */
    filterByTag(tag) {
        if (!tag) return this.getAll();
        return this.getAll().filter(n => n.tags.includes(tag));
    }

    // --- 릭크 & 백링크 ---
    /** 이 메모를 가리키는 메모들 (백링크) */
    getBacklinks(noteId) {
        const note = this.get(noteId);
        if (!note) return [];
        return this.getAll().filter(n =>
            n.id !== noteId && n.links.includes(noteId)
        );
    }

    /** 제목으로 메모 찾기 */
    findByTitle(title) {
        const t = title.trim().toLowerCase();
        return Object.values(this.notes).find(n => n.title.toLowerCase() === t);
    }

    // --- 모든 태그 수집 ---
    getAllTags() {
        const tagCount = {};
        Object.values(this.notes).forEach(n => {
            n.tags.forEach(tag => {
                tagCount[tag] = (tagCount[tag] || 0) + 1;
            });
        });
        return tagCount; // { 태그: 개수 }
    }

    // --- 그래프 데이터 ---
    getGraphData() {
        const nodes = [];
        const edges = [];
        const allNotes = this.getAll();
        allNotes.forEach(note => {
            nodes.push({
                id: note.id,
                title: note.title,
                linkCount: note.links.length,
                color: note.color || '#7c5cfc',
                isChild: !!note.parentId // 하위 메모 여부 추가
            });
            note.links.forEach(targetId => {
                if (this.notes[targetId]) {
                    edges.push({ source: note.id, target: targetId });
                }
            });
        });
        return { nodes, edges };
    }

    // --- 전체 링크 재파싱 (핵심!) ---
    /** 모든 메모의 [[링크]]를 다시 파싱하여 최신 상태로 갱신 */
    _refreshAllLinks() {
        Object.values(this.notes).forEach(note => {
            note.links = this._parseLinks(note.body);
        });
    }

    // --- 유틸 ---
    _generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    /** 본문에서 #태그 파싱 */
    _parseTags(body) {
        const matches = body.match(/#([가-힣a-zA-Z0-9_\-]+)/g);
        if (!matches) return [];
        return [...new Set(matches.map(m => m.slice(1)))];
    }

    /** 본문에서 [[링크]] 파싱 → 대상 메모 ID 배열 */
    _parseLinks(body) {
        const regex = /\[\[(.+?)\]\]/g;
        const links = [];
        let match;
        while ((match = regex.exec(body)) !== null) {
            const target = this.findByTitle(match[1]);
            if (target) links.push(target.id);
        }
        return [...new Set(links)];
    }
}


// ═══════════════════════════════════════════
// 2. GraphView — Canvas 기반 Force-Directed 그래프
// ═══════════════════════════════════════════
class GraphView {
    constructor(canvas, tooltipEl) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.tooltip = tooltipEl;
        this.nodes = [];
        this.edges = [];
        this.animationId = null;
        this.draggingNode = null;
        this.hoveredNode = null;
        this.offsetX = 0;
        this.offsetY = 0;
        this.scale = 1;
        this.onNodeClick = null; // 콜백

        this._bindEvents();
    }

    /** 그래프 데이터 설정 & 렌더 시작 */
    setData(graphData) {
        this.nodes = graphData.nodes.map((n, i) => {
            const baseRadius = Math.min(8 + n.linkCount * 3, 24);
            const radius = n.isChild ? baseRadius * 0.5 : baseRadius; // 하위 메모면 반지름 50% 축소
            return {
                ...n,
                x: Math.random() * this.canvas.width * 0.6 + this.canvas.width * 0.2,
                y: Math.random() * this.canvas.height * 0.6 + this.canvas.height * 0.2,
                vx: 0,
                vy: 0,
                radius: radius
            };
        });
        this.edges = graphData.edges.map(e => ({
            source: this.nodes.find(n => n.id === e.source),
            target: this.nodes.find(n => n.id === e.target)
        })).filter(e => e.source && e.target);

        this._startSimulation();
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }

    _startSimulation() {
        let iterations = 0;
        const maxIterations = 300;
        const simulate = () => {
            iterations++;
            this._applyForces();
            this._draw();
            if (iterations < maxIterations || this.draggingNode) {
                this.animationId = requestAnimationFrame(simulate);
            }
        };
        if (this.animationId) cancelAnimationFrame(this.animationId);
        simulate();
    }

    _applyForces() {
        const repulsion = 2000;
        const attraction = 0.005;
        const damping = 0.85;
        const centerForce = 0.001;
        const centerX = this.canvas.width / (2 * window.devicePixelRatio);
        const centerY = this.canvas.height / (2 * window.devicePixelRatio);

        // 반발력 (노드 간)
        for (let i = 0; i < this.nodes.length; i++) {
            for (let j = i + 1; j < this.nodes.length; j++) {
                const a = this.nodes[i], b = this.nodes[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                let force = repulsion / (dist * dist);
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;
                a.vx -= fx; a.vy -= fy;
                b.vx += fx; b.vy += fy;
            }
        }

        // 인력 (엣지)
        this.edges.forEach(e => {
            let dx = e.target.x - e.source.x;
            let dy = e.target.y - e.source.y;
            let dist = Math.sqrt(dx * dx + dy * dy) || 1;
            let force = dist * attraction;
            let fx = (dx / dist) * force;
            let fy = (dy / dist) * force;
            e.source.vx += fx; e.source.vy += fy;
            e.target.vx -= fx; e.target.vy -= fy;
        });

        // 중심 인력 + 감쇠
        this.nodes.forEach(n => {
            if (n === this.draggingNode) return;
            n.vx += (centerX - n.x) * centerForce;
            n.vy += (centerY - n.y) * centerForce;
            n.vx *= damping;
            n.vy *= damping;
            n.x += n.vx;
            n.y += n.vy;
        });
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.canvas.width / window.devicePixelRatio;
        const h = this.canvas.height / window.devicePixelRatio;
        ctx.clearRect(0, 0, w, h);

        // 배경 그라데이션
        const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
        bgGrad.addColorStop(0, '#eeeef4');
        bgGrad.addColorStop(1, '#f5f5f9');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // 엣지 그리기
        this.edges.forEach(e => {
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.strokeStyle = 'rgba(106, 76, 239, 0.25)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

        // 노드 그리기
        this.nodes.forEach(node => {
            const isHovered = node === this.hoveredNode;
            const r = isHovered ? node.radius + 3 : node.radius;

            // 노드 글로우 (메모 고유 색상 사용)
            const baseColor = node.color || '#7c5cfc';
            if (isHovered) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 10, 0, Math.PI * 2);
                ctx.fillStyle = baseColor + '30';
                ctx.fill();
            }

            // 노드 원 (메모 고유 색상)
            const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r);
            grad.addColorStop(0, baseColor + 'cc');
            grad.addColorStop(1, baseColor);
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.1)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // 라벨
            ctx.font = `${isHovered ? '600' : '500'} 11px Inter, sans-serif`;
            ctx.fillStyle = isHovered ? '#1a1a2e' : 'rgba(26, 26, 46, 0.7)';
            ctx.textAlign = 'center';
            ctx.fillText(
                node.title.length > 16 ? node.title.slice(0, 15) + '…' : node.title,
                node.x, node.y + r + 16
            );
        });
    }

    _bindEvents() {
        let isDragging = false;

        this.canvas.addEventListener('mousedown', (e) => {
            const node = this._getNodeAt(e);
            if (node) {
                this.draggingNode = node;
                isDragging = true;
                this._startSimulation();
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            if (isDragging && this.draggingNode) {
                this.draggingNode.x = x;
                this.draggingNode.y = y;
                this.draggingNode.vx = 0;
                this.draggingNode.vy = 0;
            }

            // 호버 감지
            const node = this._getNodeAt(e);
            if (node !== this.hoveredNode) {
                this.hoveredNode = node;
                this.canvas.style.cursor = node ? 'pointer' : 'default';
                if (node) {
                    this.tooltip.textContent = node.title;
                    this.tooltip.style.left = (e.clientX - rect.left) + 'px';
                    this.tooltip.style.top = (e.clientY - rect.top) + 'px';
                    this.tooltip.classList.remove('hidden');
                } else {
                    this.tooltip.classList.add('hidden');
                }
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            if (isDragging && this.draggingNode) {
                if (this.onNodeClick) this.onNodeClick(this.draggingNode.id);
            }
            isDragging = false;
            this.draggingNode = null;
        });

        this.canvas.addEventListener('mouseleave', () => {
            isDragging = false;
            this.draggingNode = null;
            this.hoveredNode = null;
            this.tooltip.classList.add('hidden');
        });
    }

    _getNodeAt(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        return this.nodes.find(n => {
            const dx = n.x - x, dy = n.y - y;
            return Math.sqrt(dx * dx + dy * dy) <= n.radius + 6;
        }) || null;
    }

    destroy() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
    }
}


// ═══════════════════════════════════════════
// 3. App — 전체 애플리케이션 컨트롤러
// ═══════════════════════════════════════════
class App {
    constructor() {
        this.store = new ZettelStore();
        this.currentNoteId = null;
        this.activeTag = null;
        this.autoSaveTimer = null;
        this.autocompleteIndex = -1;
        this.isPreviewMode = false;

        // DOM 캐싱
        this.$ = {
            sidebar: document.getElementById('sidebar'),
            searchInput: document.getElementById('search-input'),
            tagList: document.getElementById('tag-list'),
            noteList: document.getElementById('note-list'),
            noteCount: document.getElementById('note-count'),
            btnNewNote: document.getElementById('btn-new-note'),
            btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
            btnDeleteNote: document.getElementById('btn-delete-note'),
            panelEditor: document.getElementById('panel-editor'),
            panelGraph: document.getElementById('panel-graph'),
            emptyState: document.getElementById('empty-state'),
            editorArea: document.getElementById('editor-area'),
            noteTitle: document.getElementById('note-title'),
            noteBody: document.getElementById('note-body'),
            saveStatus: document.getElementById('save-status'),
            backlinksSection: document.getElementById('backlinks-section'),
            backlinkList: document.getElementById('backlink-list'),
            graphCanvas: document.getElementById('graph-canvas'),
            graphTooltip: document.getElementById('graph-tooltip'),
            autocompletePopup: document.getElementById('autocomplete-popup'),
            autocompleteList: document.getElementById('autocomplete-list'),
            btnTogglePreview: document.getElementById('btn-toggle-preview'),
            notePreview: document.getElementById('note-preview'),
            btnUploadImage: document.getElementById('btn-upload-image'),
            imageInput: document.getElementById('image-input'),
            imageGallery: document.getElementById('image-gallery'),
            btnNewNoteMain: document.getElementById('btn-new-note-main'),
            btnNewNoteEditor: document.getElementById('btn-new-note-editor'),
            btnToggleGraphEditor: document.getElementById('btn-toggle-graph-editor'),
            btnHome: document.getElementById('btn-home')
        };

        // 그래프 뷰 초기화
        this.graphView = new GraphView(this.$.graphCanvas, this.$.graphTooltip);
        this.graphView.onNodeClick = (id) => {
            this._openNote(id);
        };

        this._bindEvents();
        this._renderNoteList();
        this._renderTags();

        // 그래프 초기 렌더
        setTimeout(() => this._refreshGraph(), 100);
    }

    // ─── 이벤트 바인딩 ───
    _bindEvents() {
        // 새 메모
        this.$.btnNewNote.addEventListener('click', () => this._createNote());
        this.$.btnNewNoteMain.addEventListener('click', () => this._createNote());
        this.$.btnNewNoteEditor.addEventListener('click', () => this._createNote(this.currentNoteId));

        // 사이드바 토글
        this.$.btnToggleSidebar.addEventListener('click', () => {
            this.$.sidebar.classList.toggle('collapsed');
        });


        // 검색
        this.$.searchInput.addEventListener('input', () => this._onSearch());

        // 메모 제목 변경
        this.$.noteTitle.addEventListener('input', () => this._onNoteChange());

        // 메모 본문 변경
        this.$.noteBody.addEventListener('input', (e) => this._onNoteChange(e));

        // 메모 본문에서 [[]] 자동완성
        this.$.noteBody.addEventListener('keydown', (e) => this._onEditorKeydown(e));

        // 메모 삭제
        this.$.btnDeleteNote.addEventListener('click', () => this._deleteCurrentNote());

        // 키보드 단축키
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this._createNote();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                this._togglePreview();
            }
        });

        // 미리보기 토글
        this.$.btnTogglePreview.addEventListener('click', () => this._togglePreview());

        // 그래프 토글 (에디터 모드에서)
        this.$.btnToggleGraphEditor.addEventListener('click', () => this._toggleGraphEditor());

        // 이미지 업로드
        this.$.btnUploadImage.addEventListener('click', () => this.$.imageInput.click());
        this.$.imageInput.addEventListener('change', (e) => this._onImageUpload(e));

        // 홈 버튼
        this.$.btnHome.addEventListener('click', () => this._goHome());

        // 자동완성 팝업 외부 클릭 시 닫기
        document.addEventListener('click', (e) => {
            if (!this.$.autocompletePopup.contains(e.target)) {
                this._hideAutocomplete();
            }
        });

        // 윈도우 리사이즈 → 그래프 리사이즈
        window.addEventListener('resize', () => {
            this.graphView.resize();
        });
    }

    // ─── 메모 생성 ───
    _createNote(parentId = null) {
        let title = '';
        let color = null;
        if (parentId) {
            const parent = this.store.get(parentId);
            if (parent) {
                // 하위 메모 번호 계산
                const siblings = this.store.getChildren(parentId);
                const nextNum = siblings.length + 1;
                title = `${parent.title} ${nextNum}`;
                color = parent.color;
            }
        }
        const id = this.store.create(title, '', parentId, color);
        this._renderNoteList();
        this._renderTags();
        this._openNote(id);
        this.$.noteTitle.focus();
        this.$.noteTitle.select();
    }

    // ─── 메모 열기 ───
    _openNote(id) {
        const note = this.store.get(id);
        if (!note) return;
        this.currentNoteId = id;
        this.$.noteTitle.value = note.title;
        this.$.noteBody.value = note.body;
        this.$.panelEditor.classList.add('active'); // 에디터 패널 활성화
        this.$.panelGraph.classList.remove('active'); // 기본은 그래프 숨김 (전체 화면 에디터)
        this.$.panelEditor.classList.remove('split-view'); // 스플릿 뷰 제거
        this.$.btnToggleGraphEditor.classList.remove('active'); // 버튼 상태 해제
        this.$.emptyState.classList.add('hidden');
        this.$.editorArea.classList.remove('hidden');
        this._renderBacklinks(id);
        this._highlightActiveNote(id);
        this._setSaveStatus('저장됨');
        // 이미지 갤러리 렌더
        this._renderImageGallery(id);
        // 미리보기 모드면 미리보기 갱신
        if (this.isPreviewMode) {
            this._renderPreview();
        }
    }

    // ─── 메모 변경 감지 (자동 저장) ───
    _onNoteChange() {
        if (!this.currentNoteId) return;
        this._setSaveStatus('저장 중...');

        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => {
            this.store.update(this.currentNoteId, {
                title: this.$.noteTitle.value.trim() || '새 메모',
                body: this.$.noteBody.value
            });
            this._renderNoteList();
            this._renderTags();
            this._renderBacklinks(this.currentNoteId);
            this._setSaveStatus('저장됨');
        }, 400);

        // [[]] 자동완성 확인
        this._checkAutocomplete();
    }

    _setSaveStatus(text) {
        this.$.saveStatus.textContent = text;
        this.$.saveStatus.classList.toggle('saving', text !== '저장됨');
    }

    // ─── 메모 삭제 ───
    _deleteCurrentNote() {
        if (!this.currentNoteId) return;
        const note = this.store.get(this.currentNoteId);
        if (!confirm(`"${note.title}" 메모를 삭제하시겠습니까?`)) return;

        this.store.delete(this.currentNoteId);
        this.currentNoteId = null;
        this.$.panelEditor.classList.remove('active'); // 에디터 패널 비활성화
        this.$.panelGraph.classList.add('active'); // 그래프 전용 뷰로 복귀
        this.$.editorArea.classList.add('hidden');
        this.$.emptyState.classList.remove('hidden');
        this._renderNoteList();
        this._renderTags();
    }

    // ─── 메모 목록 렌더링 ───
    _renderNoteList() {
        const allNotes = this.store.getAll();
        this.$.noteCount.textContent = allNotes.length;
        this.$.noteList.innerHTML = '';

        // 검색/태그 필터
        let filtered;
        if (this.activeTag) {
            filtered = this.store.filterByTag(this.activeTag);
        } else {
            const query = this.$.searchInput.value;
            filtered = this.store.search(query);
        }
        const filteredIds = new Set(filtered.map(n => n.id));

        // 트리 렌더링
        const renderNoteItem = (note, depth = 0) => {
            if (!filteredIds.has(note.id)) {
                // 필터에 안 맞지만 자식은 있을 수 있으므로 자식만 렌더
                const children = this.store.getChildren(note.id);
                children.forEach(child => renderNoteItem(child, depth));
                return;
            }
            const li = document.createElement('li');
            li.className = 'note-item' + (note.id === this.currentNoteId ? ' active' : '');
            if (depth > 0) li.classList.add('note-item-child');
            li.dataset.id = note.id;
            li.style.paddingLeft = (12 + depth * 20) + 'px';
            const color = note.color || '#7c5cfc';
            li.style.borderLeftColor = color;
            li.style.borderLeftWidth = '3px';
            li.style.borderLeftStyle = 'solid';
            const preview = note.body
                .replace(/\[\[(.+?)\]\]/g, '$1')
                .replace(/#[가-힣a-zA-Z0-9_-]+/g, '')
                .trim()
                .slice(0, 80);
            const depthIcon = depth > 0 ? '<span class="note-depth-icon">↳</span> ' : '';
            li.innerHTML = `
                <div class="note-item-title">${depthIcon}${this._escapeHtml(note.title)}</div>
                <div class="note-item-preview">${this._escapeHtml(preview) || '내용 없음'}</div>
                <div class="note-item-date">작성 ${this._formatDateTime(note.createdAt)} · 수정 ${this._formatDate(note.updatedAt)}</div>
            `;
            li.addEventListener('click', () => this._openNote(note.id));
            this.$.noteList.appendChild(li);

            // 하위 메모 렌더
            const children = this.store.getChildren(note.id);
            children.forEach(child => renderNoteItem(child, depth + 1));
        };

        // 최상위 메모부터 시작
        const rootNotes = allNotes.filter(n => !n.parentId);
        rootNotes.forEach(note => renderNoteItem(note, 0));
    }

    _highlightActiveNote(id) {
        this.$.noteList.querySelectorAll('.note-item').forEach(el => {
            el.classList.toggle('active', el.dataset.id === id);
        });
    }

    // ─── 태그 렌더링 ───
    _renderTags() {
        const tags = this.store.getAllTags();
        const tagColors = ['var(--tag-1)', 'var(--tag-2)', 'var(--tag-3)', 'var(--tag-4)',
            'var(--tag-5)', 'var(--tag-6)', 'var(--tag-7)', 'var(--tag-8)'];
        this.$.tagList.innerHTML = '';

        if (this.activeTag) {
            // "전체" 칩 (필터 해제)
            const allChip = document.createElement('span');
            allChip.className = 'tag-chip';
            allChip.style.background = 'var(--bg-hover)';
            allChip.style.color = 'var(--text-secondary)';
            allChip.textContent = '✕ 전체';
            allChip.addEventListener('click', () => {
                this.activeTag = null;
                this._renderTags();
                this._renderNoteList();
            });
            this.$.tagList.appendChild(allChip);
        }

        Object.entries(tags)
            .sort((a, b) => b[1] - a[1])
            .forEach(([tag, count], i) => {
                const chip = document.createElement('span');
                const color = tagColors[i % tagColors.length];
                const isActive = this.activeTag === tag;
                chip.className = 'tag-chip' + (isActive ? ' active' : '');
                chip.style.background = isActive ? color : `color-mix(in srgb, ${color} 20%, transparent)`;
                chip.style.color = color;
                chip.textContent = `#${tag} ${count}`;
                chip.addEventListener('click', () => {
                    this.activeTag = isActive ? null : tag;
                    this._renderTags();
                    this._renderNoteList();
                });
                this.$.tagList.appendChild(chip);
            });
    }

    // ─── 이미지 업로드 처리 ───
    _onImageUpload(e) {
        if (!this.currentNoteId) return;
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const note = this.store.get(this.currentNoteId);
        if (!note.images) note.images = [];

        let processed = 0;
        files.forEach(file => {
            if (!file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                // 이미지 리사이즈 (LocalStorage 용량 절약)
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_SIZE = 800;
                    let w = img.width, h = img.height;
                    if (w > MAX_SIZE || h > MAX_SIZE) {
                        if (w > h) { h = (h / w) * MAX_SIZE; w = MAX_SIZE; }
                        else { w = (w / h) * MAX_SIZE; h = MAX_SIZE; }
                    }
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    note.images.push({
                        id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                        data: dataUrl,
                        name: file.name,
                        addedAt: Date.now()
                    });
                    processed++;
                    if (processed === files.length) {
                        this.store.update(this.currentNoteId, { images: note.images });
                        this._renderImageGallery(this.currentNoteId);
                        if (this.isPreviewMode) this._renderPreview();
                    }
                };
                img.src = evt.target.result;
            };
            reader.readAsDataURL(file);
        });

        // input 초기화 (같은 파일 재업로드 가능)
        e.target.value = '';
    }

    // ─── 이미지 갤러리 렌더링 ───
    _renderImageGallery(noteId) {
        const note = this.store.get(noteId);
        const images = note?.images || [];

        if (images.length === 0) {
            this.$.imageGallery.classList.add('hidden');
            this.$.imageGallery.innerHTML = '';
            return;
        }

        this.$.imageGallery.classList.remove('hidden');
        this.$.imageGallery.innerHTML = '';

        images.forEach((img, idx) => {
            const card = document.createElement('div');
            card.className = 'image-card';
            card.innerHTML = `
                <img src="${img.data}" alt="${this._escapeHtml(img.name || '이미지')}" />
                <button class="image-delete" title="삭제">✕</button>
            `;

            // 이미지 클릭 → 라이트박스
            card.querySelector('img').addEventListener('click', () => {
                this._showLightbox(img.data);
            });

            // 삭제 버튼
            card.querySelector('.image-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this._deleteImage(noteId, idx);
            });

            this.$.imageGallery.appendChild(card);
        });
    }

    // ─── 이미지 라이트박스 (전체화면 보기) ───
    _showLightbox(dataUrl) {
        const overlay = document.createElement('div');
        overlay.className = 'image-lightbox';
        overlay.innerHTML = `<img src="${dataUrl}" />`;
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
    }

    // ─── 이미지 삭제 ───
    _deleteImage(noteId, index) {
        const note = this.store.get(noteId);
        if (!note?.images) return;
        note.images.splice(index, 1);
        this.store.update(noteId, { images: note.images });
        this._renderImageGallery(noteId);
        if (this.isPreviewMode) this._renderPreview();
    }

    // ─── 백링크 렌더링 ───
    _renderBacklinks(noteId) {
        const backlinks = this.store.getBacklinks(noteId);
        if (backlinks.length === 0) {
            this.$.backlinksSection.classList.add('hidden');
            return;
        }
        this.$.backlinksSection.classList.remove('hidden');
        this.$.backlinkList.innerHTML = '';
        backlinks.forEach(bl => {
            const li = document.createElement('li');
            li.className = 'backlink-item';
            li.textContent = bl.title;
            li.addEventListener('click', () => this._openNote(bl.id));
            this.$.backlinkList.appendChild(li);
        });
    }

    // ─── 미리보기 토글 ───
    _togglePreview() {
        if (!this.currentNoteId) return;
        this.isPreviewMode = !this.isPreviewMode;
        this.$.btnTogglePreview.classList.toggle('active', this.isPreviewMode);

        if (this.isPreviewMode) {
            // 편집 → 미리보기: 먼저 저장
            if (this.autoSaveTimer) {
                clearTimeout(this.autoSaveTimer);
                this.store.update(this.currentNoteId, {
                    title: this.$.noteTitle.value.trim() || '새 메모',
                    body: this.$.noteBody.value
                });
            }
            this.$.noteBody.classList.add('hidden');
            this.$.notePreview.classList.remove('hidden');
            this._renderPreview();
        } else {
            // 미리보기 → 편집
            this.$.notePreview.classList.add('hidden');
            this.$.noteBody.classList.remove('hidden');
            this.$.noteBody.focus();
        }
    }

    /** 본문을 렌더링하여 [[링크]]와 #태그를 클릭 가능하게 변환 */
    _renderPreview() {
        if (!this.currentNoteId) return;
        const note = this.store.get(this.currentNoteId);
        if (!note) return;

        // 링크/태그/URL 변환용 헬퍼 함수
        const convertMarkdown = (text) => {
            let html = this._escapeHtml(text);

            // 1. [[위키링크]]
            html = html.replace(/\[\[(.+?)\]\]/g, (match, title) => {
                const cleanTitle = title.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                const target = this.store.findByTitle(cleanTitle);
                if (target) {
                    return `<span class="wiki-link" data-note-id="${target.id}" title="${title} 메모로 이동">${title}</span>`;
                } else {
                    return `<span class="wiki-link broken" title="'${title}' 메모가 없습니다">${title}</span>`;
                }
            });

            // 2. #태그
            html = html.replace(/#([가-힣a-zA-Z0-9_\-]+)/g, (match, tag) => {
                return `<span class="tag-inline" data-tag="${tag}">#${tag}</span>`;
            });

            // 3. [텍스트](URL) 마크다운 링크
            html = html.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, (match, text, url) => {
                return `<a href="${url}" class="external-link" target="_blank" rel="noopener noreferrer" title="${url}">${text} ↗</a>`;
            });

            // 4. 일반 URL 자동 링크 (이미 태그된 부분 제외)
            const combinedRegex = /(<a[^>]*>.*?<\/a>|<span[^>]*>.*?<\/span>|<[^>]+>)|(https?:\/\/[^\s<]+|www\.[^\s<]+\.[^\s<]+)/gi;
            html = html.replace(combinedRegex, (match, tag, url) => {
                if (tag) return match;
                let href = url;
                if (href.toLowerCase().startsWith('www.')) href = 'http://' + href;
                return `<a href="${href}" class="external-link" target="_blank" rel="noopener noreferrer">${url} ↗</a>`;
            });

            return html;
        };

        // 줄 단위 렌더링
        const htmlLines = note.body.split('\n').map(line => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('**')) {
                const linkMatch = line.match(/\[\[(.+?)\]\]/);
                const targetTitle = linkMatch ? linkMatch[1] : null;

                // 표시용 텍스트만 변환 (원본 line은 data-raw-line에 안전하게 보관)
                const displayText = line.replace('**', '').trim();
                const processedContent = convertMarkdown(displayText);

                return `<div class="task-row"><div class="task-item">
                            <input type="checkbox" class="task-checkbox" 
                                   ${targetTitle ? `data-target="${this._escapeHtml(targetTitle)}" data-raw-line="${this._escapeHtml(line)}"` : 'disabled title="연결된 메모가 없습니다"'} 
                            >
                            <span class="task-text">${processedContent}</span>
                        </div></div>`;
            }
            return convertMarkdown(line);
        });

        this.$.notePreview.innerHTML = htmlLines.join('\n');

        // 태스크 체크박스 이벤트 바인딩
        this.$.notePreview.querySelectorAll('.task-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    const row = e.target.closest('.task-item');
                    row.classList.add('moving');
                    setTimeout(() => {
                        this._moveTask(e.target.dataset.rawLine, e.target.dataset.target);
                    }, 500);
                }
            });
        });

        // 링크 클릭 이벤트 바인딩
        this.$.notePreview.querySelectorAll('.wiki-link:not(.broken)').forEach(el => {
            el.addEventListener('click', () => {
                const noteId = el.dataset.noteId;
                this.isPreviewMode = false;
                this.$.btnTogglePreview.classList.remove('active');
                this.$.notePreview.classList.add('hidden');
                this.$.noteBody.classList.remove('hidden');
                this._openNote(noteId);
            });
        });

        // 끊어진 링크 클릭 → 새 메모 생성
        this.$.notePreview.querySelectorAll('.wiki-link.broken').forEach(el => {
            el.addEventListener('click', () => {
                const title = el.textContent;
                const newId = this.store.create(title);
                this._renderNoteList();
                this._renderTags();
                // 새 메모로 이동
                this.isPreviewMode = false;
                this.$.btnTogglePreview.classList.remove('active');
                this.$.notePreview.classList.add('hidden');
                this.$.noteBody.classList.remove('hidden');
                this._openNote(newId);
            });
        });

        // 태그 클릭 → 태그 필터
        this.$.notePreview.querySelectorAll('.tag-inline').forEach(el => {
            el.addEventListener('click', () => {
                this.activeTag = el.dataset.tag;
                this._renderTags();
                this._renderNoteList();
            });
        });

        // 이미지가 있으면 미리보기에 추가
        const images = note.images || [];
        if (images.length > 0) {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'preview-images';
            images.forEach(img => {
                const imgEl = document.createElement('img');
                imgEl.src = img.data;
                imgEl.alt = img.name || '이미지';
                imgEl.addEventListener('click', () => this._showLightbox(img.data));
                imgContainer.appendChild(imgEl);
            });
            this.$.notePreview.appendChild(imgContainer);
        }
    }

    /** 태스크 이동 로직 (**) */
    _moveTask(rawLine, targetTitle) {
        if (!this.currentNoteId || !targetTitle) return;

        const sourceNote = this.store.get(this.currentNoteId);
        const targetNote = this.store.findByTitle(targetTitle);

        if (!sourceNote) return;

        // 대상 메모가 없을 경우
        if (!targetNote) {
            alert(`'${targetTitle}' 메모를 찾을 수 없습니다. [[ ]] 링크를 먼저 확인해주세요.`);
            this._renderPreview(); // 체크박스 상태 복구를 위해 다시 렌더링
            return;
        }

        // 원본에서 해당 줄 제거 (HTML 엔티티 완벽 복원)
        const lines = sourceNote.body.split('\n');

        // 브라우저의 dataset은 이미 어느 정도 언이스케이프를 하지만, 안전하게 처리
        const unescape = (str) => {
            const txt = document.createElement('textarea');
            txt.innerHTML = str;
            return txt.value;
        };
        const unescapedRawLine = unescape(rawLine);

        const lineIndex = lines.findIndex(l => l.trim() === unescapedRawLine.trim());
        if (lineIndex !== -1) {
            lines.splice(lineIndex, 1);
        } else {
            // 이스케이프 또는 공백 차이로 못 찾을 경우를 대비한 보험적 검색
            const backupIndex = lines.findIndex(l => l.includes('**') && l.includes(targetTitle));
            if (backupIndex !== -1) lines.splice(backupIndex, 1);
        }

        // 대상 메모에 추가 (깔끔하게 정리)
        let cleanedContent = unescapedRawLine.replace('**', '').replace(`[[${targetTitle}]]`, '').trim();
        const targetBody = targetNote.body.trim();
        const newTargetBody = targetBody + (targetBody ? '\n' : '') + cleanedContent;

        // 저장
        this.store.update(sourceNote.id, { body: lines.join('\n') });
        this.store.update(targetNote.id, { body: newTargetBody });

        // UI 갱신 (목록, 현재 메모 갱신, 그래프 갱신)
        this._renderNoteList();
        this._openNote(sourceNote.id);
        this._refreshGraph();
    }

    // ─── 검색 ───
    _onSearch() {
        this.activeTag = null;
        this._renderTags();
        this._renderNoteList();
    }

    // ─── 그래프 새로고침 ───
    _refreshGraph() {
        this.graphView.resize();
        this.graphView.setData(this.store.getGraphData());
    }

    // ─── [[ ]] 자동완성 ───
    _checkAutocomplete() {
        const textarea = this.$.noteBody;
        const text = textarea.value;
        const cursor = textarea.selectionStart;
        // 커서 앞의 텍스트에서 미완성 [[ 찾기
        const before = text.slice(0, cursor);
        const openBracket = before.lastIndexOf('[[');
        if (openBracket === -1) { this._hideAutocomplete(); return; }
        const afterOpen = before.slice(openBracket + 2);
        // 이미 닫혀있으면 무시
        if (afterOpen.includes(']]')) { this._hideAutocomplete(); return; }

        const query = afterOpen.toLowerCase();
        const results = this.store.getAll()
            .filter(n => n.id !== this.currentNoteId && n.title.toLowerCase().includes(query))
            .slice(0, 8);

        if (results.length === 0 && query.length === 0) { this._hideAutocomplete(); return; }

        this._showAutocomplete(results, query);
    }

    _showAutocomplete(results, query) {
        const textarea = this.$.noteBody;
        this.$.autocompleteList.innerHTML = '';
        this.autocompleteIndex = -1;

        results.forEach((note, i) => {
            const li = document.createElement('li');
            li.className = 'autocomplete-item';
            li.textContent = note.title;
            li.addEventListener('click', () => this._insertLink(note.title));
            this.$.autocompleteList.appendChild(li);
        });

        // "새 메모 만들기" 옵션
        if (query.trim().length > 0 && !results.find(n => n.title.toLowerCase() === query)) {
            const li = document.createElement('li');
            li.className = 'autocomplete-item create-new';
            li.textContent = `"${query}" 메모 만들기`;
            li.addEventListener('click', () => {
                const id = this.store.create(query.trim());
                this._renderNoteList();
                this._insertLink(query.trim());
            });
            this.$.autocompleteList.appendChild(li);
        }

        // 위치 계산 (textarea 기반)
        const rect = textarea.getBoundingClientRect();
        this.$.autocompletePopup.style.left = (rect.left + 40) + 'px';
        this.$.autocompletePopup.style.top = (rect.top + 60) + 'px';
        this.$.autocompletePopup.classList.remove('hidden');
    }

    _hideAutocomplete() {
        this.$.autocompletePopup.classList.add('hidden');
    }

    _insertLink(title) {
        const textarea = this.$.noteBody;
        const text = textarea.value;
        const cursor = textarea.selectionStart;
        const before = text.slice(0, cursor);
        const openBracket = before.lastIndexOf('[[');
        const afterCursor = text.slice(cursor);

        // [[ 이후를 교체
        const newText = text.slice(0, openBracket) + `[[${title}]]` + afterCursor;
        textarea.value = newText;
        const newPos = openBracket + title.length + 4;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
        this._hideAutocomplete();
        this._onNoteChange();
    }

    _onEditorKeydown(e) {
        if (this.$.autocompletePopup.classList.contains('hidden')) return;
        const items = this.$.autocompleteList.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.autocompleteIndex = Math.min(this.autocompleteIndex + 1, items.length - 1);
            this._highlightAutocomplete(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.autocompleteIndex = Math.max(this.autocompleteIndex - 1, 0);
            this._highlightAutocomplete(items);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (this.autocompleteIndex >= 0) {
                e.preventDefault();
                items[this.autocompleteIndex].click();
            }
        } else if (e.key === 'Escape') {
            this._hideAutocomplete();
        }
    }

    _highlightAutocomplete(items) {
        items.forEach((el, i) => el.classList.toggle('selected', i === this.autocompleteIndex));
    }

    // ─── 유틸 ───
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _formatDate(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diff = now - d;

        if (diff < 60000) return '방금 전';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}일 전`;
        return this._formatDateTime(ts);
    }

    /** 정확한 날짜 + 시간 포맷 */
    _formatDateTime(ts) {
        const d = new Date(ts);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const mins = String(d.getMinutes()).padStart(2, '0');
        return `${year}.${month}.${day} ${hours}:${mins}`;
    }

    // ─── 그래프 토글 (에디터 내) ───
    _toggleGraphEditor() {
        if (!this.currentNoteId) return;
        const isGraphVisible = this.$.panelGraph.classList.toggle('active');
        this.$.panelEditor.classList.toggle('split-view', isGraphVisible);
        this.$.btnToggleGraphEditor.classList.toggle('active', isGraphVisible);

        if (isGraphVisible) {
            this._refreshGraph();
        }
    }

    // ─── 초기 화면으로 (홈) ───
    _goHome() {
        this.currentNoteId = null;
        this.$.panelEditor.classList.remove('active');
        this.$.panelGraph.classList.add('active');
        this.$.emptyState.classList.remove('hidden');
        this.$.editorArea.classList.add('hidden');
        this._renderNoteList();
        this._refreshGraph();
    }
}


// ═══════════════════════════════════════════
// 앱 시작!
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
