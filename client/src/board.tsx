import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, AuthError } from './api';
import { applyStatus, childrenOf, itemAfterRemoval, needsConfirm, nextStatus } from './model';
import type { Board, Editing, Group, ListItem, LogLine, MenuState, Session, SortBy, SortDir, TreeNode, User } from './types';

type Theme = 'dark' | 'light';
type Confirm = { id: string } | null;

type BoardApi = {
  ready: boolean;
  user: User | null;
  googleEnabled: boolean;
  nodes: TreeNode[];
  items: ListItem[];
  selectedNodeId: string | null;
  selectedItemId: string | null;
  openListId: string | null;
  editing: Editing;
  warning: string | null;
  log: LogLine | null;
  search: string;
  sortBy: SortBy;
  sortDir: SortDir;
  completedFirst: boolean;
  theme: Theme;
  mobileView: 'tree' | 'list';
  menu: MenuState | null;
  confirm: Confirm;
  accountOpen: boolean;
  draggingWarning: boolean;
  warningHot: boolean;
  setSearch: (value: string) => void;
  setTheme: (theme: Theme) => void;
  setMobileView: (view: 'tree' | 'list') => void;
  setDraggingWarning: (value: boolean) => void;
  setWarningHot: (value: boolean) => void;
  warn: (message: string) => void;
  fileWarning: () => void;
  loginDev: () => Promise<void>;
  loginGoogle: () => void;
  logout: () => Promise<void>;
  setAccountOpen: (value: boolean) => void;
  clearNodeSelection: () => void;
  clearItemSelection: () => void;
  selectItem: (id: string) => void;
  activateNode: (id: string, toggle?: boolean) => void;
  selectNode: (id: string) => void;
  openNode: (id: string) => void;
  beginRenameNode: (id: string) => void;
  beginRenameItem: (id: string) => void;
  cycleTask: (id: string) => void;
  commitEdit: (value: string) => void;
  cancelEdit: () => void;
  createNode: (kind: 'folder' | 'list', targetId?: string | null) => void;
  createItem: (kind: 'task' | 'comment' | 'subtask') => void;
  copyNode: (id: string) => void;
  askRemove: (id: string) => void;
  removeItem: (id: string) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  sortNodes: (targetId: string | null, by?: SortBy) => void;
  chooseSort: (by: SortBy) => void;
  toggleCompletedFirst: () => void;
  openSortMenu: (x: number, y: number) => void;
  moveNodes: (movingId: string, groups: Group[]) => void;
  moveItems: (movingId: string, groups: Group[]) => void;
  openTreeMenu: (x: number, y: number, nodeId: string | null) => void;
  openEditorMenu: (x: number, y: number, itemId: string | null) => void;
  closeMenu: () => void;
  snapshot: () => { nodes: TreeNode[]; items: ListItem[]; search: string };
};

const BoardContext = createContext<BoardApi | null>(null);

export function useBoard() {
  const value = useContext(BoardContext);
  if (!value) throw new Error('useBoard');
  return value;
}

async function getBoard() {
  return api<Board>('/api/board');
}

function pickList(nodes: TreeNode[]) {
  const saved = localStorage.getItem('saphire-open-list');
  return nodes.find((node) => node.id === saved && node.kind === 'list')
    ?? nodes.find((node) => node.title === 'List 2' && node.kind === 'list')
    ?? nodes.find((node) => node.kind === 'list')
    ?? null;
}

export function BoardProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [items, setItems] = useState<ListItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine | null>(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>(() => (localStorage.getItem('saphire-sort') === 'time' ? 'time' : 'alpha'));
  const [sortDir, setSortDir] = useState<SortDir>(() => (localStorage.getItem('saphire-sort-dir') === 'desc' ? 'desc' : 'asc'));
  const [completedFirst, setCompletedFirst] = useState(() => localStorage.getItem('saphire-completed-first') === '1');
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'));
  const [mobileView, setMobileView] = useState<'tree' | 'list'>('tree');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [draggingWarning, setDraggingWarning] = useState(false);
  const [warningHot, setWarningHot] = useState(false);

  const nodesRef = useRef(nodes);
  const itemsRef = useRef(items);
  const warningRef = useRef(warning);
  const searchRef = useRef(search);
  const editingRef = useRef(editing);
  const selectedNodeRef = useRef(selectedNodeId);
  const sortByRef = useRef(sortBy);
  const sortDirRef = useRef(sortDir);
  const completedFirstRef = useRef(completedFirst);
  const themeRef = useRef(theme);
  const rev = useRef(0);
  const tail = useRef(Promise.resolve());
  nodesRef.current = nodes;
  itemsRef.current = items;
  warningRef.current = warning;
  searchRef.current = search;
  editingRef.current = editing;
  selectedNodeRef.current = selectedNodeId;
  sortByRef.current = sortBy;
  sortDirRef.current = sortDir;
  completedFirstRef.current = completedFirst;
  themeRef.current = theme;

  function put(next: { nodes?: TreeNode[]; items?: ListItem[] }) {
    if (next.nodes) {
      nodesRef.current = next.nodes;
      setNodes(next.nodes);
    }
    if (next.items) {
      itemsRef.current = next.items;
      setItems(next.items);
    }
  }

  function compareNodes(a: TreeNode, b: TreeNode, by: SortBy, dir: SortDir) {
    const time = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    const title = a.title.localeCompare(b.title, 'ru', { sensitivity: 'base' });
    const raw = by === 'time' ? (time || title) : (title || time);
    return (dir === 'desc' ? -raw : raw) || a.position - b.position;
  }

  function pushLog(message: string) {
    const text = message.trim();
    if (!text) return;
    setLog({ id: crypto.randomUUID(), at: Date.now(), message: text });
  }

  function warn(message: string) {
    const prev = warningRef.current;
    if (prev && prev !== message) pushLog(prev);
    warningRef.current = message;
    setWarning(message);
  }

  function fileWarning() {
    const current = warningRef.current;
    if (!current) return;
    warningRef.current = null;
    setWarning(null);
    setWarningHot(false);
    pushLog(current);
  }

  function adopt(board: Board) {
    put({ nodes: board.nodes, items: board.items });
  }

  function openSaved(board: Board) {
    const pick = pickList(board.nodes);
    if (!pick) return;
    setOpenListId(pick.id);
    setSelectedNodeId(pick.id);
    localStorage.setItem('saphire-open-list', pick.id);
  }

  function commit(optimistic: () => void, exec: () => Promise<Board>, activity?: string, after?: (board: Board) => void) {
    optimistic();
    const mine = ++rev.current;
    tail.current = tail.current.then(async () => {
      try {
        const board = await exec();
        if (activity) pushLog(activity);
        if (mine === rev.current) {
          adopt(board);
          after?.(board);
        }
      } catch (error) {
        if (error instanceof AuthError) {
          setUser(null);
          return;
        }
        warn(error instanceof Error && error.message ? error.message : 'Не удалось сохранить');
        if (mine === rev.current) {
          try { adopt(await getBoard()); } catch { /* keep the screen as it is */ }
        }
      }
    });
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'failed') {
      warn('Не удалось войти через Google');
      params.delete('auth');
      const query = params.toString();
      window.history.replaceState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
    }
    let live = true;
    (async () => {
      try {
        const session = await api<Session>('/api/auth/session');
        if (!live) return;
        setGoogleEnabled(session.google);
        setUser(session.user);
        if (session.user) {
          const board = await getBoard();
          if (!live) return;
          adopt(board);
          openSaved(board);
        }
      } catch (error) {
        if (!live) return;
        if (!(error instanceof AuthError)) warn(error instanceof ApiError ? error.message : 'Не удалось подключиться');
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(null);
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) setSelectedItemId(null);
  }, [items, selectedItemId]);

  useEffect(() => {
    if (openListId && !nodes.some((node) => node.id === openListId && node.kind === 'list')) setOpenListId(null);
  }, [nodes, openListId]);

  useEffect(() => {
    if (editing?.type === 'node' && !nodes.some((node) => node.id === editing.id)) setEditing(null);
    if (editing?.type === 'item' && !items.some((item) => item.id === editing.id)) setEditing(null);
  }, [nodes, items, editing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (confirm) { setConfirm(null); return; }
      if (menu) { setMenu(null); return; }
      if (accountOpen) { setAccountOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, menu, accountOpen]);

  function setTheme(next: Theme) {
    if (themeRef.current === next) return;
    themeRef.current = next;
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem('saphire-theme', next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#efefec' : '#0f0f0f');
    pushLog(next === 'light' ? 'Включена светлая тема' : 'Включена тёмная тема');
  }

  async function loginDev() {
    try {
      await api('/api/auth/dev', { method: 'POST' });
      const session = await api<Session>('/api/auth/session');
      setUser(session.user);
      const board = await getBoard();
      adopt(board);
      openSaved(board);
    } catch (error) {
      warn(error instanceof Error ? error.message : 'Не удалось сохранить');
    }
  }

  function loginGoogle() {
    if (!googleEnabled) {
      warn('Вход через Google не настроен');
      return;
    }
    window.location.assign('/api/auth/google');
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch { /* the local session still ends */ }
    setUser(null);
    setAccountOpen(false);
    put({ nodes: [], items: [] });
    setOpenListId(null);
    setSelectedNodeId(null);
    setSelectedItemId(null);
    setEditing(null);
    setMenu(null);
  }

  function clearNodeSelection() { setSelectedNodeId(null); }
  function clearItemSelection() { setSelectedItemId(null); }
  function selectItem(id: string) { setSelectedItemId(id); }

  function selectNode(id: string) {
    if (!nodesRef.current.some((entry) => entry.id === id)) return;
    setSelectedNodeId(id);
  }

  function openNode(id: string) {
    const node = nodesRef.current.find((entry) => entry.id === id);
    if (!node) return;
    setSelectedNodeId(id);
    if (node.kind === 'folder') {
      if (node.expanded) return;
      const next = nodesRef.current.map((entry) => entry.id === id ? { ...entry, expanded: true } : entry);
      commit(
        () => put({ nodes: next }),
        () => api(`/api/nodes/${id}`, { method: 'PATCH', body: { expanded: true } }),
        `Папка «${node.title}» открыта`,
      );
      return;
    }
    setOpenListId(id);
    setMobileView('list');
    localStorage.setItem('saphire-open-list', id);
  }

  function activateNode(id: string, toggle = false) {
    const node = nodesRef.current.find((entry) => entry.id === id);
    if (!node) return;
    setSelectedNodeId(id);
    if (node.kind === 'folder') {
      if (!toggle) return;
      const expanded = !node.expanded;
      const next = nodesRef.current.map((entry) => entry.id === id ? { ...entry, expanded } : entry);
      commit(
        () => put({ nodes: next }),
        () => api(`/api/nodes/${id}`, { method: 'PATCH', body: { expanded } }),
        expanded ? `Папка «${node.title}» открыта` : `Папка «${node.title}» закрыта`,
      );
      return;
    }
    setOpenListId(id);
    setMobileView('list');
    localStorage.setItem('saphire-open-list', id);
  }

  function beginRenameNode(id: string) {
    const node = nodesRef.current.find((entry) => entry.id === id);
    if (!node) return;
    setSelectedNodeId(id);
    if (node.kind === 'list') {
      setOpenListId(id);
      localStorage.setItem('saphire-open-list', id);
    }
    setMobileView('tree');
    setEditing({ type: 'node', id });
  }

  function beginRenameItem(id: string) {
    setSelectedItemId(id);
    setEditing({ type: 'item', id });
  }

  function cancelEdit() { setEditing(null); }

  function commitEdit(value: string) {
    const current = editingRef.current;
    if (!current) return;
    const max = current.type === 'node' ? 120 : 500;
    const previous = current.type === 'node'
      ? nodesRef.current.find((node) => node.id === current.id)?.title
      : itemsRef.current.find((item) => item.id === current.id)?.body;
    const text = value.trim();
    setEditing(null);
    if (!text) {
      warn(current.type === 'node' ? 'Название не может быть пустым' : 'Текст не может быть пустым');
      return;
    }
    if (text.length > max) {
      warn(current.type === 'node' ? 'Название длиннее 120 символов' : 'Текст длиннее 500 символов');
      return;
    }
    if (text === previous) return;
    if (current.type === 'node') {
      const node = nodesRef.current.find((entry) => entry.id === current.id);
      if (!node) return;
      const next = nodesRef.current.map((entry) => entry.id === current.id
        ? { ...entry, title: text, updatedAt: entry.kind === 'list' ? new Date().toISOString() : entry.updatedAt }
        : entry);
      commit(
        () => put({ nodes: next }),
        () => api(`/api/nodes/${current.id}`, { method: 'PATCH', body: { title: text } }),
        node.kind === 'folder' ? `Папка переименована в «${text}»` : `Список переименован в «${text}»`,
      );
      return;
    }
    const item = itemsRef.current.find((entry) => entry.id === current.id);
    if (!item) return;
    const nextItems = itemsRef.current.map((entry) => entry.id === current.id ? { ...entry, body: text } : entry);
    const nextNodes = nodesRef.current.map((node) => node.id === item.listId ? { ...node, updatedAt: new Date().toISOString() } : node);
    commit(
      () => put({ items: nextItems, nodes: nextNodes }),
      () => api(`/api/items/${current.id}`, { method: 'PATCH', body: { body: text } }),
      item.kind === 'comment' ? `Комментарий переименован в «${text}»` : `Задача переименована в «${text}»`,
    );
  }

  function cycleTask(id: string) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item || item.kind !== 'task') return;
    const status = nextStatus(item.status);
    const nextItems = applyStatus(itemsRef.current, id, status);
    const nextNodes = nodesRef.current.map((node) => node.id === item.listId ? { ...node, updatedAt: new Date().toISOString() } : node);
    const label = status === 'done' ? 'выполнена' : status === 'failed' ? 'не выполнена' : 'снова пустая';
    commit(
      () => put({ items: nextItems, nodes: nextNodes }),
      () => api(`/api/items/${id}`, { method: 'PATCH', body: { status } }),
      `Задача «${item.body}» ${label}`,
    );
  }

  function createNode(kind: 'folder' | 'list', targetId: string | null = selectedNodeRef.current) {
    const target = targetId ? nodesRef.current.find((node) => node.id === targetId) ?? null : null;
    const parentId = target?.kind === 'folder' ? target.id : target?.parentId ?? null;
    const afterId = target && target.kind === 'list' ? target.id : null;
    const title = kind === 'folder' ? 'Новая папка' : 'Новый список';
    commit(
      () => {},
      () => api<Board>('/api/nodes', { method: 'POST', body: { kind, parentId, afterId, title } }),
      kind === 'folder' ? `Создана папка «${title}»` : `Создан список «${title}»`,
      (board) => {
        if (!board.createdId) return;
        setSelectedNodeId(board.createdId);
        setEditing({ type: 'node', id: board.createdId });
        setMobileView('tree');
        const created = board.nodes.find((node) => node.id === board.createdId);
        if (created?.kind === 'list') {
          setOpenListId(created.id);
          localStorage.setItem('saphire-open-list', created.id);
        }
      },
    );
  }

  function createItem(kind: 'task' | 'comment' | 'subtask') {
    const listId = openListId;
    if (!listId) return;
    let parentId: string | null = null;
    if (kind === 'subtask') {
      const selected = itemsRef.current.find((item) => item.id === selectedItemId);
      if (!selected || selected.kind !== 'task' || selected.parentId || selected.listId !== listId) {
        warn('Подзадача остаётся на одном уровне');
        return;
      }
      parentId = selected.id;
    }
    const text = kind === 'comment' ? 'Комментарий' : kind === 'subtask' ? 'Подзадача' : 'Новая задача';
    const apiKind = kind === 'comment' ? 'comment' : 'task';
    commit(
      () => {},
      () => api<Board>('/api/items', { method: 'POST', body: { listId, parentId, kind: apiKind, body: text } }),
      kind === 'comment' ? 'Добавлен комментарий' : kind === 'subtask' ? 'Добавлена подзадача' : 'Добавлена задача',
      (board) => {
        if (!board.createdId) return;
        setSelectedItemId(board.createdId);
        setEditing({ type: 'item', id: board.createdId });
      },
    );
  }

  function copyNode(id: string) {
    const node = nodesRef.current.find((entry) => entry.id === id);
    if (!node) return;
    commit(
      () => {},
      () => api<Board>(`/api/nodes/${id}/copy`, { method: 'POST' }),
      node.kind === 'folder' ? `Скопирована папка «${node.title}»` : `Скопирован список «${node.title}»`,
      (board) => {
        if (!board.createdId) return;
        setSelectedNodeId(board.createdId);
        const created = board.nodes.find((entry) => entry.id === board.createdId);
        if (created?.kind === 'list') {
          setOpenListId(created.id);
          localStorage.setItem('saphire-open-list', created.id);
        }
      },
    );
  }

  function askRemove(id: string) {
    const node = nodesRef.current.find((entry) => entry.id === id);
    if (!node) return;
    setSelectedNodeId(id);
    if (needsConfirm(node, nodesRef.current, itemsRef.current)) setConfirm({ id });
    else removeNode(id);
  }

  function removeNode(id: string) {
    const node = nodesRef.current.find((entry) => entry.id === id);
    if (!node) return;
    const drop = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const current = stack.pop();
      if (!current || drop.has(current)) continue;
      drop.add(current);
      for (const entry of nodesRef.current) if (entry.parentId === current) stack.push(entry.id);
    }
    const listIds = new Set(nodesRef.current.filter((entry) => drop.has(entry.id) && entry.kind === 'list').map((entry) => entry.id));
    setConfirm(null);
    commit(
      () => put({
        nodes: nodesRef.current.filter((entry) => !drop.has(entry.id)),
        items: itemsRef.current.filter((entry) => !listIds.has(entry.listId)),
      }),
      () => api<Board>(`/api/nodes/${id}`, { method: 'DELETE' }),
      node.kind === 'folder' ? `Удалена папка «${node.title}»` : `Удалён список «${node.title}»`,
    );
  }

  function confirmDelete() {
    if (confirm) removeNode(confirm.id);
  }

  function cancelDelete() { setConfirm(null); }

  function removeItem(id: string) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item) return;
    const ids = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of itemsRef.current) {
        if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) {
          ids.add(entry.id);
          grew = true;
        }
      }
    }
    const nextItems = itemsRef.current.filter((entry) => !ids.has(entry.id));
    const nextNodes = nodesRef.current.map((node) => node.id === item.listId ? { ...node, updatedAt: new Date().toISOString() } : node);
    if (selectedItemId && ids.has(selectedItemId)) {
      setSelectedItemId(itemAfterRemoval(itemsRef.current, item.listId, ids, selectedItemId));
    }
    commit(
      () => put({ items: nextItems, nodes: nextNodes }),
      () => api<Board>(`/api/items/${id}`, { method: 'DELETE' }),
      item.kind === 'comment' ? `Удалён комментарий «${item.body}»` : `Удалена задача «${item.body}»`,
    );
  }

  function applySort(targetId: string | null, by: SortBy, dir: SortDir) {
    const target = targetId ? nodesRef.current.find((node) => node.id === targetId) ?? null : null;
    const parentId = !target ? null : target.kind === 'folder' ? target.id : target.parentId;
    const current = childrenOf(nodesRef.current, parentId);
    const kids = current.slice().sort((a, b) => compareNodes(a, b, by, dir));
    const same = kids.every((node, index) => node.id === current[index]?.id);
    if (same) return false;
    const order = new Map(kids.map((node, index) => [node.id, index]));
    const next = nodesRef.current.map((node) => (order.has(node.id) ? { ...node, position: order.get(node.id) ?? node.position } : node));
    const label = by === 'time'
      ? (dir === 'desc' ? 'Отсортировано по времени' : 'Отсортировано по времени, наоборот')
      : (dir === 'asc' ? 'Отсортировано по алфавиту' : 'Отсортировано по алфавиту, наоборот');
    commit(
      () => put({ nodes: next }),
      () => api<Board>('/api/nodes/sort', { method: 'POST', body: { parentId, by, dir } }),
      label,
    );
    return true;
  }

  function rememberSort(by: SortBy, dir: SortDir) {
    sortByRef.current = by;
    sortDirRef.current = dir;
    setSortBy(by);
    setSortDir(dir);
    localStorage.setItem('saphire-sort', by);
    localStorage.setItem('saphire-sort-dir', dir);
  }

  function sortNodes(targetId: string | null) {
    const by = sortByRef.current;
    let dir = sortDirRef.current;
    if (!applySort(targetId, by, dir)) {
      dir = dir === 'asc' ? 'desc' : 'asc';
      rememberSort(by, dir);
      if (!applySort(targetId, by, dir)) pushLog(by === 'time' ? 'Порядок по времени не изменился' : 'Порядок по алфавиту не изменился');
      return;
    }
    rememberSort(by, dir);
  }

  function chooseSort(by: SortBy) {
    const dir: SortDir = sortByRef.current === by
      ? (sortDirRef.current === 'asc' ? 'desc' : 'asc')
      : (by === 'time' ? 'desc' : 'asc');
    rememberSort(by, dir);
    if (!applySort(selectedNodeRef.current, by, dir)) {
      pushLog(by === 'time' ? 'Порядок по времени не изменился' : 'Порядок по алфавиту не изменился');
    }
  }

  function toggleCompletedFirst() {
    const next = !completedFirstRef.current;
    completedFirstRef.current = next;
    setCompletedFirst(next);
    localStorage.setItem('saphire-completed-first', next ? '1' : '0');
    pushLog(next ? 'Сначала выполненные' : 'Сначала невыполненные');
  }

  function moveNodes(movingId: string, groups: Group[]) {
    const node = nodesRef.current.find((entry) => entry.id === movingId);
    if (!node) return;
    const next = nodesRef.current.map((entry) => ({ ...entry }));
    for (const group of groups) {
      group.orderedIds.forEach((id, index) => {
        const found = next.find((entry) => entry.id === id);
        if (!found) return;
        found.parentId = group.parentId;
        found.position = index;
      });
      if (group.parentId) {
        const parent = next.find((entry) => entry.id === group.parentId);
        if (parent?.kind === 'folder') parent.expanded = true;
      }
    }
    commit(
      () => put({ nodes: next }),
      () => api<Board>('/api/nodes/layout', { method: 'POST', body: { groups } }),
      node.kind === 'folder' ? `Папка «${node.title}» перенесена` : `Список «${node.title}» перенесён`,
    );
  }

  function moveItems(movingId: string, groups: Group[]) {
    const item = itemsRef.current.find((entry) => entry.id === movingId);
    if (!item) return;
    const nextItems = itemsRef.current.map((entry) => ({ ...entry }));
    for (const group of groups) {
      group.orderedIds.forEach((id, index) => {
        const found = nextItems.find((entry) => entry.id === id);
        if (!found) return;
        found.parentId = group.parentId;
        found.position = index;
      });
    }
    const nextNodes = nodesRef.current.map((node) => node.id === item.listId ? { ...node, updatedAt: new Date().toISOString() } : node);
    commit(
      () => put({ items: nextItems, nodes: nextNodes }),
      () => api<Board>('/api/items/layout', { method: 'POST', body: { groups } }),
      item.kind === 'comment' ? `Комментарий «${item.body}» перенесён` : `Задача «${item.body}» перенесена`,
    );
  }

  function openSortMenu(x: number, y: number) {
    setAccountOpen(false);
    setMenu({ x, y, area: 'sort' });
  }

  function openTreeMenu(x: number, y: number, nodeId: string | null) {
    if (nodeId) setSelectedNodeId(nodeId);
    setAccountOpen(false);
    setMenu({ x, y, area: 'tree', nodeId });
  }

  function openEditorMenu(x: number, y: number, itemId: string | null) {
    if (itemId) setSelectedItemId(itemId);
    setAccountOpen(false);
    setMenu({ x, y, area: 'editor', itemId });
  }

  function closeMenu() { setMenu(null); }

  function snapshot() {
    return { nodes: nodesRef.current, items: itemsRef.current, search: searchRef.current };
  }

  const value: BoardApi = {
    ready, user, googleEnabled, nodes, items, selectedNodeId, selectedItemId, openListId, editing, warning, log, search, sortBy, sortDir, completedFirst, theme, mobileView,
    menu, confirm, accountOpen, draggingWarning, warningHot,
    setSearch, setTheme, setMobileView, setDraggingWarning, setWarningHot, warn, fileWarning,
    loginDev, loginGoogle, logout, setAccountOpen, clearNodeSelection, clearItemSelection, selectItem,
    activateNode, selectNode, openNode, beginRenameNode, beginRenameItem, cycleTask, commitEdit, cancelEdit,
    createNode, createItem, copyNode, askRemove, removeItem, confirmDelete, cancelDelete,
    sortNodes, chooseSort, toggleCompletedFirst, moveNodes, moveItems, openSortMenu, openTreeMenu, openEditorMenu, closeMenu, snapshot,
  };

  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
