import { useEffect } from 'react';
import { useBoard } from './board';
import { Icon } from './icon';

export function ContextMenu() {
  const board = useBoard();
  const menu = board.menu;
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.menu')) return;
      board.closeMenu();
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu, board]);

  if (!menu) return null;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 228));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 280));
  const entries: { id: string; label: string; run: () => void; danger?: boolean; checked?: boolean }[] = [];
  if (menu.area === 'sort') {
    entries.push(
      { id: 'alpha', label: 'По алфавиту', checked: board.sortBy === 'alpha', run: () => board.chooseSort('alpha') },
      { id: 'time', label: 'По времени', checked: board.sortBy === 'time', run: () => board.chooseSort('time') },
      { id: 'done-first', label: 'Сначала выполненные', checked: board.completedFirst, run: () => board.toggleCompletedFirst() },
    );
  } else if (menu.area === 'tree') {
    const node = menu.nodeId ? board.nodes.find((entry) => entry.id === menu.nodeId) : null;
    if (node) entries.push({ id: 'rename', label: 'Переименовать', run: () => board.beginRenameNode(node.id) });
    entries.push({ id: 'add-list', label: 'Добавить список', run: () => board.createNode('list', menu.nodeId) });
    entries.push({ id: 'add-folder', label: 'Добавить папку', run: () => board.createNode('folder', menu.nodeId) });
    if (node) entries.push({ id: 'copy', label: 'Копировать', run: () => board.copyNode(node.id) });
    if (node) entries.push({ id: 'delete', label: 'Удалить', run: () => board.askRemove(node.id), danger: true });
  } else if (board.openListId) {
    const item = menu.itemId ? board.items.find((entry) => entry.id === menu.itemId) : null;
    if (item) entries.push({ id: 'rename', label: 'Переименовать', run: () => board.beginRenameItem(item.id) });
    entries.push({ id: 'add-task', label: 'Добавить задачу', run: () => board.createItem('task') });
    entries.push({ id: 'add-comment', label: 'Добавить комментарий', run: () => board.createItem('comment') });
    if (item?.kind === 'task' && !item.parentId) entries.push({ id: 'add-sub', label: 'Добавить подзадачу', run: () => board.createItem('subtask') });
    if (item) entries.push({ id: 'delete', label: 'Удалить', run: () => board.removeItem(item.id), danger: true });
  }
  if (!entries.length) return null;
  return (
    <div className="menu" role="menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
      {entries.map((entry) => (
        <button key={entry.id} type="button" role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={entry.checked} className={[entry.danger ? 'danger' : '', entry.checked ? 'checked' : ''].filter(Boolean).join(' ') || undefined} onClick={() => { board.closeMenu(); entry.run(); }}>
          {entry.label}
        </button>
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const board = useBoard();
  const node = board.confirm ? board.nodes.find((entry) => entry.id === board.confirm?.id) : null;
  if (!board.confirm || !node) return null;
  const question = node.kind === 'folder' ? `Удалить папку «${node.title}»?` : `Удалить список «${node.title}»?`;
  return (
    <div className="overlay" onMouseDown={board.cancelDelete}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
        <Icon name="trash" className="dialog-icon" />
        <p id="delete-title">{question}</p>
        <div className="actions">
          <button type="button" className="btn btn-danger" data-action="confirm-delete" onClick={board.confirmDelete}>Удалить</button>
          <button type="button" className="btn btn-cancel" data-action="confirm-cancel" autoFocus onClick={board.cancelDelete}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

export function AccountMenu() {
  const board = useBoard();
  useEffect(() => {
    if (!board.accountOpen) return;
    const close = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.account, .account-menu')) return;
      board.setAccountOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [board.accountOpen, board]);
  if (!board.accountOpen || !board.user) return null;
  return (
    <div className="account-menu">
      <p className="account-name">{board.user.name}</p>
      {board.user.email ? <p className="account-email">{board.user.email}</p> : null}
      <button type="button" onClick={() => void board.logout()}>Выйти</button>
    </div>
  );
}
