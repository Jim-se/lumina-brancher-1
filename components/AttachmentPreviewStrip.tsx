import React, { useEffect, useMemo, useRef, useState } from 'react';

type Density = 'compact' | 'comfortable';

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, unitIndex);
  const digits = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toUpperCase();
}

function getDisplayType(file: File) {
  if (file.type) return file.type;
  const ext = getExtension(file.name);
  return ext ? `${ext} file` : 'File';
}

function isImage(file: File) {
  return file.type.startsWith('image/');
}

function DocumentIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3h7l3 3v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 12h8M8 16h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function AttachmentPreviewStrip({
  files,
  onRemove,
  density = 'comfortable',
  className = '',
}: {
  files: File[];
  onRemove: (index: number) => void;
  density?: Density;
  className?: string;
}) {
  const objectUrlsRef = useRef<Map<File, string>>(new Map());
  const [, forceRender] = useState(0);

  useEffect(() => {
    const map = objectUrlsRef.current;
    const next = new Set(files);
    let didChange = false;

    for (const [file, url] of map.entries()) {
      if (!next.has(file)) {
        URL.revokeObjectURL(url);
        map.delete(file);
        didChange = true;
      }
    }

    for (const file of files) {
      if (isImage(file) && !map.has(file)) {
        map.set(file, URL.createObjectURL(file));
        didChange = true;
      }
    }

    if (didChange) forceRender((v) => v + 1);
  }, [files]);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current.values()) URL.revokeObjectURL(url);
      objectUrlsRef.current.clear();
    };
  }, []);

  const sizing = useMemo(() => {
    if (density === 'compact') {
      return {
        container: 'gap-2',
        card: 'rounded-lg px-2 py-1.5',
        thumbWrap: 'w-8 h-8 rounded-md',
        name: 'text-[10px]',
        meta: 'text-[9px]',
        removeBtn: 'w-7 h-7',
        removeIcon: 'w-3.5 h-3.5',
        extBadge: 'text-[9px] px-1.5 py-0.5 rounded-md',
        icon: 'w-4 h-4',
      };
    }

    return {
      container: 'gap-3',
      card: 'rounded-xl px-3 py-2',
      thumbWrap: 'w-10 h-10 rounded-lg',
      name: 'text-xs',
      meta: 'text-[10px]',
      removeBtn: 'w-8 h-8',
      removeIcon: 'w-4 h-4',
      extBadge: 'text-[10px] px-2 py-0.5 rounded-lg',
      icon: 'w-5 h-5',
    };
  }, [density]);

  return (
    <div className={`w-full flex overflow-x-auto custom-scrollbar ${sizing.container} ${className}`}>
      {files.map((file, index) => {
        const isImg = isImage(file);
        const url = isImg ? objectUrlsRef.current.get(file) : undefined;
        const ext = getExtension(file.name);

        return (
          <div
            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
            className={`group relative flex items-center gap-2 shrink-0 border border-[var(--border-color)] bg-[var(--sidebar-bg)]/60 hover:bg-[var(--sidebar-bg)] transition-colors ${sizing.card}`}
            title={file.name}
          >
            <div
              className={`shrink-0 overflow-hidden border border-[var(--border-color)] bg-[var(--card-bg)] ${sizing.thumbWrap}`}
            >
              {isImg && url ? (
                <img src={url} alt={file.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-[var(--app-text-muted)]">
                  <DocumentIcon className={sizing.icon} />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className={`truncate font-semibold text-[var(--app-text)] ${sizing.name}`}>{file.name}</div>
              <div className={`flex items-center gap-1 text-[var(--app-text-muted)] ${sizing.meta}`}>
                <span className="truncate max-w-[160px]">{getDisplayType(file)}</span>
                <span aria-hidden="true">•</span>
                <span>{formatBytes(file.size)}</span>
              </div>
            </div>

            {ext && !isImg && (
              <span
                className={`ml-1 text-[var(--app-text-muted)] border border-[var(--border-color)] bg-[var(--card-bg)] ${sizing.extBadge}`}
              >
                {ext}
              </span>
            )}

            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`Remove ${file.name}`}
              className={`ml-1 inline-flex items-center justify-center rounded-full text-[var(--app-text-muted)] hover:text-red-500 hover:bg-[var(--card-bg)] transition-colors ${sizing.removeBtn}`}
            >
              <CloseIcon className={sizing.removeIcon} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
