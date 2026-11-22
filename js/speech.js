// speech.js — طبقة الصوت: تحويل الكلام إلى نص (STT) والنص إلى كلام (TTS)
// Web Speech API في المتصفح — بدون خوادم أو مفاتيح.

export function createSpeech({ settings, onState = () => {} } = {}) {
  const SpeechRecognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const sttSupported = Boolean(SpeechRecognition);

  let recognition = null;
  let listening = false;
  let speaking = false;
  let silenceTimer = null;

  function getSettings() {
    try {
      return settings ? settings.getAll() : JSON.parse(localStorage.getItem('mosaadi.settings.v1') || '{}');
    } catch {
      return {};
    }
  }

  function getLang() {
    const s = getSettings();
    return s.language || 'ar-EG';
  }

  // ---------- STT ----------

  function startListening({ onResult, onEnd, onError } = {}) {
    if (!sttSupported) {
      onError && onError('متصفحك لا يدعم التعرف على الكلام — استخدم Chrome على Android');
      return false;
    }
    stopListening();
    recognition = new SpeechRecognition();
    recognition.lang = getLang();
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      onResult && onResult(final, interim);
      // توقف تلقائي بعد صمت
      if (final) {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => stopListening(), 1200);
      }
    };
    recognition.onerror = (e) => {
      listening = false;
      onState({ listening: false });
      if (e.error === 'not-allowed') {
        onError && onError('رُفض إذن الميكروفون — اسمح بالوصول من إعدادات المتصفح');
      } else if (e.error !== 'aborted') {
        onError && onError('خطأ في الميكروفون: ' + e.error);
      }
    };
    recognition.onend = () => {
      listening = false;
      onState({ listening: false });
      onEnd && onEnd();
    };

    try {
      recognition.start();
      listening = true;
      onState({ listening: true });
      return true;
    } catch (e) {
      onError && onError('تعذّر تشغيل الميكروفون: ' + e.message);
      return false;
    }
  }

  function stopListening() {
    clearTimeout(silenceTimer);
    if (recognition) {
      try { recognition.stop(); } catch {}
      recognition = null;
    }
    listening = false;
    onState({ listening: false });
  }

  // ---------- TTS ----------

  function pickVoice() {
    if (!ttsSupported) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const lang = getLang();
    const langPrefix = lang.split('-')[0]; // ar
    return (
      voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang.startsWith(langPrefix)) ||
      null
    );
  }

  function speak(text, { onDone } = {}) {
    if (!ttsSupported) {
      onDone && onDone();
      return false;
    }
    stopSpeaking();
    const s = getSettings();
    const utter = new SpeechSynthesisUtterance(String(text));
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.lang = voice ? voice.lang : getLang();
    utter.rate = Number(s.voiceRate) || 1.0;
    utter.pitch = Number(s.voicePitch) || 1.0;
    utter.onstart = () => { speaking = true; onState({ speaking: true }); };
    utter.onend = () => { speaking = false; onState({ speaking: false }); onDone && onDone(); };
    utter.onerror = () => { speaking = false; onState({ speaking: false }); onDone && onDone(); };
    window.speechSynthesis.speak(utter);
    return true;
  }

  function stopSpeaking() {
    if (ttsSupported) window.speechSynthesis.cancel();
    speaking = false;
    onState({ speaking: false });
  }

  function stopAll() {
    stopListening();
    stopSpeaking();
  }

  return {
    sttSupported,
    ttsSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    stopAll,
    isListening: () => listening,
    isSpeaking: () => speaking,
    // تحميل الأصوات مبكرًا (Chrome يحتاج حدث voiceschanged)
    warmUp() {
      if (ttsSupported) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
      }
    },
  };
}
