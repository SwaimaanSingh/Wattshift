/** Screen 2 — progress while the bill is read. */
export default function ProcessingScreen({ stage, progress, fileCount }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="relative h-20 w-20" aria-hidden="true">
        <div className="absolute inset-0 animate-pulse-soft rounded-full bg-solar-100 dark:bg-solar-900/40" />
        <svg
          className="absolute inset-0 m-auto h-9 w-9 animate-pulse-soft text-solar-600"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M13.2 2.2a.6.6 0 0 1 1 .6l-1.9 6.1h4.4a.6.6 0 0 1 .47.98l-8.4 10.9a.6.6 0 0 1-1.04-.55l1.9-6.1H5.3a.6.6 0 0 1-.47-.98l8.37-10.95Z" />
        </svg>
      </div>

      <p
        className="mt-7 text-lg font-semibold"
        role="status"
        aria-live="polite"
      >
        {stage || 'Reading your bill…'}
      </p>

      <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
        {fileCount > 1
          ? `Working through ${fileCount} files — this happens on your device.`
          : 'This happens on your device. Nothing is uploaded.'}
      </p>

      <div className="mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
        <div
          className={`h-full rounded-full bg-solar-600 transition-[width] duration-500 ${
            progress == null ? 'w-1/3 animate-pulse-soft' : ''
          }`}
          style={progress != null ? { width: `${Math.round(progress * 100)}%` } : undefined}
        />
      </div>
    </div>
  );
}
