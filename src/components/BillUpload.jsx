import { useCallback, useRef, useState } from 'react';

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*';
const MAX_FILE_MB = 25;

/**
 * Drag-and-drop plus tap-to-select. On phones the whole zone is the tap
 * target, and the file input accepts camera capture for photos of bills.
 */
export default function BillUpload({ onFiles, compact = false }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const accept = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      const tooBig = files.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
      if (tooBig) {
        setError(`${tooBig.name} is larger than ${MAX_FILE_MB} MB.`);
        return;
      }

      const unsupported = files.find(
        (f) => !/\.(pdf|png|jpe?g|webp|heic)$/i.test(f.name) && !f.type.startsWith('image/')
      );
      if (unsupported) {
        setError(`${unsupported.name} isn't a PDF or an image.`);
        return;
      }

      setError(null);
      onFiles(files);
    },
    [onFiles]
  );

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload your electricity bill"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'group flex w-full cursor-pointer flex-col items-center justify-center',
          'rounded-2xl border-2 border-dashed text-center transition-colors',
          compact ? 'gap-2 px-5 py-6' : 'gap-3 px-6 py-12',
          dragging
            ? 'border-solar-600 bg-solar-50 dark:bg-solar-900/20'
            : 'border-ink-300 bg-ink-50/60 hover:border-solar-500 hover:bg-solar-50/50 dark:border-ink-700 dark:bg-ink-900/50 dark:hover:bg-solar-900/10',
        ].join(' ')}
      >
        <svg
          className={`${compact ? 'h-8 w-8' : 'h-11 w-11'} text-solar-600 transition-transform group-hover:-translate-y-0.5`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.6}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16.5V4.5m0 0L7.5 9M12 4.5 16.5 9M4.5 16.5v1.75A2.25 2.25 0 0 0 6.75 20.5h10.5a2.25 2.25 0 0 0 2.25-2.25V16.5"
          />
        </svg>

        <p className={`font-semibold ${compact ? 'text-base' : 'text-lg'}`}>
          <span className="hidden sm:inline">Drop your electricity bill here, or </span>
          <span className="text-solar-700 underline decoration-solar-300 underline-offset-4 dark:text-solar-400">
            tap to select
          </span>
        </p>

        {!compact && (
          <p className="max-w-xs text-sm text-ink-500 dark:text-ink-400">
            PDF or a photo. Upload 1 or more bills — more bills means a better
            estimate.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
