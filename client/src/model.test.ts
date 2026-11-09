import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyStatus, isListComplete, itemAfterRemoval, nextStatus, orderedSiblings, planNodeMove, searchView } from './model';
import type { ListItem, TreeNode } from './types';

function node(partial: Partial<TreeNode> & Pick<TreeNode, 'id' | 'kind' | 'title'>): TreeNode {
  return {
    parentId: null,
    expanded: false,
    position: 0,
    updatedAt: '2026-11-09T00:00:00.000Z',
    ...partial,
  };
}

function task(partial: Partial<ListItem> & Pick<ListItem, 'id' | 'body'>): ListItem {
  return {
    listId: 'list',
    parentId: null,
    kind: 'task',
    status: 'empty',
    position: 0,
    ...partial,
  };
}

describe('статусы', () => {
  it('крутит пусто → выполнено → не выполнено', () => {
    assert.equal(nextStatus('empty'), 'done');
    assert.equal(nextStatus('done'), 'failed');
    assert.equal(nextStatus('failed'), 'empty');
  });

  it('ставит статус задаче и подзадачам, комментарий не трогает', () => {
    const items = [
      task({ id: 'a', body: 'A' }),
      task({ id: 'b', body: 'B', parentId: 'a' }),
      task({ id: 'c', body: 'C', parentId: 'b', kind: 'comment' }),
    ];
    const next = applyStatus(items, 'a', 'done');
    assert.deepEqual(next.map((item) => item.status), ['done', 'done', 'empty']);
  });
});

describe('завершение', () => {
  it('пустой список не завершён', () => {
    assert.equal(isListComplete('list', [task({ id: 'c', body: 'note', kind: 'comment' })]), false);
  });

  it('список завершён, только если все задачи выполнены', () => {
    assert.equal(isListComplete('list', [task({ id: 'a', body: 'A', status: 'done' })]), true);
    assert.equal(isListComplete('list', [
      task({ id: 'a', body: 'A', status: 'done' }),
      task({ id: 'b', body: 'B', status: 'failed' }),
    ]), false);
  });
});

describe('порядок', () => {
  const nodes = [
    node({ id: 'open', kind: 'list', title: 'Open', position: 0 }),
    node({ id: 'done', kind: 'list', title: 'Done', position: 1 }),
  ];
  const items = [task({ id: 't', listId: 'done', body: 'T', status: 'done' })];

  it('сначала выполненные поднимает закрытый список', () => {
    assert.deepEqual(orderedSiblings(nodes, items, null, false).map((entry) => entry.id), ['open', 'done']);
    assert.deepEqual(orderedSiblings(nodes, items, null, true).map((entry) => entry.id), ['done', 'open']);
  });

  it('папку нельзя вложить саму в себя', () => {
    const folder = node({ id: 'folder', kind: 'folder', title: 'Folder' });
    assert.equal(planNodeMove([folder], [], 'folder', 'folder', 'inside'), null);
  });
});

describe('удаление', () => {
  const items = [
    task({ id: 'a', body: 'A', position: 0 }),
    task({ id: 'a1', body: 'A1', parentId: 'a', position: 0 }),
    task({ id: 'b', body: 'B', position: 1 }),
    task({ id: 'c', body: 'C', position: 2 }),
  ];

  it('после удаления выбирает элемент выше', () => {
    assert.equal(itemAfterRemoval(items, 'list', new Set(['b']), 'b'), 'a1');
  });

  it('если выше нечего выбирать, берёт элемент ниже', () => {
    assert.equal(itemAfterRemoval(items, 'list', new Set(['a', 'a1']), 'a'), 'b');
    assert.equal(itemAfterRemoval([task({ id: 'a', body: 'A' })], 'list', new Set(['a']), 'a'), null);
  });
});

describe('поиск', () => {
  it('показывает предка совпадения', () => {
    const nodes = [
      node({ id: 'folder', kind: 'folder', title: 'Folder' }),
      node({ id: 'list', kind: 'list', title: 'List 7', parentId: 'folder' }),
    ];
    const found = searchView(nodes, 'list 7');
    assert.equal(found?.visible.has('folder'), true);
    assert.equal(found?.visible.has('list'), true);
    assert.equal(found?.forced.has('folder'), true);
  });
});
