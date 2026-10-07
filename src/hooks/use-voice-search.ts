'use client';

// Minimal, dependency-free Web Speech API wrapper for voice search.
// Safari/Chrome expose `webkitSpeechRecognition`; Firefox has none — the hook
// reports unsupported and the mic button simply stays hidden.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionEventLike {
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const voiceSupportSubscribe = () => () => undefined;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isVoiceSearchSupported(): boolean {
  return getRecognitionCtor() !== null;
}

/**
 * One-shot dictation for the search field: start() listens until a final
 * result (or an error / manual stop), then calls onResult with the transcript.
 */
export function useVoiceSearch(onResult: (transcript: string) => void) {
  const [listening, setListening] = useState(false);
  // Hydration-safe support flag: the server snapshot is `false`, so SSR and
  // the first client render agree (no mic button); the real answer lands in
  // the same tick hydration completes — no setState-in-effect, no mismatch.
  const supported = useSyncExternalStore(
    voiceSupportSubscribe,
    () => getRecognitionCtor() !== null,
    () => false,
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(onResult);

  // Keep the callback ref fresh without re-creating the recognizer.
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // already stopped
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || listening) return;
    try {
      const rec = new Ctor();
      rec.lang = 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event) => {
        const result = event.results?.[0];
        const transcript = result?.[0]?.transcript?.trim();
        if (transcript) onResultRef.current(transcript);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, toggle };
}
