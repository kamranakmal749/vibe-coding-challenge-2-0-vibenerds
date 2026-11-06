export function BackgroundBlobs() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-[-1]">
      {/* Blue Blob */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-500 rounded-full mix-blend-multiply filter blur-[100px] opacity-40 dark:opacity-30 dark:mix-blend-screen animate-blob" />
      
      {/* Red/Rose Blob */}
      <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-rose-500 rounded-full mix-blend-multiply filter blur-[100px] opacity-40 dark:opacity-30 dark:mix-blend-screen animate-blob-slow" style={{ animationDelay: '2s' }} />
      
      {/* Emerald Blob */}
      <div className="absolute top-[40%] left-[30%] w-[300px] h-[300px] bg-emerald-500 rounded-full mix-blend-multiply filter blur-[100px] opacity-30 dark:opacity-20 dark:mix-blend-screen animate-blob" style={{ animationDelay: '4s' }} />
    </div>
  );
}
export default BackgroundBlobs;

