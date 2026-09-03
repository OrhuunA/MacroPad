# -*- coding: utf-8 -*-
"""
MacroPad motoru
---------------
Electron arayuzu bu dosyayi alt surec olarak calistirir.
Iletisim: stdin/stdout uzerinden satir satir JSON.

Komutlar (stdin):
  {"cmd":"ping"}
  {"cmd":"start","config":{...}}
  {"cmd":"stop"}
  {"cmd":"capture"}          -> kullanicinin bir sonraki sol tikini koordinat olarak yakalar
  {"cmd":"cancel_capture"}
  {"cmd":"cursor"}           -> anlik fare konumu
  {"cmd":"quit"}

Olaylar (stdout):
  {"ev":"ready"} {"ev":"pong"} {"ev":"status"} {"ev":"progress"}
  {"ev":"started"} {"ev":"finished"} {"ev":"hotkey"} {"ev":"capture"} {"ev":"cursor"}
"""

import io
import sys
import json
import time
import threading
import traceback

try:
    from pynput import keyboard, mouse
    from pynput.keyboard import Key, Controller as KeyboardController
    from pynput.mouse import Button, Controller as MouseController
except Exception as _imp_err:
    sys.stdout.write(json.dumps({
        "ev": "fatal",
        "message": "Klavye/fare motoru yüklenemedi (pynput). Kurmak için: pip install pynput  [%s]" % _imp_err
    }) + "\n")
    sys.stdout.flush()
    sys.exit(1)


# --------------------------------------------------------------------------
# Cikti / girdi kanallari
# --------------------------------------------------------------------------
try:
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stdin.reconfigure(encoding="utf-8")
except AttributeError:                                   # Python < 3.7
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# Protokol surumu. Arayuz bunu kontrol eder: eski bir motor (ornegin
# klasorde kalmis bayat macropad-engine.exe) bulunursa atlanir.
ENGINE_VERSION = 8
FEATURES = ["text", "click", "move", "scroll", "delay", "key", "combo",
            "piano", "hotkeys", "bindings", "mouse_triggers", "hold",
            "record", "window"]

# Tuslarin/dugmelerin basili kaldigi varsayilan sure.
# 0 ms basis cogu uygulamada (ozellikle oyunlarda ve ilk tikta) hic
# gorulmez; bu yuzden basma ile birakma arasina kucuk bir sure koyuyoruz.
DEFAULT_HOLD = 0.030

_out_lock = threading.Lock()


def emit(**payload):
    line = json.dumps(payload, ensure_ascii=False)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def status(text, kind="info"):
    emit(ev="status", text=text, kind=kind)


# --------------------------------------------------------------------------
# Tus adi -> pynput anahtari
# --------------------------------------------------------------------------
SPECIAL_KEYS = {
    "enter": Key.enter, "return": Key.enter,
    "tab": Key.tab, "esc": Key.esc, "escape": Key.esc,
    "space": Key.space, "backspace": Key.backspace,
    "delete": Key.delete, "del": Key.delete, "insert": Key.insert,
    "home": Key.home, "end": Key.end,
    "pageup": Key.page_up, "pagedown": Key.page_down,
    "up": Key.up, "down": Key.down, "left": Key.left, "right": Key.right,
    "ctrl": Key.ctrl, "control": Key.ctrl,
    "alt": Key.alt, "shift": Key.shift,
    "win": Key.cmd, "cmd": Key.cmd, "super": Key.cmd,
    "capslock": Key.caps_lock,
}
for _i in range(1, 13):
    SPECIAL_KEYS["f%d" % _i] = getattr(Key, "f%d" % _i)

BUTTONS = {"left": Button.left, "right": Button.right, "middle": Button.middle}


def resolve_key(name):
    if not name:
        return None
    n = str(name).strip().lower()
    if n in SPECIAL_KEYS:
        return SPECIAL_KEYS[n]
    if len(name) == 1:
        return name
    return None



# --------------------------------------------------------------------------
# Windows fare girisi (SendInput)
#
# pynput imleci SetCursorPos ile tasiyor. Imlec dogru yere gidiyor ama
# uygulamaya "fare hareket etti" olayi ULASMIYOR; uygulama imleci hala
# eski yerinde sanip tiklamayi yok sayiyor - ozellikle dugmeler, oyunlar
# ve tarayici icerigi. Cozum: hareketi de tiklamayi da SendInput ile,
# gercek girdi olaylari olarak yollamak.
# --------------------------------------------------------------------------
class WinMouse(object):

    MOVE, ABSOLUTE, VIRTUALDESK = 0x0001, 0x8000, 0x4000
    BUTTONS = {
        "left":   (0x0002, 0x0004, 0),
        "right":  (0x0008, 0x0010, 0),
        "middle": (0x0020, 0x0040, 0),
        "x1":     (0x0080, 0x0100, 1),
        "x2":     (0x0080, 0x0100, 2),
    }

    def __init__(self):
        self.ok = False
        if sys.platform != "win32":
            return
        try:
            import ctypes
            from ctypes import wintypes

            ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

            class MOUSEINPUT(ctypes.Structure):
                _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG),
                            ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                            ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]

            class _INPUTunion(ctypes.Union):
                _fields_ = [("mi", MOUSEINPUT)]

            class INPUT(ctypes.Structure):
                _anonymous_ = ("u",)
                _fields_ = [("type", wintypes.DWORD), ("u", _INPUTunion)]

            self.ctypes = ctypes
            self.INPUT = INPUT
            self.MOUSEINPUT = MOUSEINPUT

            # DIKKAT: ctypes.windll.user32 PAYLASILAN bir nesnedir; pynput da
            # ayni SendInput fonksiyonunu kullanir. Uzerinde argtypes
            # ayarlarsak pynput'un kendi INPUT yapisi artik uymaz ve
            # klavye "expected LP_INPUT instance" hatasiyla coker.
            # Bu yuzden kendi ozel DLL ornegimizi aciyor ve hicbir
            # imzayi degistirmiyoruz.
            self.user32 = ctypes.WinDLL("user32", use_last_error=True)
            self.ok = True
        except Exception:                                # noqa: BLE001
            self.ok = False

    def _send(self, flags, data=0, dx=0, dy=0):
        try:
            inp = self.INPUT()
            inp.type = 0                                  # INPUT_MOUSE
            inp.mi = self.MOUSEINPUT(dx, dy, data, flags, 0, 0)
            n = self.user32.SendInput(1, self.ctypes.byref(inp),
                                      self.ctypes.sizeof(self.INPUT))
            return n == 1
        except Exception:                                # noqa: BLE001
            return False

    def move_abs(self, x, y):
        """Sanal masaustune gore mutlak hareket - gercek WM_MOUSEMOVE uretir."""
        g = self.user32.GetSystemMetrics
        vx, vy, vw, vh = g(76), g(77), g(78), g(79)       # SM_*VIRTUALSCREEN
        if vw <= 1 or vh <= 1:
            return False
        nx = int(round((int(x) - vx) * 65535.0 / (vw - 1)))
        ny = int(round((int(y) - vy) * 65535.0 / (vh - 1)))
        nx = max(0, min(65535, nx))
        ny = max(0, min(65535, ny))
        return self._send(self.MOVE | self.ABSOLUTE | self.VIRTUALDESK, 0, nx, ny)

    def button(self, name, down):
        b = self.BUTTONS.get(name)
        if not b:
            return False
        return self._send(b[0] if down else b[1], b[2])


WINMOUSE = WinMouse()


# --------------------------------------------------------------------------
# Piyano nota sayfasi ayristirici
#
# Kurallar (virtualpiano.net "How to Play" sayfasindan):
#   [abc]  -> tuslara AYNI ANDA bas (akor)
#   abc    -> hizli ard arda
#   a b c  -> aralarinda kisa mola (her bosluk bir mola ekler)
#   |      -> mola; yanindaki her ek bosluk molayi uzatir
#   BUYUK harf / simge -> siyah tus (Shift ile)
#   satir sonu -> daha uzun mola
# --------------------------------------------------------------------------
def parse_sheet(text):
    """Nota sayfasini ('note'|'chord'|'gap'|'bar'|'line', deger) listesine cevirir."""
    tokens = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "[":
            j = text.find("]", i + 1)
            if j == -1:                       # kapanmamis parantez: kalani tek tek cal
                for c in text[i + 1:]:
                    if not c.isspace():
                        tokens.append(("note", c))
                break
            keys = [c for c in text[i + 1:j] if not c.isspace()]
            if len(keys) == 1:
                tokens.append(("note", keys[0]))
            elif keys:
                tokens.append(("chord", keys))
            i = j + 1
        elif ch == "]":
            i += 1                            # eslesmeyen kapanis: yoksay
        elif ch == "|":
            tokens.append(("bar", None)); i += 1
        elif ch in "\r":
            i += 1
        elif ch == "\n":
            tokens.append(("line", None)); i += 1
        elif ch in " \t":
            tokens.append(("gap", None)); i += 1
        else:
            tokens.append(("note", ch)); i += 1
    return tokens


# --------------------------------------------------------------------------
# Motor
# --------------------------------------------------------------------------
class Engine(object):

    def __init__(self):
        self.kb = KeyboardController()
        self.ms = MouseController()
        self.stop_event = threading.Event()
        self.worker = None
        self.running = False
        self.capture_listener = None

    # ---------------- yardimcilar ----------------
    def _sleep(self, seconds):
        """Durdurma sinyaline duyarli bekleme. False -> durduruldu."""
        if seconds <= 0:
            return not self.stop_event.is_set()
        end = time.time() + seconds
        while time.time() < end:
            if self.stop_event.is_set():
                return False
            time.sleep(min(0.02, max(0.0, end - time.time())))
        return not self.stop_event.is_set()

    def _tap(self, key, hold=None):
        h = DEFAULT_HOLD if hold is None else max(0.0, hold)
        self.kb.press(key)
        try:
            if h:
                time.sleep(h)
        finally:
            # basma ile birakma arasinda bir sey ters giderse tus basili
            # kalmasin - takili bir Ctrl/Shift her seyi bozar
            self.kb.release(key)

    # ---------------- adim tipleri ----------------
    def _do_text(self, st):
        text = st.get("value", "") or ""
        delay = max(0, int(st.get("charDelay", 50))) / 1000.0
        press_enter = bool(st.get("pressEnter", True))
        final_enter = bool(st.get("finalEnter", False))
        total = len(text)

        for n, ch in enumerate(text, start=1):
            if self.stop_event.is_set():
                return False
            if ch == "\r":
                continue
            if ch == "\n":
                if press_enter:
                    self._tap(Key.enter)
                else:
                    continue
            elif ch == "\t":
                self._tap(Key.tab)
            else:
                try:
                    self.kb.type(ch)
                except Exception:                        # noqa: BLE001
                    pass
            if n % 5 == 0 or n == total:
                self._detail("%d/%d karakter" % (n, total))
            if not self._sleep(delay):
                return False

        if final_enter:
            self._tap(Key.enter)
        return True

    def _do_click(self, st):
        bname = str(st.get("button", "left")).lower()
        btn = BUTTONS.get(bname, Button.left)
        count = max(1, int(st.get("count", 1)))
        interval = max(0, int(st.get("interval", 100))) / 1000.0
        double = bool(st.get("double", False))
        mode = st.get("mode", "current")

        origin = self.ms.position
        if mode == "xy":
            self._move_to(int(st.get("x", 0)), int(st.get("y", 0)))
            # uygulamanin hareketi islemesi icin kisa bir es
            if not self._sleep(0.06):
                return False

        hold = max(0, int(st.get("holdMs", 30))) / 1000.0

        for i in range(1, count + 1):
            if self.stop_event.is_set():
                return False
            # DIKKAT: pynput'un click() metodu basma ile birakmayi ayni anda
            # yollar; Windows'ta ilk tik cogu zaman pencereyi one getirmekle
            # harcanir ve hedefe ulasmaz. Aralarina kisa bir sure koyuyoruz.
            self._press_button(bname, btn, hold)
            if double:
                time.sleep(0.06)
                self._press_button(bname, btn, hold)
            self._detail("%d/%d tık" % (i, count))
            if i < count and not self._sleep(interval):
                return False

        if mode == "xy" and bool(st.get("restore", False)):
            self._move_to(int(origin[0]), int(origin[1]))
        return True

    # ---------- fare yardimcilari ----------
    def _move_to(self, x, y):
        """Once SendInput; olmazsa pynput + kucuk bir durtme."""
        if WINMOUSE.ok and WINMOUSE.move_abs(x, y):
            return
        self.ms.position = (x, y)
        try:
            # SetCursorPos hareket olayi uretmez; 1 piksellik gidis-gelis
            # uygulamanin imleci fark etmesini saglar
            self.ms.move(1, 0)
            self.ms.move(-1, 0)
        except Exception:                                # noqa: BLE001
            pass

    def _press_button(self, bname, btn, hold):
        if WINMOUSE.ok and WINMOUSE.button(bname, True):
            try:
                if hold:
                    time.sleep(hold)
            finally:
                WINMOUSE.button(bname, False)
            return
        self.ms.press(btn)
        try:
            if hold:
                time.sleep(hold)
        finally:
            self.ms.release(btn)

    def _do_move(self, st):
        self._move_to(int(st.get("x", 0)), int(st.get("y", 0)))
        return not self.stop_event.is_set()

    def _do_scroll(self, st):
        amount = int(st.get("amount", -3))
        count = max(1, int(st.get("count", 1)))
        for i in range(count):
            if self.stop_event.is_set():
                return False
            self.ms.scroll(0, amount)
            if not self._sleep(0.05):
                return False
        return True

    # ---------------- piyano ----------------
    @staticmethod
    def _split_shift(ch):
        """Karakteri (basilacak tus, shift gerekli mi) olarak ayirir."""
        if ch.isalpha() and ch.isupper():
            return ch.lower(), True
        return ch, False

    def _play_chord(self, keys, hold):
        """Tuslari ayni anda basili tutup birlikte birakir."""
        plain, shifted = [], []
        for ch in keys:
            base, needs = Engine._split_shift(ch)
            (shifted if needs else plain).append(base)

        pressed, shift_down = [], False
        try:
            for k in plain:
                self.kb.press(k); pressed.append(k)
            if shifted:
                self.kb.press(Key.shift); shift_down = True
                for k in shifted:
                    self.kb.press(k); pressed.append(k)
            time.sleep(hold)
        finally:
            for k in reversed(pressed):
                try:
                    self.kb.release(k)
                except Exception:                        # noqa: BLE001
                    pass
            if shift_down:
                try:
                    self.kb.release(Key.shift)
                except Exception:                        # noqa: BLE001
                    pass
        return not self.stop_event.is_set()

    def _play_note(self, ch, hold):
        base, needs = Engine._split_shift(ch)
        try:
            if needs:
                with self.kb.pressed(Key.shift):
                    self.kb.press(base); time.sleep(hold); self.kb.release(base)
            else:
                self.kb.press(base); time.sleep(hold); self.kb.release(base)
        except Exception:                                # noqa: BLE001
            try:
                self.kb.type(ch)                         # son care
            except Exception:                            # noqa: BLE001
                pass
        return not self.stop_event.is_set()

    def _do_piano(self, st):
        tokens = parse_sheet(st.get("value", "") or "")
        note = max(0, int(st.get("noteMs", 130))) / 1000.0
        gap  = max(0, int(st.get("gapMs", 130)))  / 1000.0
        bar  = max(0, int(st.get("barMs", 260)))  / 1000.0
        line = max(0, int(st.get("lineMs", 400))) / 1000.0
        hold = max(1, int(st.get("holdMs", 40)))  / 1000.0
        hold = min(hold, note if note > 0 else hold)

        total = sum(1 for k, _ in tokens if k in ("note", "chord"))
        played = 0

        for kind, val in tokens:
            if self.stop_event.is_set():
                return False

            if kind == "note":
                if not self._play_note(val, hold):
                    return False
                played += 1
            elif kind == "chord":
                if not self._play_chord(val, hold):
                    return False
                played += 1
            elif kind == "gap":
                if not self._sleep(gap):
                    return False
                continue
            elif kind == "bar":
                if not self._sleep(bar):
                    return False
                continue
            elif kind == "line":
                if not self._sleep(line):
                    return False
                continue

            if played % 5 == 0 or played == total:
                self._detail("%d/%d nota" % (played, total))
            if not self._sleep(max(0.0, note - hold)):
                return False
        return True

    def _do_delay(self, st):
        return self._sleep(max(0, int(st.get("ms", 500))) / 1000.0)

    def _do_key(self, st):
        key = resolve_key(st.get("value", "enter"))
        if key is None:
            return True
        count = max(1, int(st.get("count", 1)))
        gap = max(0, int(st.get("interval", 60))) / 1000.0
        hold = max(0, int(st.get("holdMs", 30))) / 1000.0
        for i in range(count):
            if self.stop_event.is_set():
                return False
            self._tap(key, hold)
            self._detail("%d/%d" % (i + 1, count))
            if i < count - 1 and not self._sleep(gap):
                return False
        return True

    def _do_combo(self, st):
        """Ornek: ctrl+c  ->  {"keys":["ctrl","c"]}"""
        names = st.get("keys") or []
        keys = [k for k in (resolve_key(n) for n in names) if k is not None]
        if not keys:
            return True
        try:
            for k in keys:
                self.kb.press(k)
            time.sleep(0.03)
        finally:
            for k in reversed(keys):
                try:
                    self.kb.release(k)
                except Exception:                        # noqa: BLE001
                    pass
        return not self.stop_event.is_set()

    HANDLERS = {
        "text": _do_text,
        "click": _do_click,
        "move": _do_move,
        "scroll": _do_scroll,
        "delay": _do_delay,
        "piano": _do_piano,
        "key": _do_key,
        "combo": _do_combo,
    }

    # ---------------- ilerleme ----------------
    def _detail(self, text):
        self._last_detail = text
        emit(ev="progress", loop=self._loop, loops=self._loops,
             step=self._step, steps=self._steps, pct=self._pct(), detail=text)

    def _pct(self):
        if self._steps <= 0:
            return 0
        base = (self._step - 1) / float(self._steps)
        return round(min(100.0, base * 100 + (100.0 / self._steps) * 0.5), 1)

    # ---------------- ana dongu ----------------
    def start(self, config):
        if self.running:
            status("Zaten çalışıyor.", "warn")
            return
        steps = [s for s in (config.get("steps") or []) if s.get("enabled", True)]
        if not steps:
            status("Çalıştırılacak adım yok.", "err")
            emit(ev="finished", reason="error", message="Adım yok")
            return

        bilinmeyen = sorted({str(s.get("type", "")).lower() for s in steps
                             if str(s.get("type", "")).lower() not in Engine.HANDLERS})
        if bilinmeyen and len(bilinmeyen) >= len({str(s.get("type", "")).lower()
                                                  for s in steps}):
            msg = ("Bu motor şu adımları tanımıyor: %s  —  eski bir motor "
                   "çalışıyor olabilir (engine/dist klasörünü sil)."
                   % ", ".join(bilinmeyen))
            status(msg, "err")
            emit(ev="finished", reason="error", message=msg)
            return
        if bilinmeyen:
            status("Bu motor şu adımları tanımıyor, atlanacak: %s"
                   % ", ".join(bilinmeyen), "warn")

        self.stop_event.clear()
        self.running = True
        emit(ev="started")
        self.worker = threading.Thread(target=self._run, args=(config, steps),
                                       daemon=True)
        self.worker.start()

    def stop(self):
        if self.running:
            self.stop_event.set()
            status("Durduruluyor...", "warn")

    def _run(self, config, steps):
        try:
            start_delay = max(0, int(config.get("startDelay", 3)))
            repeat = max(0, int(config.get("repeat", 1)))
            loop_delay = max(0, int(config.get("loopDelay", 500))) / 1000.0

            self._loops = repeat
            self._steps = len(steps)
            self._loop = 0
            self._step = 0

            for s in range(start_delay, 0, -1):
                if self.stop_event.is_set():
                    return self._finish("stopped", "İptal edildi.")
                status("%d saniye içinde başlıyor... hedef pencereye geç!" % s, "run")
                if not self._sleep(1.0):
                    return self._finish("stopped", "İptal edildi.")

            win = (config.get("focusWindow") or "").strip()
            if win:
                if focus_window(win):
                    status("Pencere öne getirildi: %s" % win, "run")
                    if not self._sleep(0.35):
                        return self._finish("stopped", "Durduruldu.")
                else:
                    status("Pencere bulunamadı: %s" % win, "warn")

            infinite = (repeat == 0)
            loop = 0
            while True:
                loop += 1
                self._loop = loop
                for idx, st in enumerate(steps, start=1):
                    if self.stop_event.is_set():
                        return self._finish("stopped", "Durduruldu.")
                    self._step = idx
                    kind = str(st.get("type", "")).lower()
                    handler = Engine.HANDLERS.get(kind)
                    if handler is None:
                        status("Bilinmeyen adım: %s" % kind, "warn")
                        continue
                    self._detail(self._label(st))
                    if not handler(self, st):
                        return self._finish("stopped", "Durduruldu.")

                if not infinite and loop >= repeat:
                    break
                if not self._sleep(loop_delay):
                    return self._finish("stopped", "Durduruldu.")

            self._finish("done", "Tamamlandı. (%d tekrar)" % loop)

        except Exception as e:                            # noqa: BLE001
            emit(ev="log", text=traceback.format_exc())
            self._finish("error", "Hata: %s" % e)

    def _label(self, st):
        k = str(st.get("type", "")).lower()
        if k == "text":
            v = (st.get("value") or "").replace("\n", " ")
            return "Metin: %s" % (v[:28] + ("..." if len(v) > 28 else ""))
        if k == "click":
            where = ("(%s, %s)" % (st.get("x"), st.get("y"))
                     if st.get("mode") == "xy" else "bulunduğu yere")
            return "Tık: %s %s x%s" % (st.get("button", "left"), where,
                                       st.get("count", 1))
        if k == "move":
            return "Fareyi taşı: (%s, %s)" % (st.get("x"), st.get("y"))
        if k == "scroll":
            return "Kaydır: %s" % st.get("amount")
        if k == "piano":
            toks = parse_sheet(st.get("value", "") or "")
            notes = sum(1 for a, _ in toks if a in ("note", "chord"))
            chords = sum(1 for a, _ in toks if a == "chord")
            return "Piyano: %d nota, %d akor" % (notes, chords)
        if k == "delay":
            return "Bekle: %s ms" % st.get("ms")
        if k == "key":
            return "Tuş: %s x%s" % (st.get("value"), st.get("count", 1))
        if k == "combo":
            return "Kombin: %s" % "+".join(st.get("keys") or [])
        return k

    def _finish(self, reason, message):
        self.running = False
        self.stop_event.clear()
        emit(ev="finished", reason=reason, message=message)

    # ---------------- koordinat yakalama ----------------
    def capture(self):
        if self.capture_listener is not None:
            return
        status("Yakalama açık: ekranda istediğin noktaya sol tıkla.", "run")

        def on_click(x, y, button, pressed):
            if pressed and button == Button.left:
                emit(ev="capture", x=int(x), y=int(y))
                self.capture_listener = None
                return False        # dinleyiciyi kapat

        self.capture_listener = mouse.Listener(on_click=on_click)
        self.capture_listener.daemon = True
        self.capture_listener.start()

    def cancel_capture(self):
        if self.capture_listener is not None:
            try:
                self.capture_listener.stop()
            except Exception:                             # noqa: BLE001
                pass
            self.capture_listener = None
            status("Yakalama iptal edildi.")

    def cursor(self):
        x, y = self.ms.position
        emit(ev="cursor", x=int(x), y=int(y))


# --------------------------------------------------------------------------
# Global tetikleyiciler
#
# Arayuz "spec" dizeleri gonderir:
#     key:f6          key:ctrl+alt+m          mouse:x1
# Motor bunlari dinler ve her basis/birakis icin arayuze
#     {"ev":"trigger","spec":...,"phase":"down"|"up"}
# yollar. Ne yapilacagina (bir kez / surekli / basili tuttukca) arayuz
# karar verir; motor sadece olayi bildirir.
# --------------------------------------------------------------------------
MOD_NAMES = {
    "ctrl_l": "ctrl", "ctrl_r": "ctrl", "ctrl": "ctrl",
    "alt_l": "alt", "alt_r": "alt", "alt_gr": "alt", "alt": "alt",
    "shift_l": "shift", "shift_r": "shift", "shift": "shift",
    "cmd_l": "cmd", "cmd_r": "cmd", "cmd": "cmd",
}


def norm_key(key):
    """pynput tusunu sabit bir isme cevirir: f6, a, esc, ctrl ...

    Ctrl basiliyken isletim sistemi harf yerine kontrol karakteri
    bildirir (ornegin Ctrl+M -> "\r"). Bu yuzden once tarama koduna
    bakiyoruz, harfe ancak yazdirilabilirse guveniyoruz.
    """
    try:
        if isinstance(key, keyboard.Key):
            return MOD_NAMES.get(key.name, key.name)

        vk = getattr(key, "vk", None)
        if vk is not None:
            if 0x41 <= vk <= 0x5A:          # Windows VK_A .. VK_Z
                return chr(vk).lower()
            if 0x61 <= vk <= 0x7A:          # X11 keysym a .. z
                return chr(vk)
            if 0x30 <= vk <= 0x39:          # rakamlar
                return chr(vk)

        ch = getattr(key, "char", None)
        if ch and ord(ch) >= 32:
            return ch.lower()
        if vk is not None:
            return "vk%d" % vk
    except Exception:                                    # noqa: BLE001
        pass
    return None


class TriggerManager(object):
    """Klavye ve fare dinleyicilerini yonetir."""

    def __init__(self):
        self.specs = set()
        self.kb = None
        self.ms = None
        self.mods = set()
        self.active = {}          # basili duran tuslar: temel tus -> spec
        self._watching = False

    # ---------- kurulum ----------
    def apply(self, specs):
        self.specs = set(s for s in (specs or []) if s)
        ok, err = self._start_listeners()
        emit(ev="bindings", count=len(self.specs), ok=ok, error=err)
        if not ok:
            status("Kısayollar dinlenemedi: %s" % err, "err")
        self._start_watchdog()

    def _start_listeners(self):
        self.release()
        self.mods.clear()
        self.active.clear()
        if not self.specs:
            return True, ""
        try:
            self.kb = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
            self.kb.daemon = True
            self.kb.start()
            if any(s.startswith("mouse:") for s in self.specs):
                self.ms = mouse.Listener(on_click=self._on_click)
                self.ms.daemon = True
                self.ms.start()
            return True, ""
        except Exception as e:                           # noqa: BLE001
            return False, str(e)

    def _start_watchdog(self):
        """Dinleyiciler bazen sessizce olur (surucu, oturum kilidi, RDP...).
        Iki saniyede bir kontrol edip gerekirse yeniden kuruyoruz; yoksa
        kisayollar hic haber vermeden calismaz hale geliyor."""
        if self._watching:
            return
        self._watching = True

        def loop():
            while True:
                time.sleep(2.0)
                try:
                    if not self.specs:
                        continue
                    dead = (self.kb is None or not self.kb.running)
                    if not dead and any(s.startswith("mouse:") for s in self.specs):
                        dead = (self.ms is None or not self.ms.running)
                    if dead:
                        emit(ev="log", text="Kısayol dinleyicisi durmuş, yeniden kuruluyor.")
                        self._start_listeners()
                except Exception:                        # noqa: BLE001
                    pass

        th = threading.Thread(target=loop)
        th.daemon = True
        th.start()

    def release(self):
        for l in (self.kb, self.ms):
            if l is not None:
                try:
                    l.stop()
                except Exception:                        # noqa: BLE001
                    pass
        self.kb = self.ms = None

    # ---------- klavye ----------
    def _spec_for(self, base):
        parts = [m for m in ("ctrl", "alt", "shift", "cmd") if m in self.mods]
        parts.append(base)
        return "key:" + "+".join(parts)

    # DIKKAT: geri cagirmalardan disari sizan tek bir hata pynput
    # dinleyicisini komple durdurur ve kisayollar sessizce olur.
    # Bu yuzden ucu de bastan sona korumali.
    def _on_press(self, key):
        try:
            base = norm_key(key)
            if base is None:
                return
            if base in ("ctrl", "alt", "shift", "cmd"):
                self.mods.add(base)
                return
            if base in self.active:        # tus basili tutuluyor, tekrar sinyali
                return
            spec = self._spec_for(base)
            if spec in self.specs:
                self.active[base] = spec
                emit(ev="trigger", spec=spec, phase="down")
        except Exception as e:                           # noqa: BLE001
            emit(ev="log", text="kısayol (basma) hatası: %r" % (e,))

    def _on_release(self, key):
        try:
            base = norm_key(key)
            if base is None:
                return
            if base in ("ctrl", "alt", "shift", "cmd"):
                self.mods.discard(base)
                return
            spec = self.active.pop(base, None)
            if spec:
                emit(ev="trigger", spec=spec, phase="up")
        except Exception as e:                           # noqa: BLE001
            emit(ev="log", text="kısayol (bırakma) hatası: %r" % (e,))

    # ---------- fare ----------
    def _on_click(self, x, y, button, pressed):
        try:
            spec = "mouse:" + button.name
            if spec in self.specs:
                emit(ev="trigger", spec=spec, phase="down" if pressed else "up")
        except Exception as e:                           # noqa: BLE001
            emit(ev="log", text="kısayol (fare) hatası: %r" % (e,))


# --------------------------------------------------------------------------
# Pencere yardimcilari (yalnizca Windows; digerlerinde sessizce devre disi)
# --------------------------------------------------------------------------
def _user32():
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        return ctypes.windll.user32
    except Exception:                                    # noqa: BLE001
        return None


def active_window_title():
    u = _user32()
    if u is None:
        return ""
    try:
        import ctypes
        h = u.GetForegroundWindow()
        n = u.GetWindowTextLengthW(h)
        buf = ctypes.create_unicode_buffer(n + 1)
        u.GetWindowTextW(h, buf, n + 1)
        return buf.value or ""
    except Exception:                                    # noqa: BLE001
        return ""


def list_windows():
    """Gorunur ve basligi olan pencereleri dondurur."""
    u = _user32()
    if u is None:
        return []
    try:
        import ctypes
        from ctypes import wintypes
        out = []
        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def cb(hwnd, _l):
            try:
                if not u.IsWindowVisible(hwnd):
                    return True
                n = u.GetWindowTextLengthW(hwnd)
                if n <= 0:
                    return True
                buf = ctypes.create_unicode_buffer(n + 1)
                u.GetWindowTextW(hwnd, buf, n + 1)
                title = (buf.value or "").strip()
                if title and title not in out:
                    out.append(title)
            except Exception:                            # noqa: BLE001
                pass
            return True

        u.EnumWindows(CB(cb), 0)
        out.sort(key=lambda x: x.lower())
        return out
    except Exception:                                    # noqa: BLE001
        return []


def focus_window(needle):
    """Basligi 'needle' iceren ilk gorunur pencereyi one getirir."""
    u = _user32()
    if u is None or not needle:
        return False
    try:
        import ctypes
        from ctypes import wintypes
        found = []
        needle_low = needle.lower()

        CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

        def cb(hwnd, _l):
            if not u.IsWindowVisible(hwnd):
                return True
            n = u.GetWindowTextLengthW(hwnd)
            if n <= 0:
                return True
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(hwnd, buf, n + 1)
            if needle_low in (buf.value or "").lower():
                found.append(hwnd)
                return False
            return True

        u.EnumWindows(CB(cb), 0)
        if not found:
            return False
        h = found[0]
        if u.IsIconic(h):
            u.ShowWindow(h, 9)                            # SW_RESTORE
        u.SetForegroundWindow(h)
        return True
    except Exception:                                    # noqa: BLE001
        return False


# --------------------------------------------------------------------------
# Kayit (record)
#
# Fare tiklamalari, tekerlek, istege bagli fare hareketi ve klavye
# basislari zaman damgasiyla arayuze aktarilir; adimlara cevirme isini
# arayuz yapar.
# --------------------------------------------------------------------------
class Recorder(object):

    def __init__(self):
        self.on = False
        self.kb = None
        self.ms = None
        self.t0 = 0.0
        self.mods = set()
        self.stop_key = "f10"
        self.want_moves = False
        self.last_move = 0.0
        self.last_pos = (0, 0)

    def _ms(self):
        return int((time.time() - self.t0) * 1000)

    def start(self, opts):
        if self.on:
            return
        opts = opts or {}
        self.stop_key = str(opts.get("stopKey") or "f10").lower()
        self.want_moves = bool(opts.get("moves"))
        self.mods.clear()
        self.t0 = time.time()
        self.last_move = 0.0
        try:
            self.kb = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)
            self.kb.daemon = True
            self.kb.start()
            self.ms = mouse.Listener(on_click=self._on_click,
                                     on_scroll=self._on_scroll,
                                     on_move=self._on_move if self.want_moves else None)
            self.ms.daemon = True
            self.ms.start()
            self.on = True
            emit(ev="rec", kind="started", stopKey=self.stop_key)
        except Exception as e:                           # noqa: BLE001
            self.on = False
            emit(ev="rec", kind="error", message=str(e))

    def stop(self):
        if not self.on:
            return
        self.on = False
        for l in (self.kb, self.ms):
            if l is not None:
                try:
                    l.stop()
                except Exception:                        # noqa: BLE001
                    pass
        self.kb = self.ms = None
        emit(ev="rec", kind="stopped")

    # ---------- klavye ----------
    def _on_press(self, key):
        try:
            if not self.on:
                return
            base = norm_key(key)
            if base is None:
                return
            if base in ("ctrl", "alt", "shift", "cmd"):
                self.mods.add(base)
                return
            if base == self.stop_key:
                self.stop()
                return
            mods = [m for m in ("ctrl", "alt", "shift", "cmd") if m in self.mods]
            if mods:
                emit(ev="rec", kind="combo", keys=mods + [base], t=self._ms())
            else:
                emit(ev="rec", kind="key", key=base, t=self._ms())
        except Exception as e:                           # noqa: BLE001
            emit(ev="log", text="kayıt (tuş) hatası: %r" % (e,))

    def _on_release(self, key):
        try:
            base = norm_key(key)
            if base in ("ctrl", "alt", "shift", "cmd"):
                self.mods.discard(base)
        except Exception:                                # noqa: BLE001
            pass

    # ---------- fare ----------
    def _on_click(self, x, y, button, pressed):
        try:
            if not self.on or not pressed:
                return
            emit(ev="rec", kind="click", x=int(x), y=int(y),
                 button=button.name, t=self._ms())
        except Exception as e:                           # noqa: BLE001
            emit(ev="log", text="kayıt (tık) hatası: %r" % (e,))

    def _on_scroll(self, x, y, dx, dy):
        try:
            if not self.on:
                return
            emit(ev="rec", kind="scroll", amount=int(dy), t=self._ms())
        except Exception:                                # noqa: BLE001
            pass

    def _on_move(self, x, y):
        try:
            if not self.on:
                return
            now = time.time()
            if now - self.last_move < 0.12:
                return
            if abs(x - self.last_pos[0]) + abs(y - self.last_pos[1]) < 25:
                return
            self.last_move = now
            self.last_pos = (int(x), int(y))
            emit(ev="rec", kind="move", x=int(x), y=int(y), t=self._ms())
        except Exception:                                # noqa: BLE001
            pass


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    engine = Engine()
    triggers = TriggerManager()
    recorder = Recorder()
    # SendInput yolu acikse arayuzde gorunsun (Ayarlar > Motor)
    feats = list(FEATURES)
    if WINMOUSE.ok:
        feats.append("sendinput")
    emit(ev="ready", version=ENGINE_VERSION, features=feats)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            emit(ev="log", text="Çözülemeyen komut: %s" % line[:200])
            continue

        cmd = msg.get("cmd")
        try:
            if cmd == "ping":
                emit(ev="pong")
            elif cmd == "start":
                engine.start(msg.get("config") or {})
            elif cmd == "stop":
                engine.stop()
            elif cmd == "capture":
                engine.capture()
            elif cmd == "cancel_capture":
                engine.cancel_capture()
            elif cmd == "cursor":
                engine.cursor()
            elif cmd == "bindings":
                triggers.apply(msg.get("specs"))
            elif cmd == "record_start":
                recorder.start(msg.get("options"))
            elif cmd == "record_stop":
                recorder.stop()
            elif cmd == "window":
                emit(ev="window", title=active_window_title())
            elif cmd == "windows":
                emit(ev="windows", list=list_windows())
            elif cmd == "focus":
                emit(ev="focus", ok=focus_window(msg.get("title") or ""))
            elif cmd == "hotkeys":
                # eski bicim: start/stop -> spec listesi
                conv = []
                for k in (msg.get("start"), msg.get("stop")):
                    if k:
                        conv.append("key:" + k.replace("<", "").replace(">", ""))
                triggers.apply(conv)
            elif cmd == "quit":
                engine.stop()
                recorder.stop()
                triggers.release()
                break
            else:
                emit(ev="log", text="Bilinmeyen komut: %s" % cmd)
        except Exception as e:                            # noqa: BLE001
            emit(ev="log", text="Komut hatası: %s\n%s" % (e, traceback.format_exc()))


if __name__ == "__main__":
    main()
