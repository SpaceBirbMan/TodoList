export type NodeKind = 'folder' | 'list';
export type ItemKind = 'task' | 'comment';
export type Status = 'empty' | 'done' | 'failed';
export type Place = 'before' | 'inside' | 'after';

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  title: string;
  expanded: boolean;
  position: number;
  updatedAt: string;
};

export type ListItem = {
  id: string;
  listId: string;
  parentId: string | null;
  kind: ItemKind;
  body: string;
  status: Status;
  position: number;
};

export type Board = {
  nodes: TreeNode[];
  items: ListItem[];
  createdId?: string | null;
};

export type User = {
  id: string;
  name: string;
  email: string;
  picture: string | null;
};

export type Group = { parentId: string | null; orderedIds: string[] };

export type Editing = { type: 'node' | 'item'; id: string } | null;

export type SortBy = 'alpha' | 'time';
export type SortDir = 'asc' | 'desc';

export type MenuState =
  | { x: number; y: number; area: 'tree'; nodeId: string | null }
  | { x: number; y: number; area: 'editor'; itemId: string | null }
  | { x: number; y: number; area: 'sort' };

export type LogLine = { id: string; at: number; message: string };

export type Session = { user: User | null; google: boolean };
