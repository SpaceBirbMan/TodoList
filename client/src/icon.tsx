import add from './icons/add.svg?raw';
import arrowLeft from './icons/arrow-left.svg?raw';
import closeCircle from './icons/close-circle.svg?raw';
import danger from './icons/danger.svg?raw';
import documentCopy from './icons/document-copy.svg?raw';
import documentText from './icons/document-text.svg?raw';
import documentIcon from './icons/document.svg?raw';
import folderAdd from './icons/folder-add.svg?raw';
import folderOpen from './icons/folder-open.svg?raw';
import folder from './icons/folder.svg?raw';
import messageEdit from './icons/message-edit.svg?raw';
import minusCircle from './icons/minus-cirlce.svg?raw';
import moon from './icons/moon.svg?raw';
import profile from './icons/profile-circle.svg?raw';
import sort from './icons/sort.svg?raw';
import sun from './icons/sun.svg?raw';
import tick from './icons/tick-circle-1.svg?raw';
import circle from './icons/tick-circle.svg?raw';
import trash from './icons/trash.svg?raw';

const RAW = {
  add,
  arrowLeft,
  closeCircle,
  danger,
  documentCopy,
  documentText,
  document: documentIcon,
  folderAdd,
  folderOpen,
  folder,
  messageEdit,
  minusCircle,
  moon,
  profile,
  sort,
  sun,
  tick,
  circle,
  trash,
} as const;

export type IconName = keyof typeof RAW;

function paint(raw: string) {
  return raw
    .replace(/fill="[^"]*"/g, 'fill="currentColor"')
    .replace(/fill-opacity="[^"]*"/g, '')
    .replace(/width="[^"]*"/, 'width="100%"')
    .replace(/height="[^"]*"/, 'height="100%"');
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const html = paint(RAW[name]);
  return <span className={className ? `icon-svg ${className}` : 'icon-svg'} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className ?? 'logo'} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.5 27 11.2 16 29.5 5 11.2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M5 11.2h22M11.2 11.2 16 29.5 20.8 11.2M16 2.5 11.2 11.2M16 2.5 20.8 11.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
