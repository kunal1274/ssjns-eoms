import { useState, useEffect } from "react";
export function PwaInstall() {
  const [prompt, setPrompt] = useState<any>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return (
    <div>
      {prompt ? (
        <button
          className="secondary"
          onClick={async () => {
            await prompt.prompt();
            setPrompt(null);
          }}
        >
          Install app
        </button>
      ) : (
        <small>Install from your browser menu when available.</small>
      )}
    </div>
  );
}
